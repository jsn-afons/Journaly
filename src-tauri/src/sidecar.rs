use std::{path::PathBuf, sync::Arc};
use serde::{Deserialize, Serialize};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{ChildStdin, Command}, sync::Mutex, time::{timeout, Duration}};
use crate::errors::AppError;

#[derive(Debug, Deserialize, Serialize)]
pub struct HealthResponse { pub status: String, pub service: String }

#[derive(Serialize)]
struct RpcRequest<'a> { jsonrpc: &'static str, id: u64, method: &'a str }
#[derive(Deserialize)]
struct RpcError { code: String, message: String }
#[derive(Deserialize)]
struct RpcResponse<T> { result: Option<T>, error: Option<RpcError> }

struct ProcessIo { stdin: ChildStdin, stdout: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>, next_id: u64 }

#[derive(Clone)]
pub struct SidecarClient { process: Arc<Mutex<Option<ProcessIo>>>, daemon_dir: PathBuf }

impl SidecarClient {
    pub fn new(daemon_dir: PathBuf) -> Self { Self { process: Arc::new(Mutex::new(None)), daemon_dir } }
    async fn ensure_process(&self, process: &mut Option<ProcessIo>) -> Result<(), AppError> {
        if process.is_some() { return Ok(()); }
        let executable = std::env::var("JOURNALY_PYTHON").unwrap_or_else(|_| "python3".into());
        let mut child = Command::new(executable).arg("-m").arg("ai_daemon.api.rpc_server").current_dir(&self.daemon_dir).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::inherit()).spawn().map_err(|e| AppError::SidecarUnavailable(e.to_string()))?;
        let stdin = child.stdin.take().ok_or_else(|| AppError::SidecarUnavailable("missing stdin".into()))?;
        let stdout = child.stdout.take().ok_or_else(|| AppError::SidecarUnavailable("missing stdout".into()))?;
        *process = Some(ProcessIo { stdin, stdout: BufReader::new(stdout).lines(), next_id: 1 });
        Ok(())
    }
    pub async fn health(&self) -> Result<HealthResponse, AppError> {
        let mut locked = self.process.lock().await;
        self.ensure_process(&mut locked).await?;
        let io = locked.as_mut().expect("sidecar initialized");
        let request = RpcRequest { jsonrpc: "2.0", id: io.next_id, method: "health" };
        io.next_id += 1;
        let encoded = serde_json::to_string(&request).map_err(|e| AppError::InvalidResponse(e.to_string()))? + "\n";
        io.stdin.write_all(encoded.as_bytes()).await.map_err(|e| AppError::SidecarUnavailable(e.to_string()))?;
        io.stdin.flush().await.map_err(|e| AppError::SidecarUnavailable(e.to_string()))?;
        let line = timeout(Duration::from_secs(5), io.stdout.next_line()).await.map_err(|_| AppError::SidecarUnavailable("health timed out".into()))?.map_err(|e| AppError::SidecarUnavailable(e.to_string()))?.ok_or_else(|| AppError::SidecarUnavailable("sidecar closed stdout".into()))?;
        let response: RpcResponse<HealthResponse> = serde_json::from_str(&line).map_err(|e| AppError::InvalidResponse(e.to_string()))?;
        if let Some(error) = response.error { return Err(AppError::Rpc { code: error.code, message: error.message }); }
        response.result.ok_or_else(|| AppError::InvalidResponse("missing result".into()))
    }
}
