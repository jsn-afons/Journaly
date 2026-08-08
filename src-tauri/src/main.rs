mod commands;
mod errors;
mod journal;
mod sidecar;
mod state;

use std::path::PathBuf;
use state::AppState;
use sidecar::SidecarClient;
use journal::JournalService;

fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let daemon_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let journal_root = std::env::var_os("JOURNALY_JOURNAL_DIR").map(PathBuf::from).unwrap_or_else(|| daemon_dir.join("Journal"));
    let journal = JournalService::new(journal_root).expect("unable to initialize configured Journal directory");
    tauri::Builder::default()
        .manage(AppState { sidecar: SidecarClient::new(daemon_dir), journal })
        .invoke_handler(tauri::generate_handler![commands::health_check, commands::list_entries, commands::create_entry, commands::get_entry, commands::save_entry, commands::rename_entry, commands::delete_entry, commands::search_journal])
        .run(tauri::generate_context!())
        .expect("error while running Journaly");
}
