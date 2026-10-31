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

/// Where things live. `tauri dev` (a debug build) keeps working from the source folder as before. The installed app
/// (a release build) must not depend on the source folder, so it uses normal Mac locations: your writing in
/// ~/Documents/Journaly, internal files (search index, settings) in ~/Library/Application Support/com.journaly.app,
/// and the AI service bundled inside the .app. JOURNALY_JOURNAL_DIR / JOURNALY_CHATS_DIR override either way.
struct Locations { journal: PathBuf, chats: PathBuf, work_dir: PathBuf, bundled_daemon: Option<PathBuf> }

impl Locations {
    fn detect() -> Self {
        if cfg!(debug_assertions) {
            let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
            return Self { journal: repo.join("Journal"), chats: repo.join("Chats"), work_dir: repo, bundled_daemon: None };
        }
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
        let documents = home.join("Documents/Journaly");
        let work_dir = settings::settings_path().parent().map(PathBuf::from).unwrap_or_else(|| home.join("Library/Application Support/com.journaly.app"));
        // Journaly.app/Contents/MacOS/journaly -> Journaly.app/Contents/Resources/journaly-ai/journaly-ai
        let daemon = std::env::current_exe().ok().and_then(|exe| exe.parent()?.parent().map(|contents| contents.join("Resources/journaly-ai/journaly-ai")));
        Self { journal: documents.join("Journal"), chats: documents.join("Chats"), work_dir, bundled_daemon: daemon }
    }
}

fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let places = Locations::detect();
    let journal_root = std::env::var_os("JOURNALY_JOURNAL_DIR").map(PathBuf::from).unwrap_or(places.journal);
    let journal = JournalService::new(journal_root.clone()).expect("unable to initialize configured Journal directory");
    let chats_root = std::env::var_os("JOURNALY_CHATS_DIR").map(PathBuf::from).unwrap_or(places.chats);
    let chats = chats::ChatStore::new(chats_root).expect("unable to initialize the Chats directory");
    std::fs::create_dir_all(&places.work_dir).expect("unable to create the app data directory");
    let sidecar = match places.bundled_daemon {
        Some(executable) => SidecarClient::bundled(executable, places.work_dir, journal_root.clone()),
        None => SidecarClient::new(places.work_dir, journal_root.clone()),
    };
    let embedder = embedder::Embedder::start(sidecar.clone());
    watcher::start(journal_root, sidecar.clone(), embedder.clone());
    tauri::Builder::default()
        .manage(AppState { sidecar, journal, embedder, chats })
        .invoke_handler(tauri::generate_handler![commands::health_check, commands::list_entries, commands::create_entry, commands::get_entry, commands::save_entry, commands::rename_entry, commands::delete_entry, commands::search_journal, commands::ai_search_keyword, commands::ai_search_hybrid, commands::ai_chat, commands::ai_chat_stream, commands::ai_retry_embeddings, commands::ai_index_status, commands::get_provider_settings, commands::save_provider_settings, commands::test_provider, commands::list_provider_models, commands::embedding_status, commands::list_chats, commands::get_chat, commands::create_chat, commands::save_chat, commands::delete_chat])
        .run(tauri::generate_context!())
        .expect("error while running Journaly");
}
