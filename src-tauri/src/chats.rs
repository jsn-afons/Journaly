use std::{fs, path::{Path, PathBuf}};
use chrono::{DateTime, Utc};
use serde::Serialize;
use crate::{errors::AppError, paths::{path_string, sanitize_title, Folder}};

/// Saved conversations with the journal AI, one Markdown file each in `Chats/YYYY/MM/`. The file format belongs to the
/// UI (`frontend/src/lib/chats.ts`); Rust only stores files safely and reads `title`/`updated_at` from the frontmatter
/// to list them. Kept outside the journal folder so chats are never indexed and fed back to the AI as journal entries.
#[derive(Clone)]
pub struct ChatStore { folder: Folder }

#[derive(Debug, Clone, Serialize)]
pub struct ChatSummary { pub path: String, pub title: String, pub updated_at: DateTime<Utc> }

impl ChatStore {
    pub fn new(root: PathBuf) -> Result<Self, AppError> { Ok(Self { folder: Folder::new(root)? }) }

    /// Newest first.
    pub fn list(&self) -> Result<Vec<ChatSummary>, AppError> {
        let mut chats = Vec::new(); self.collect(self.folder.root().to_path_buf(), &mut chats)?;
        chats.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.path.cmp(&b.path)));
        Ok(chats)
    }

    pub fn create(&self, title: &str, document: &str) -> Result<ChatSummary, AppError> {
        let name: String = sanitize_title(title)?.chars().take(60).collect();
        let relative = self.folder.available_path(PathBuf::from(Utc::now().format("%Y/%m").to_string()).join(format!("{}.md", name.trim())))?;
        self.folder.write(&relative, document)?; self.summary(&relative)
    }

    pub fn get(&self, relative: &str) -> Result<String, AppError> {
        let relative = self.folder.valid_relative(relative)?; fs::read_to_string(self.folder.resolve_existing(&relative)?).map_err(AppError::journal)
    }

    pub fn save(&self, relative: &str, document: &str) -> Result<ChatSummary, AppError> {
        let relative = self.folder.valid_relative(relative)?; self.folder.resolve_existing(&relative)?; // must already exist
        self.folder.write(&relative, document)?; self.summary(&relative)
    }

    pub fn delete(&self, relative: &str) -> Result<(), AppError> {
        fs::remove_file(self.folder.resolve_existing(&self.folder.valid_relative(relative)?)?).map_err(AppError::journal)
    }

    fn collect(&self, directory: PathBuf, output: &mut Vec<ChatSummary>) -> Result<(), AppError> {
        for item in fs::read_dir(directory).map_err(AppError::journal)? {
            let path = item.map_err(AppError::journal)?.path();
            if path.is_dir() { self.collect(path, output)?; }
            else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("md")) {
                let relative = path.strip_prefix(self.folder.root()).map_err(|_| AppError::PathOutsideJournal)?;
                output.push(self.summary(relative)?);
            }
        }
        Ok(())
    }

    fn summary(&self, relative: &Path) -> Result<ChatSummary, AppError> {
        let full = self.folder.resolve_existing(relative)?; let raw = fs::read_to_string(&full).map_err(AppError::journal)?;
        let (title, updated_at) = frontmatter(&raw);
        let modified = || fs::metadata(&full).and_then(|m| m.modified()).map(DateTime::<Utc>::from).unwrap_or_else(|_| Utc::now());
        let fallback = relative.file_stem().and_then(|s| s.to_str()).unwrap_or("Chat").to_owned();
        Ok(ChatSummary { path: path_string(relative), title: title.unwrap_or(fallback), updated_at: updated_at.unwrap_or_else(modified) })
    }
}

/// `title` (a JSON-quoted string) and `updated_at` from the frontmatter, if present and valid.
fn frontmatter(raw: &str) -> (Option<String>, Option<DateTime<Utc>>) {
    let Some((header, _)) = raw.strip_prefix("---\n").and_then(|rest| rest.split_once("\n---")) else { return (None, None) };
    let mut title = None; let mut updated = None;
    for line in header.lines() {
        if let Some(value) = line.strip_prefix("title:") { title = serde_json::from_str::<String>(value.trim()).ok().or_else(|| Some(value.trim().to_owned())).filter(|t| !t.is_empty()); }
        if let Some(value) = line.strip_prefix("updated_at:") { updated = DateTime::parse_from_rfc3339(value.trim()).ok().map(|d| d.with_timezone(&Utc)); }
    }
    (title, updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    fn store() -> (ChatStore, PathBuf) { let root = std::env::temp_dir().join(format!("journaly-chats-{}", Uuid::new_v4())); (ChatStore::new(root.clone()).unwrap(), root) }
    const DOC: &str = "---\ntitle: \"What did I say about: Chelsea?\"\ncreated_at: 2026-10-31T15:00:00.000Z\nupdated_at: 2026-10-31T15:05:00.000Z\n---\n\nbody";

    #[test]
    fn creates_lists_saves_and_deletes() {
        let (chats, root) = store();
        let created = chats.create("What did I say about: Chelsea?", DOC).unwrap();
        assert_eq!(created.path, format!("{}/What did I say about- Chelsea?.md", Utc::now().format("%Y/%m")));
        assert_eq!(created.title, "What did I say about: Chelsea?");
        let newer = DOC.replace("15:05:00", "16:00:00");
        let second = chats.create("Another", &newer).unwrap();
        assert_eq!(chats.list().unwrap().iter().map(|c| c.path.clone()).collect::<Vec<_>>(), vec![second.path.clone(), created.path.clone()]);
        chats.save(&created.path, "---\ntitle: \"Renamed\"\nupdated_at: 2026-11-01T00:00:00Z\n---\n").unwrap();
        assert_eq!(chats.list().unwrap()[0].title, "Renamed");
        assert_eq!(chats.get(&second.path).unwrap(), newer);
        chats.delete(&second.path).unwrap();
        assert_eq!(chats.list().unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_paths_outside_the_chats_folder_and_unknown_files() {
        let (chats, root) = store();
        assert!(chats.get("../Journal/secret.md").is_err());
        assert!(chats.save("/etc/passwd.md", "x").is_err());
        assert!(chats.save("2026/10/Missing.md", "x").is_err()); // save never creates files
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn files_without_frontmatter_still_list() {
        let (chats, root) = store();
        fs::create_dir_all(root.join("2026/10")).unwrap(); fs::write(root.join("2026/10/Hand made.md"), "just text").unwrap();
        assert_eq!(chats.list().unwrap()[0].title, "Hand made");
        fs::remove_dir_all(root).unwrap();
    }
}
