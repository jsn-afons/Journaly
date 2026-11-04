use tauri::State;
use crate::{errors::AppError, settings::{self, ProviderSettings, Role, SettingsView}, journal::{EntrySummary, JournalEntry}, sidecar::HealthResponse, state::AppState};

#[tauri::command]
pub async fn health_check(state: State<'_, AppState>) -> Result<HealthResponse, AppError> { state.sidecar.health().await }

// Reads run on a worker thread so a large journal or a Keychain prompt can't freeze the window. Writes stay on one
// thread (plain `fn`): they are quick, and running them in order means two creates can't pick the same file name.
#[tauri::command(async)] pub fn list_entries(state: State<'_, AppState>) -> Result<Vec<EntrySummary>, AppError> { state.journal.list_entries() }
#[tauri::command] pub fn create_entry(title: String, content: String, state: State<'_, AppState>) -> Result<JournalEntry, AppError> { state.journal.create_entry(&title, &content) }
#[tauri::command(async)] pub fn get_entry(path: String, state: State<'_, AppState>) -> Result<JournalEntry, AppError> { state.journal.get_entry(&path) }
#[tauri::command] pub fn save_entry(path: String, content: String, expected_content: Option<String>, state: State<'_, AppState>) -> Result<JournalEntry, AppError> { state.journal.save_entry(&path, &content, expected_content.as_deref()) }
#[tauri::command] pub fn rename_entry(path: String, title: String, state: State<'_, AppState>) -> Result<JournalEntry, AppError> { state.journal.rename_entry(&path, &title) }
#[tauri::command] pub fn delete_entry(path: String, state: State<'_, AppState>) -> Result<(), AppError> { state.journal.delete_entry(&path) }
#[tauri::command(async)] pub fn search_journal(query: String, state: State<'_, AppState>) -> Result<Vec<EntrySummary>, AppError> { state.journal.search_files(&query) }

// AI/RAG passthroughs. Each forwards a single validated RPC to the Python daemon; React never talks to the daemon directly.
#[tauri::command] pub async fn ai_search_keyword(query: String, state: State<'_, AppState>) -> Result<serde_json::Value, AppError> { state.sidecar.request("search_keyword", serde_json::json!({"query": query})).await }
#[tauri::command] pub async fn ai_search_hybrid(query: String, state: State<'_, AppState>) -> Result<serde_json::Value, AppError> { state.sidecar.request("search_hybrid", serde_json::json!({"query": query})).await }
/// One earlier turn of the conversation, so follow-up questions have context. Typed here so only role/content
/// strings reach the daemon, which validates and trims them again (context.py::recent_history).
#[derive(serde::Deserialize, serde::Serialize)]
pub struct ChatTurn { role: String, content: String }

#[tauri::command] pub async fn ai_chat(query: String, history: Option<Vec<ChatTurn>>, state: State<'_, AppState>) -> Result<serde_json::Value, AppError> { state.sidecar.request("chat", serde_json::json!({"query": query, "history": history.unwrap_or_default()})).await }
/// Streaming chat: answer pieces arrive on `on_delta` as they are generated; the return value is the
/// complete, citation-validated result (same shape as `ai_chat`).
#[tauri::command]
pub async fn ai_chat_stream(query: String, history: Option<Vec<ChatTurn>>, on_delta: tauri::ipc::Channel<String>, state: State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    state.sidecar.request_streaming("chat", serde_json::json!({"query": query, "history": history.unwrap_or_default(), "stream": true}), |params| {
        if let Some(text) = params.get("text").and_then(|t| t.as_str()) { let _ = on_delta.send(text.to_owned()); }
    }).await
}
#[tauri::command] pub async fn ai_retry_embeddings(state: State<'_, AppState>) -> Result<serde_json::Value, AppError> { state.sidecar.request("retry_embeddings", serde_json::json!({})).await }
#[tauri::command] pub async fn ai_index_status(state: State<'_, AppState>) -> Result<serde_json::Value, AppError> { state.sidecar.request("get_index_status", serde_json::json!({})).await }

// Provider settings. Keys travel React -> Rust once, go straight into the Keychain, and are never returned.
#[derive(serde::Deserialize)]
pub struct KeyChange { pub role: Role, pub action: KeyAction, pub value: Option<String> }
#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyAction { Set, Clear }

#[tauri::command(async)] pub fn get_provider_settings() -> SettingsView { settings::view() }

#[tauri::command]
pub async fn save_provider_settings(settings: ProviderSettings, key_changes: Vec<KeyChange>, state: State<'_, AppState>) -> Result<SettingsView, AppError> {
    settings::validate(&settings)?;
    for change in key_changes {
        match (change.action, change.value) {
            (KeyAction::Set, Some(value)) if !value.trim().is_empty() => settings::set_key(change.role, value.trim())?,
            (KeyAction::Set, _) => return Err(AppError::InvalidSettings("API key cannot be empty".into())),
            (KeyAction::Clear, _) => settings::clear_key(change.role)?,
        }
    }
    settings::save(&settings)?;
    state.sidecar.restart().await;
    // A new embedding model re-arms every entry as pending; start re-embedding in the background.
    state.embedder.wake();
    Ok(settings::view())
}

/// Checks the *saved* settings by making one tiny real request to each endpoint.
/// `parts` limits the check to "chat" and/or "embedding"; omitted means both.
#[tauri::command] pub async fn test_provider(parts: Option<Vec<String>>, state: State<'_, AppState>) -> Result<serde_json::Value, AppError> { state.sidecar.request("test_provider", serde_json::json!({"parts": parts.unwrap_or_else(|| vec!["chat".into(), "embedding".into()])})).await }

/// Lists model ids an endpoint offers. If `api_key` is omitted the saved key for that role is used.
#[tauri::command]
pub async fn list_provider_models(base_url: String, role: Role, api_key: Option<String>, state: State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    let key = api_key.filter(|k| !k.trim().is_empty()).or_else(|| settings::get_key(role));
    state.sidecar.request("list_models", serde_json::json!({"base_url": base_url, "api_key": key})).await
}

/// Progress of background embedding, for the sidebar.
#[tauri::command] pub fn embedding_status(state: State<'_, AppState>) -> crate::embedder::EmbedStatus { state.embedder.status() }

// Saved chats (see chats.rs). The UI owns the document format; these only store files inside the Chats folder.
#[tauri::command(async)] pub fn list_chats(state: State<'_, AppState>) -> Result<Vec<crate::chats::ChatSummary>, AppError> { state.chats.list() }
#[tauri::command(async)] pub fn get_chat(path: String, state: State<'_, AppState>) -> Result<String, AppError> { state.chats.get(&path) }
#[tauri::command] pub fn create_chat(title: String, document: String, state: State<'_, AppState>) -> Result<crate::chats::ChatSummary, AppError> { state.chats.create(&title, &document) }
#[tauri::command] pub fn save_chat(path: String, document: String, state: State<'_, AppState>) -> Result<crate::chats::ChatSummary, AppError> { state.chats.save(&path, &document) }
#[tauri::command] pub fn delete_chat(path: String, state: State<'_, AppState>) -> Result<(), AppError> { state.chats.delete(&path) }
