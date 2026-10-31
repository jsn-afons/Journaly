//! Background embedding of new and edited entries, so semantic search keeps up without user action.
//!
//! One long-lived task asks the daemon to embed pending chunks in bounded batches. It wakes when the
//! watcher has indexed changed files or provider settings change, and otherwise retries failures with
//! exponential backoff (1 min doubling to 30 min) so an offline or unconfigured provider is not polled
//! aggressively (AGENT.md sec.21). Status is kept for the UI to display.
use std::{sync::{Arc, Mutex}, time::{Duration, Instant}};
use serde::Serialize;
use tokio::{sync::Notify, time::{sleep, timeout}};
use tracing::{info, warn};
use crate::sidecar::SidecarClient;

const STARTUP_DELAY: Duration = Duration::from_secs(3);
const BASE_BACKOFF: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(30 * 60);
/// Idle/unavailable runs still re-check occasionally in case something changed outside the app.
const IDLE_RECHECK: Duration = Duration::from_secs(30 * 60);
const MAX_BATCHES_PER_RUN: usize = 100;
/// A short pause between batches lets chat and search requests get a turn at the daemon.
const BATCH_PAUSE: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbedState { Starting, Working, UpToDate, Waiting, Unavailable }

#[derive(Clone, Debug, Serialize)]
pub struct EmbedStatus { pub state: EmbedState, pub pending_entries: Option<u64>, pub last_error: Option<String>, pub next_retry_seconds: Option<u64> }

#[derive(Debug, PartialEq)]
pub enum RunOutcome { Done, Failed(String), Unavailable(String) }

#[derive(Clone)]
pub struct Embedder { wake: Arc<Notify>, status: Arc<Mutex<(EmbedStatus, Option<Instant>)>> }

impl Embedder {
    pub fn start(sidecar: SidecarClient) -> Self {
        let embedder = Self { wake: Arc::new(Notify::new()), status: Arc::new(Mutex::new((EmbedStatus { state: EmbedState::Starting, pending_entries: None, last_error: None, next_retry_seconds: None }, None))) };
        let worker = embedder.clone();
        tauri::async_runtime::spawn(async move { worker.run(sidecar).await });
        embedder
    }

    /// Run now, even if backing off (e.g. provider settings changed). Wakes are coalesced.
    pub fn wake(&self) { self.wake.notify_one(); }

    /// Run soon because journal text changed, unless a failing provider is backing off or embeddings are
    /// unavailable; then the scheduled retry picks the new text up, instead of one failed request per save.
    pub fn wake_for_changes(&self) {
        let state = self.status.lock().expect("embed status lock").0.state.clone();
        if should_wake_for_changes(&state) { self.wake.notify_one(); }
    }

    pub fn status(&self) -> EmbedStatus {
        let guard = self.status.lock().expect("embed status lock");
        let mut status = guard.0.clone();
        status.next_retry_seconds = guard.1.map(|at| at.saturating_duration_since(Instant::now()).as_secs());
        status
    }

    fn set(&self, state: EmbedState, pending: Option<u64>, error: Option<String>, retry_at: Option<Instant>) {
        let mut guard = self.status.lock().expect("embed status lock");
        guard.0 = EmbedStatus { state, pending_entries: pending.or(guard.0.pending_entries), last_error: error, next_retry_seconds: None };
        guard.1 = retry_at;
    }

    async fn run(&self, sidecar: SidecarClient) {
        sleep(STARTUP_DELAY).await;
        let mut backoff = BASE_BACKOFF;
        loop {
            self.set(EmbedState::Working, None, None, None);
            let wait = match run_batches(&sidecar, |pending| self.set(EmbedState::Working, Some(pending), None, None)).await {
                RunOutcome::Done => { backoff = BASE_BACKOFF; self.set(EmbedState::UpToDate, Some(0), None, None); IDLE_RECHECK }
                RunOutcome::Unavailable(reason) => { self.set(EmbedState::Unavailable, None, Some(reason), None); IDLE_RECHECK }
                RunOutcome::Failed(reason) => {
                    let wait = backoff;
                    warn!(error = %reason, retry_in_seconds = wait.as_secs(), "background embedding failed; backing off");
                    self.set(EmbedState::Waiting, None, Some(reason), Some(Instant::now() + wait));
                    backoff = (backoff * 2).min(MAX_BACKOFF);
                    wait
                }
            };
            let _ = timeout(wait, self.wake.notified()).await;
        }
    }
}

