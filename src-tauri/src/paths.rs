use std::{fs, io::{self, Write}, path::{Component, Path, PathBuf}};
use uuid::Uuid;
use crate::errors::AppError;

/// A directory whose Markdown files the app reads and writes (the journal, saved chats). Every path coming from the UI
/// is checked here so it can't escape the directory (`..`, absolute paths, symlinks pointing outside).
#[derive(Clone)]
pub struct Folder { root: PathBuf }

impl Folder {
    pub fn new(root: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&root).map_err(AppError::journal)?;
        let root = root.canonicalize().map_err(AppError::journal)?;
        Ok(Self { root })
    }
    pub fn root(&self) -> &Path { &self.root }
    pub fn valid_relative(&self, value: &str) -> Result<PathBuf, AppError> { let path = PathBuf::from(value); if path.extension().is_none_or(|e| !e.eq_ignore_ascii_case("md")) || path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_))) { return Err(AppError::PathOutsideJournal); } Ok(path) }
    pub fn resolve_existing(&self, relative: &Path) -> Result<PathBuf, AppError> { let path = self.root.join(relative).canonicalize().map_err(AppError::journal)?; if path.starts_with(&self.root) { Ok(path) } else { Err(AppError::PathOutsideJournal) } }
    pub fn resolve_new(&self, relative: &Path) -> Result<PathBuf, AppError> { let path = self.root.join(relative); let parent = path.parent().ok_or(AppError::PathOutsideJournal)?; let canonical_parent = parent.canonicalize().unwrap_or_else(|_| self.root.clone()); if canonical_parent.starts_with(&self.root) { Ok(path) } else { Err(AppError::PathOutsideJournal) } }
    /// `Title.md`, or `Title 2.md`, `Title 3.md`… if taken.
    pub fn available_path(&self, desired: PathBuf) -> Result<PathBuf, AppError> { let stem = desired.file_stem().and_then(|s| s.to_str()).ok_or_else(|| AppError::InvalidTitle("invalid title".into()))?; let parent = desired.parent().unwrap_or(Path::new("")); for number in 1..10_000 { let candidate = if number == 1 { desired.clone() } else { parent.join(format!("{stem} {number}.md")) }; if !self.root.join(&candidate).exists() { return Ok(candidate); } } Err(AppError::InvalidTitle("too many entries with this title".into())) }
    /// Write via a temp file + rename, so a crash never leaves a half-written file.
    pub fn write(&self, relative: &Path, contents: &str) -> Result<(), AppError> {
        let target = self.resolve_new(relative)?; let parent = target.parent().ok_or(AppError::PathOutsideJournal)?; fs::create_dir_all(parent).map_err(AppError::journal)?;
        atomic_write(&target, contents.as_bytes()).map_err(AppError::journal)
    }
}

pub fn atomic_write(target: &Path, bytes: &[u8]) -> io::Result<()> { let parent = target.parent().ok_or_else(|| io::Error::other("no parent"))?; let temp = parent.join(format!(".{}.{}.tmp", target.file_name().and_then(|x| x.to_str()).unwrap_or("entry"), Uuid::new_v4())); let mut file = fs::File::create(&temp)?; file.write_all(bytes)?; file.sync_all()?; fs::rename(temp, target) }
pub fn sanitize_title(input: &str) -> Result<String, AppError> { let title = input.trim().replace(['/', '\\', ':'], "-"); if title.is_empty() || title == "." || title == ".." { Err(AppError::InvalidTitle("title is required".into())) } else { Ok(title.chars().take(120).collect()) } }
pub fn display_title(path: &Path) -> String { path.file_stem().and_then(|x| x.to_str()).unwrap_or("Untitled").to_owned() }
pub fn path_string(path: &Path) -> String { path.to_string_lossy().replace('\\', "/") }
