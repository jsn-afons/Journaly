use std::{fs, io::{self, Write}, path::{Component, Path, PathBuf}};
use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;
use crate::errors::AppError;

#[derive(Debug, Clone, Serialize)]
pub struct EntrySummary { pub id: Uuid, pub path: String, pub title: String, pub created_at: DateTime<Utc> }
#[derive(Debug, Clone, Serialize)]
pub struct JournalEntry { #[serde(flatten)] pub summary: EntrySummary, pub content: String }

#[derive(Clone)]
pub struct JournalService { root: PathBuf }

impl JournalService {
    pub fn new(root: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&root).map_err(AppError::journal)?;
        let root = root.canonicalize().map_err(AppError::journal)?;
        Ok(Self { root })
    }

    pub fn list_entries(&self) -> Result<Vec<EntrySummary>, AppError> {
        let mut entries = Vec::new(); self.collect_entries(&self.root, &mut entries)?;
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.path.cmp(&b.path)));
        Ok(entries)
    }

    pub fn create_entry(&self, title: &str, content: &str) -> Result<JournalEntry, AppError> {
        let now = Utc::now(); let safe_title = sanitize_title(title)?;
        let relative = PathBuf::from(now.format("%Y/%m").to_string()).join(format!("{safe_title}.md"));
        let relative = self.available_path(relative)?;
        let entry = JournalEntry { summary: EntrySummary { id: Uuid::new_v4(), path: path_string(&relative), title: display_title(&relative), created_at: now }, content: content.to_owned() };
        self.write_entry(&relative, &entry)?; Ok(entry)
    }

    pub fn get_entry(&self, relative: &str) -> Result<JournalEntry, AppError> {
        let relative = self.valid_relative(relative)?; self.read_entry(&relative)
    }

    pub fn save_entry(&self, relative: &str, content: &str, expected_content: Option<&str>) -> Result<JournalEntry, AppError> {
        let relative = self.valid_relative(relative)?; let current = self.read_entry(&relative)?;
        if let Some(expected) = expected_content { if current.content != expected { return Err(AppError::Conflict); } }
        let entry = JournalEntry { content: content.to_owned(), ..current };
        self.write_entry(&relative, &entry)?; Ok(entry)
    }

    pub fn rename_entry(&self, relative: &str, title: &str) -> Result<JournalEntry, AppError> {
        let old = self.valid_relative(relative)?; let entry = self.read_entry(&old)?; let new_name = sanitize_title(title)?;
        let new = self.available_path(old.parent().unwrap_or(Path::new("")).join(format!("{new_name}.md")))?;
        let from = self.resolve_existing(&old)?; let to = self.resolve_new(&new)?;
        fs::rename(from, to).map_err(AppError::journal)?;
        Ok(JournalEntry { summary: EntrySummary { path: path_string(&new), title: display_title(&new), ..entry.summary }, ..entry })
    }

    pub fn delete_entry(&self, relative: &str) -> Result<(), AppError> { fs::remove_file(self.resolve_existing(&self.valid_relative(relative)?)?).map_err(AppError::journal) }

    pub fn search_files(&self, query: &str) -> Result<Vec<EntrySummary>, AppError> {
        let needle = query.trim().to_lowercase(); if needle.is_empty() { return Ok(Vec::new()); }
        Ok(self.list_entries()?.into_iter().filter(|entry| entry.title.to_lowercase().contains(&needle) || self.read_entry(Path::new(&entry.path)).map(|e| e.content.to_lowercase().contains(&needle)).unwrap_or(false)).collect())
    }

    fn collect_entries(&self, directory: &Path, output: &mut Vec<EntrySummary>) -> Result<(), AppError> {
        for item in fs::read_dir(directory).map_err(AppError::journal)? { let path = item.map_err(AppError::journal)?.path(); if path.is_dir() { self.collect_entries(&path, output)?; } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("md")) { let relative = path.strip_prefix(&self.root).map_err(|_| AppError::PathOutsideJournal)?.to_path_buf(); output.push(self.read_entry(&relative)?.summary); } } Ok(())
    }
    fn read_entry(&self, relative: &Path) -> Result<JournalEntry, AppError> {
        let path = self.resolve_existing(relative)?; let raw = fs::read_to_string(path).map_err(AppError::journal)?;
        if !raw.starts_with("---\n") {
            // Birth time is not portable through Rust's stable metadata API. Discovery time is the documented fallback.
            let adopted = JournalEntry { summary: EntrySummary { id: Uuid::new_v4(), path: path_string(relative), title: display_title(relative), created_at: Utc::now() }, content: raw };
            self.write_entry(relative, &adopted)?;
            return Ok(adopted);
        }
        let (id, created_at, content) = parse_frontmatter(&raw)?;
        Ok(JournalEntry { summary: EntrySummary { id, path: path_string(relative), title: display_title(relative), created_at }, content })
    }
    fn write_entry(&self, relative: &Path, entry: &JournalEntry) -> Result<(), AppError> {
        let target = self.resolve_new(relative)?; let parent = target.parent().ok_or(AppError::PathOutsideJournal)?; fs::create_dir_all(parent).map_err(AppError::journal)?;
        let document = format!("---\nid: {}\ncreated_at: {}\n---\n{}", entry.summary.id, entry.summary.created_at.to_rfc3339(), entry.content);
        atomic_write(&target, document.as_bytes()).map_err(AppError::journal)
    }
    fn valid_relative(&self, value: &str) -> Result<PathBuf, AppError> { let path = PathBuf::from(value); if path.extension().is_none_or(|e| !e.eq_ignore_ascii_case("md")) || path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_))) { return Err(AppError::PathOutsideJournal); } Ok(path) }
    fn resolve_existing(&self, relative: &Path) -> Result<PathBuf, AppError> { let path = self.root.join(relative).canonicalize().map_err(AppError::journal)?; if path.starts_with(&self.root) { Ok(path) } else { Err(AppError::PathOutsideJournal) } }
    fn resolve_new(&self, relative: &Path) -> Result<PathBuf, AppError> { let path = self.root.join(relative); let parent = path.parent().ok_or(AppError::PathOutsideJournal)?; let canonical_parent = parent.canonicalize().unwrap_or_else(|_| self.root.clone()); if canonical_parent.starts_with(&self.root) { Ok(path) } else { Err(AppError::PathOutsideJournal) } }
    fn available_path(&self, desired: PathBuf) -> Result<PathBuf, AppError> { let stem = desired.file_stem().and_then(|s| s.to_str()).ok_or_else(|| AppError::InvalidTitle("invalid title".into()))?; let parent = desired.parent().unwrap_or(Path::new("")); for number in 1..10_000 { let candidate = if number == 1 { desired.clone() } else { parent.join(format!("{stem} {number}.md")) }; if !self.root.join(&candidate).exists() { return Ok(candidate); } } Err(AppError::InvalidTitle("too many entries with this title".into())) }
}