fn should_wake_for_changes(state: &EmbedState) -> bool { !matches!(state, EmbedState::Waiting | EmbedState::Unavailable) }

/// Embed batches until nothing is pending, the provider fails, or the per-run cap is hit (then the next wake continues).
pub async fn run_batches(sidecar: &SidecarClient, mut on_progress: impl FnMut(u64)) -> RunOutcome {
    for batch in 0..MAX_BATCHES_PER_RUN {
        if batch > 0 { sleep(BATCH_PAUSE).await; }
        let result = match sidecar.request("retry_embeddings", serde_json::json!({})).await { Ok(value) => value, Err(error) => return RunOutcome::Failed(error.to_string()) };
        let status = result.get("status").and_then(|s| s.as_str()).unwrap_or("");
        let completed = result.get("completed").and_then(|c| c.as_u64()).unwrap_or(0);
        let pending = result.get("pending_entries").and_then(|p| p.as_u64()).unwrap_or(0);
        let error = result.get("error").and_then(|e| e.as_str()).unwrap_or("embedding did not make progress").to_owned();
        match status {
            "complete" => { if completed > 0 { info!(batches = batch + 1, "background embedding up to date"); } return RunOutcome::Done; }
            "unavailable" => return RunOutcome::Unavailable(error),
            "pending" if completed > 0 => on_progress(pending),
            _ => return RunOutcome::Failed(error),
        }
    }
    RunOutcome::Done
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::tests::fake_daemon_dir;

    /// Replies to successive retry_embeddings calls with the given results, in order.
    fn daemon_replying(name: &str, replies: &[serde_json::Value]) -> SidecarClient {
        let script = format!("import json, sys\nreplies = {}\nfor n, line in enumerate(sys.stdin):\n    request = json.loads(line)\n    print(json.dumps({{\"jsonrpc\": \"2.0\", \"id\": request[\"id\"], \"result\": replies[min(n, len(replies) - 1)]}}), flush=True)\n", serde_json::to_string(replies).unwrap().replace("true", "True").replace("false", "False").replace("null", "None"));
        let dir = fake_daemon_dir(name, &script);
        SidecarClient::new(dir.clone(), dir.join("Journal"))
    }

    #[test]
    fn file_changes_do_not_cut_backoff_short() {
        assert!(should_wake_for_changes(&EmbedState::UpToDate));
        assert!(should_wake_for_changes(&EmbedState::Working));
        assert!(!should_wake_for_changes(&EmbedState::Waiting));
        assert!(!should_wake_for_changes(&EmbedState::Unavailable));
    }

    #[tokio::test]
    async fn keeps_going_while_batches_make_progress() {
        let client = daemon_replying("progress", &[
            serde_json::json!({"status": "pending", "completed": 32, "pending_entries": 5}),
            serde_json::json!({"status": "pending", "completed": 32, "pending_entries": 2}),
            serde_json::json!({"status": "complete", "completed": 10, "pending_entries": 0}),
        ]);
        let mut seen = Vec::new();
        assert_eq!(run_batches(&client, |p| seen.push(p)).await, RunOutcome::Done);
        assert_eq!(seen, [5, 2]);
    }

    #[tokio::test]
    async fn stops_and_reports_when_provider_fails() {
        let client = daemon_replying("failure", &[serde_json::json!({"status": "pending", "completed": 0, "pending_entries": 3, "error": "Embedding provider unavailable: HTTP 401 (check the API key)"})]);
        assert_eq!(run_batches(&client, |_| {}).await, RunOutcome::Failed("Embedding provider unavailable: HTTP 401 (check the API key)".into()));
    }

    #[tokio::test]
    async fn reports_unavailable_vector_runtime() {
        let client = daemon_replying("unavailable", &[serde_json::json!({"status": "unavailable", "completed": 0, "pending_entries": 3, "error": "needs sqlite-vec"})]);
        assert_eq!(run_batches(&client, |_| {}).await, RunOutcome::Unavailable("needs sqlite-vec".into()));
    }
}
