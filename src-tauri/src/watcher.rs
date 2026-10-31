use std::{collections::HashSet, path::{Path, PathBuf}, sync::mpsc, thread, time::Duration};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tracing::{error, info, warn};
use crate::{embedder::Embedder, sidecar::SidecarClient};

/// Rust owns filesystem watching; the daemon only receives validated journal-relative paths.
pub fn start(journal_root: PathBuf, sidecar: SidecarClient, embedder: Embedder) {
    thread::spawn(move || {
        let (sender, receiver) = mpsc::channel();
        let mut watcher = match RecommendedWatcher::new(sender, Config::default()) { Ok(watcher) => watcher, Err(error) => { error!(%error, "journal watcher failed to start"); return; } };
        if let Err(error) = watcher.watch(&journal_root, RecursiveMode::Recursive) { error!(%error, "journal watcher failed to watch root"); return; }
        info!(path = %journal_root.display(), "journal watcher started");
        loop {
            let event = match receiver.recv() { Ok(Ok(event)) => event, Ok(Err(error)) => { warn!(%error, "journal watcher error"); continue; }, Err(_) => return };
            let mut paths = paths_for(event, &journal_root);
            while let Ok(next) = receiver.recv_timeout(Duration::from_millis(1500)) { match next { Ok(event) => paths.extend(paths_for(event, &journal_root)), Err(error) => warn!(%error, "journal watcher error") } }
            for path in paths { let client = sidecar.clone(); let exists = journal_root.join(&path).exists(); tauri::async_runtime::block_on(async move { let result = if Path::new(&path).extension().is_none_or(|ext| !ext.eq_ignore_ascii_case("md")) { Ok(serde_json::Value::Null) } else if exists { client.index_file(&path).await } else { client.remove_file(&path).await }; if let Err(error) = result { warn!(%error, %path, "background journal indexing failed"); } }); }
            // Newly indexed text is marked pending; let the embedder pick it up (no-op if nothing is pending).
            embedder.wake_for_changes();
        }
    });
}

fn paths_for(event: Event, root: &Path) -> HashSet<String> {
    let relevant = matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_));
    if !relevant { return HashSet::new(); }
    event.paths.into_iter().filter_map(|path| path.strip_prefix(root).ok().map(|relative| relative.to_string_lossy().replace('\\', "/"))).collect()
}
