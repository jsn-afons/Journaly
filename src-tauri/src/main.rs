mod chats;
mod commands;
mod embedder;
mod errors;
mod journal;
mod paths;
mod settings;
mod sidecar;
mod state;
mod watcher;

use std::path::PathBuf;
use state::AppState;
use sidecar::SidecarClient;
use journal::JournalService;

fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let daemon_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let journal_root = std::env::var_os("JOURNALY_JOURNAL_DIR").map(PathBuf::from).unwrap_or_else(|| daemon_dir.join("Journal"));
    let journal = JournalService::new(journal_root.clone()).expect("unable to initialize configured Journal directory");
    // Saved chats live next to the journal (not inside it, so they are never indexed as entries).
    let chats_root = std::env::var_os("JOURNALY_CHATS_DIR").map(PathBuf::from).unwrap_or_else(|| journal_root.join("..").join("Chats"));
    let chats = chats::ChatStore::new(chats_root).expect("unable to initialize the Chats directory");
    let sidecar = SidecarClient::new(daemon_dir, journal_root.clone());
    let embedder = embedder::Embedder::start(sidecar.clone());
    watcher::start(journal_root, sidecar.clone(), embedder.clone());
    tauri::Builder::default()
        .manage(AppState { sidecar, journal, embedder, chats })
        .invoke_handler(tauri::generate_handler![commands::health_check, commands::list_entries, commands::create_entry, commands::get_entry, commands::save_entry, commands::rename_entry, commands::delete_entry, commands::search_journal, commands::ai_search_keyword, commands::ai_search_hybrid, commands::ai_chat, commands::ai_chat_stream, commands::ai_retry_embeddings, commands::ai_index_status, commands::get_provider_settings, commands::save_provider_settings, commands::test_provider, commands::list_provider_models, commands::embedding_status, commands::list_chats, commands::get_chat, commands::create_chat, commands::save_chat, commands::delete_chat])
        .run(tauri::generate_context!())
        .expect("error while running Journaly");
}
