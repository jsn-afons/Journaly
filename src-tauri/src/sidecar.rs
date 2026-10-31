use std::{path::PathBuf, sync::Arc};
use serde::{Deserialize, Serialize};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, ChildStdin, Command}, sync::Mutex, time::{timeout, Duration}};
use crate::{errors::AppError, settings::{self, Role}};

const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const AI_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Deserialize, Serialize)]
pub struct HealthResponse { pub status: String, pub service: String }

#[derive(Serialize)]
struct RpcRequest<'a> { jsonrpc: &'static str, id: u64, method: &'a str, params: serde_json::Value }
#[derive(Deserialize)]
struct RpcError { code: String, message: String, #[serde(default)] retryable: bool }
#[derive(Deserialize)]
struct RpcResponse<T> { result: Option<T>, error: Option<RpcError> }

/// `_child` is kept so dropping ProcessIo (restart, app exit) kills the daemon (`kill_on_drop`).
struct ProcessIo { _child: Child, stdin: ChildStdin, stdout: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>, next_id: u64 }

#[derive(Clone)]
pub struct SidecarClient { process: Arc<Mutex<Option<ProcessIo>>>, daemon_dir: PathBuf, journal_root: PathBuf }

impl SidecarClient {
    pub fn new(daemon_dir: PathBuf, journal_root: PathBuf) -> Self { Self { process: Arc::new(Mutex::new(None)), daemon_dir, journal_root } }
    async fn ensure_process(&self, process: &mut Option<ProcessIo>) -> Result<(), AppError> {
        if process.is_some() { return Ok(()); }
        let executable = std::env::var("JOURNALY_PYTHON").unwrap_or_else(|_| "python3".into());
        let mut command = Command::new(executable);
        command.arg("-m").arg("ai_daemon.api.rpc_server").current_dir(&self.daemon_dir).env("JOURNALY_JOURNAL_DIR", &self.journal_root).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::inherit()).kill_on_drop(true);
        // Once the user has saved provider settings in the UI, those win over any inherited JOURNALY_* variables.
        if settings::exists() {
            for variable in ["JOURNALY_CHAT_BASE_URL", "JOURNALY_CHAT_MODEL", "JOURNALY_EMBEDDING_BASE_URL", "JOURNALY_EMBEDDING_MODEL", "JOURNALY_EMBEDDING_DIMENSIONS", "JOURNALY_SEND_EMBEDDING_DIMENSIONS"] { command.env_remove(variable); }
            command.env("JOURNALY_CONFIG", settings::settings_path());
            for (role, variable) in [(Role::Chat, "JOURNALY_CHAT_API_KEY"), (Role::Embedding, "JOURNALY_EMBEDDING_API_KEY")] {
                match settings::get_key(role) { Some(key) => { command.env(variable, key); } None => { command.env_remove(variable); } }
            }
        }
        let mut child = command.spawn().map_err(|e| AppError::SidecarUnavailable(e.to_string()))?;
        let stdin = child.stdin.take().ok_or_else(|| AppError::SidecarUnavailable("missing stdin".into()))?;
        let stdout = child.stdout.take().ok_or_else(|| AppError::SidecarUnavailable("missing stdout".into()))?;
        *process = Some(ProcessIo { _child: child, stdin, stdout: BufReader::new(stdout).lines(), next_id: 1 });
        Ok(())
    }
    /// Stop the daemon; the next request starts a fresh one that re-reads settings and Keychain keys.
    pub async fn restart(&self) { *self.process.lock().await = None; }
    pub async fn health(&self) -> Result<HealthResponse, AppError> {
        self.call("health", serde_json::json!({})).await
    }
    pub async fn index_file(&self, path: &str) -> Result<serde_json::Value, AppError> { self.call("index_file", serde_json::json!({"path": path})).await }
    pub async fn sync_index(&self) -> Result<serde_json::Value, AppError> { self.call_with_timeout("rebuild_index", serde_json::json!({}), AI_TIMEOUT).await }
    pub async fn remove_file(&self, path: &str) -> Result<serde_json::Value, AppError> { self.call("remove_file", serde_json::json!({"path": path})).await }
    /// Forward an AI/RAG request to the daemon. Embedding and LLM calls are network-bound, so they get a long timeout.
    pub async fn request(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, AppError> { self.call_with_timeout(method, params, AI_TIMEOUT).await }
    async fn call<T: serde::de::DeserializeOwned>(&self, method: &str, params: serde_json::Value) -> Result<T, AppError> { self.call_with_timeout(method, params, HEALTH_TIMEOUT).await }
    async fn call_with_timeout<T: serde::de::DeserializeOwned>(&self, method: &str, params: serde_json::Value, limit: Duration) -> Result<T, AppError> {
        self.call_streaming(method, params, limit, |_| {}).await
    }

    /// Like `request`, but JSON-RPC notifications the daemon sends before its final response
    /// (e.g. `chat_delta`) are handed to `on_notification`. The timeout applies per line, so a long
    /// stream that keeps producing output is not cut off.
    pub async fn request_streaming(&self, method: &str, params: serde_json::Value, on_notification: impl FnMut(serde_json::Value)) -> Result<serde_json::Value, AppError> {
        self.call_streaming(method, params, AI_TIMEOUT, on_notification).await
    }

    async fn call_streaming<T: serde::de::DeserializeOwned>(&self, method: &str, params: serde_json::Value, limit: Duration, mut on_notification: impl FnMut(serde_json::Value)) -> Result<T, AppError> {
        let mut locked = self.process.lock().await;
        self.ensure_process(&mut locked).await?;
        let io = locked.as_mut().expect("sidecar initialized");
        let request = RpcRequest { jsonrpc: "2.0", id: io.next_id, method, params };
        io.next_id += 1;
        let encoded = serde_json::to_string(&request).map_err(|e| AppError::InvalidResponse(e.to_string()))? + "\n";
        let outcome: Result<T, AppError> = async {
            io.stdin.write_all(encoded.as_bytes()).await.map_err(|e| AppError::SidecarUnavailable(e.to_string()))?;
            io.stdin.flush().await.map_err(|e| AppError::SidecarUnavailable(e.to_string()))?;
            loop {
                let line = timeout(limit, io.stdout.next_line()).await.map_err(|_| AppError::SidecarUnavailable(format!("{method} timed out")))?.map_err(|e| AppError::SidecarUnavailable(e.to_string()))?.ok_or_else(|| AppError::SidecarUnavailable("sidecar closed stdout".into()))?;
                let value: serde_json::Value = serde_json::from_str(&line).map_err(|e| AppError::InvalidResponse(e.to_string()))?;
                if value.get("id").is_none() && value.get("method").is_some() { on_notification(value.get("params").cloned().unwrap_or_default()); continue; }
                let response: RpcResponse<T> = serde_json::from_value(value).map_err(|e| AppError::InvalidResponse(e.to_string()))?;
                if let Some(error) = response.error { return Err(AppError::Rpc { code: error.code, message: error.message, retryable: error.retryable }); }
                return response.result.ok_or_else(|| AppError::InvalidResponse("missing result".into()));
            }
        }.await;
        // After a transport failure (timeout, closed pipe, garbled line) the stream position is unknown,
        // so a late reply could be mistaken for the next request's. Start a fresh daemon next time instead.
        if matches!(outcome, Err(AppError::SidecarUnavailable(_) | AppError::InvalidResponse(_))) { *locked = None; }
        outcome
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A stand-in daemon: answers every request with two notifications, then the final response.
    const FAKE_DAEMON: &str = r#"
import json, sys
for line in sys.stdin:
    request = json.loads(line)
    for text in ["Hel", "lo"]:
        print(json.dumps({"jsonrpc": "2.0", "method": "chat_delta", "params": {"request_id": request["id"], "text": text}}), flush=True)
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": {"answer": "Hello"}}), flush=True)
"#;

    /// A throwaway directory containing `ai_daemon/api/rpc_server.py` = `script`, so SidecarClient can spawn it.
    pub(crate) fn fake_daemon_dir(name: &str, script: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("journaly-fake-daemon-{}-{name}", std::process::id()));
        let package = root.join("ai_daemon/api");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(root.join("ai_daemon/__init__.py"), "").unwrap();
        std::fs::write(package.join("__init__.py"), "").unwrap();
        std::fs::write(package.join("rpc_server.py"), script).unwrap();
        root
    }

    #[tokio::test]
    async fn notifications_are_forwarded_and_final_result_returned() {
        let dir = fake_daemon_dir("stream", FAKE_DAEMON);
        let client = SidecarClient::new(dir.clone(), dir.join("Journal"));
        let mut deltas = Vec::new();
        let result = client.request_streaming("chat", serde_json::json!({}), |params| deltas.push(params["text"].as_str().unwrap().to_owned())).await.unwrap();
        assert_eq!(deltas, ["Hel", "lo"]);
        assert_eq!(result["answer"], "Hello");
        // A plain request on the same process skips notifications rather than mistaking them for the response.
        let again = client.request("chat", serde_json::json!({})).await.unwrap();
        assert_eq!(again["answer"], "Hello");
        std::fs::remove_dir_all(dir).ok();
    }
}
