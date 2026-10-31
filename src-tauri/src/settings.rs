//! User-editable AI provider settings. Non-secret values live in a JSON file in the app's config
//! directory (read by the Python daemon via JOURNALY_CONFIG); API keys live in the macOS Keychain
//! and are handed to the daemon only as environment variables when it is spawned (AGENT.md sec.32).
use std::{fs, io::Write, path::PathBuf};
use serde::{Deserialize, Serialize};
use crate::errors::AppError;

const KEYCHAIN_SERVICE: &str = "com.journaly.app";

/// Field names match the daemon's `DaemonConfig` file keys exactly; the daemon rejects unknown keys.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ProviderSettings {
    pub chat_base_url: String,
    pub chat_model: String,
    pub embedding_base_url: String,
    pub embedding_model: String,
    pub embedding_dimensions: u32,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self { chat_base_url: "https://api.openai.com/v1".into(), chat_model: "gpt-4o-mini".into(), embedding_base_url: "https://api.openai.com/v1".into(), embedding_model: "text-embedding-3-small".into(), embedding_dimensions: 1536 }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role { Chat, Embedding }
impl Role { fn account(self) -> &'static str { match self { Role::Chat => "chat-api-key", Role::Embedding => "embedding-api-key" } } }

/// What the UI receives: settings plus whether a key exists, never the key itself.
#[derive(Serialize)]
pub struct SettingsView { #[serde(flatten)] pub settings: ProviderSettings, pub has_chat_key: bool, pub has_embedding_key: bool, pub configured: bool }

pub fn settings_path() -> PathBuf {
    if let Some(path) = std::env::var_os("JOURNALY_SETTINGS") { return PathBuf::from(path); }
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    home.join("Library/Application Support/com.journaly.app/provider-settings.json")
}

pub fn exists() -> bool { settings_path().is_file() }

pub fn load() -> ProviderSettings {
    fs::read_to_string(settings_path()).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

/// Reject values that would make the daemon fail to start or send requests somewhere unintended.
pub fn validate(settings: &ProviderSettings) -> Result<(), AppError> {
    for (label, url) in [("chat", &settings.chat_base_url), ("embedding", &settings.embedding_base_url)] {
        if !(url.starts_with("http://") || url.starts_with("https://")) { return Err(AppError::InvalidSettings(format!("{label} URL must start with http:// or https://"))); }
    }
    if settings.chat_model.trim().is_empty() || settings.embedding_model.trim().is_empty() { return Err(AppError::InvalidSettings("model names cannot be empty".into())); }
    if settings.embedding_dimensions == 0 || settings.embedding_dimensions > 8192 { return Err(AppError::InvalidSettings("embedding dimensions must be between 1 and 8192".into())); }
    Ok(())
}

/// Atomic write (temp file + rename) so a crash cannot leave a truncated settings file.
pub fn save(settings: &ProviderSettings) -> Result<(), AppError> {
    validate(settings)?;
    let path = settings_path();
    let directory = path.parent().ok_or_else(|| AppError::InvalidSettings("invalid settings path".into()))?;
    fs::create_dir_all(directory).map_err(AppError::journal)?;
    let temporary = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(settings).map_err(|e| AppError::InvalidSettings(e.to_string()))?;
    let mut file = fs::File::create(&temporary).map_err(AppError::journal)?;
    file.write_all(text.as_bytes()).and_then(|_| file.sync_all()).map_err(AppError::journal)?;
    fs::rename(&temporary, &path).map_err(AppError::journal)
}

fn entry(role: Role) -> Result<keyring::Entry, AppError> { keyring::Entry::new(KEYCHAIN_SERVICE, role.account()).map_err(|e| AppError::Keychain(e.to_string())) }

pub fn get_key(role: Role) -> Option<String> { entry(role).ok()?.get_password().ok().filter(|key| !key.is_empty()) }
pub fn set_key(role: Role, key: &str) -> Result<(), AppError> { entry(role)?.set_password(key).map_err(|e| AppError::Keychain(e.to_string())) }
pub fn clear_key(role: Role) -> Result<(), AppError> {
    match entry(role)?.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(e) => Err(AppError::Keychain(e.to_string())) }
}

pub fn view() -> SettingsView {
    SettingsView { settings: load(), has_chat_key: get_key(Role::Chat).is_some(), has_embedding_key: get_key(Role::Embedding).is_some(), configured: exists() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_non_http_urls_and_bad_dimensions() {
        let mut s = ProviderSettings::default();
        assert!(validate(&s).is_ok());
        s.chat_base_url = "file:///etc/passwd".into();
        assert!(validate(&s).is_err());
        s = ProviderSettings::default(); s.embedding_dimensions = 0;
        assert!(validate(&s).is_err());
        s = ProviderSettings::default(); s.chat_model = "  ".into();
        assert!(validate(&s).is_err());
    }
    #[test]
    fn serialized_keys_match_what_the_daemon_accepts() {
        let value = serde_json::to_value(ProviderSettings::default()).unwrap();
        let keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        for key in keys { assert!(["chat_base_url", "chat_model", "embedding_base_url", "embedding_model", "embedding_dimensions"].contains(&key.as_str())); }
    }
}

#[cfg(test)]
mod keychain_tests {
    /// Touches the real macOS Keychain (under a throwaway service name), so it only runs on request: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn keychain_round_trip_and_delete() {
        let entry = keyring::Entry::new("com.journaly.app.test", "round-trip").unwrap();
        entry.set_password("s3cret").unwrap();
        assert_eq!(entry.get_password().unwrap(), "s3cret");
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}