fn parse_frontmatter(raw: &str) -> Result<(Uuid, DateTime<Utc>, String), AppError> {
    let Some(rest) = raw.strip_prefix("---\n") else { return Err(AppError::InvalidFrontmatter("missing frontmatter".into())); };
    let Some((header, body)) = rest.split_once("\n---\n") else { return Err(AppError::InvalidFrontmatter("unterminated frontmatter".into())); };
    let mut id = None; let mut created_at = None;
    for line in header.lines() { if let Some(value) = line.strip_prefix("id:") { id = Some(Uuid::parse_str(value.trim()).map_err(|_| AppError::InvalidFrontmatter("invalid id".into()))?); } if let Some(value) = line.strip_prefix("created_at:") { created_at = Some(DateTime::parse_from_rfc3339(value.trim()).map_err(|_| AppError::InvalidFrontmatter("invalid created_at".into()))?.with_timezone(&Utc)); } }
    Ok((id.ok_or_else(|| AppError::InvalidFrontmatter("missing id".into()))?, created_at.ok_or_else(|| AppError::InvalidFrontmatter("missing created_at".into()))?, body.to_owned()))
}
fn atomic_write(target: &Path, bytes: &[u8]) -> io::Result<()> { let parent = target.parent().ok_or_else(|| io::Error::other("no parent"))?; let temp = parent.join(format!(".{}.{}.tmp", target.file_name().and_then(|x| x.to_str()).unwrap_or("entry"), Uuid::new_v4())); let mut file = fs::File::create(&temp)?; file.write_all(bytes)?; file.sync_all()?; fs::rename(temp, target) }
fn sanitize_title(input: &str) -> Result<String, AppError> { let title = input.trim().replace(['/', '\\', ':'], "-"); if title.is_empty() || title == "." || title == ".." { Err(AppError::InvalidTitle("title is required".into())) } else { Ok(title.chars().take(120).collect()) } }
fn display_title(path: &Path) -> String { path.file_stem().and_then(|x| x.to_str()).unwrap_or("Untitled").to_owned() }
fn path_string(path: &Path) -> String { path.to_string_lossy().replace('\\', "/") }

#[cfg(test)]
mod tests {
    use super::*;
    fn service() -> (JournalService, PathBuf) { let root = std::env::temp_dir().join(format!("journaly-test-{}", Uuid::new_v4())); (JournalService::new(root.clone()).unwrap(), root) }
    #[test] fn creates_collision_safe_files_and_preserves_dates() { let (journal, root) = service(); let first = journal.create_entry("Ideas", "one").unwrap(); let second = journal.create_entry("Ideas", "two").unwrap(); assert_eq!(second.summary.path, format!("{}/Ideas 2.md", Utc::now().format("%Y/%m"))); let saved = journal.save_entry(&first.summary.path, "changed", Some("one")).unwrap(); assert_eq!(saved.summary.created_at, first.summary.created_at); fs::remove_dir_all(root).unwrap(); }
    #[test] fn rejects_traversal_and_detects_conflict() { let (journal, root) = service(); let entry = journal.create_entry("Safe", "first").unwrap(); assert!(journal.get_entry("../secret.md").is_err()); assert!(matches!(journal.save_entry(&entry.summary.path, "second", Some("stale")), Err(AppError::Conflict))); fs::remove_dir_all(root).unwrap(); }
    #[test] fn adopts_external_markdown_without_destroying_content() { let (journal, root) = service(); fs::create_dir_all(root.join("2026/08")).unwrap(); fs::write(root.join("2026/08/External.md"), "# Original\n\nUnchanged body.").unwrap(); let entry = journal.get_entry("2026/08/External.md").unwrap(); assert_eq!(entry.content, "# Original\n\nUnchanged body."); let on_disk = fs::read_to_string(root.join("2026/08/External.md")).unwrap(); assert!(on_disk.contains("created_at:")); assert!(on_disk.ends_with("# Original\n\nUnchanged body.")); fs::remove_dir_all(root).unwrap(); }
}
