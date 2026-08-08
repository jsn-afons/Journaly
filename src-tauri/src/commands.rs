use tauri::State;
use crate::{errors::AppError, journal::{EntrySummary, JournalEntry}, sidecar::HealthResponse, state::AppState};

#[tauri::command]
pub async fn health_check(state: State<'_, AppState>) -> Result<HealthResponse, AppError> { state.sidecar.health().await }

#[tauri::command] pub fn list_entries(state: State<'_, AppState>) -> Result<Vec<EntrySummary>, AppError> { state.journal.list_entries() }
#[tauri::command] pub fn create_entry(title: String, content: String, state: State<'_, AppState>) -> Result<JournalEntry, AppError> { state.journal.create_entry(&title, &content) }
#[tauri::command] pub fn get_entry(path: String, state: State<'_, AppState>) -> Result<JournalEntry, AppError> { state.journal.get_entry(&path) }
#[tauri::command] pub fn save_entry(path: String, content: String, expected_content: Option<String>, state: State<'_, AppState>) -> Result<JournalEntry, AppError> { state.journal.save_entry(&path, &content, expected_content.as_deref()) }
#[tauri::command] pub fn rename_entry(path: String, title: String, state: State<'_, AppState>) -> Result<JournalEntry, AppError> { state.journal.rename_entry(&path, &title) }
#[tauri::command] pub fn delete_entry(path: String, state: State<'_, AppState>) -> Result<(), AppError> { state.journal.delete_entry(&path) }
#[tauri::command] pub fn search_journal(query: String, state: State<'_, AppState>) -> Result<Vec<EntrySummary>, AppError> { state.journal.search_files(&query) }
