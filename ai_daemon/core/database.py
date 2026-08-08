"""Disposable SQLite index. It intentionally stores no canonical journal content."""
from __future__ import annotations
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY, filepath TEXT NOT NULL UNIQUE, content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, modified_at TEXT NOT NULL, pending_embedding INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, heading_path TEXT NOT NULL, raw_content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  UNIQUE(entry_id, chunk_index)
);
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(chunk_id UNINDEXED, entry_id UNINDEXED, heading, content);
CREATE INDEX IF NOT EXISTS idx_chunks_entry_id ON chunks(entry_id);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON journal_entries(created_at);
"""

class JournalDatabase:
    def __init__(self, path: Path) -> None: self.path = path
    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(SCHEMA)
        try: yield connection; connection.commit()
        except Exception: connection.rollback(); raise
        finally: connection.close()
