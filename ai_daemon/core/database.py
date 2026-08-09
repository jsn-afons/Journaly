"""Disposable SQLite index. It intentionally stores no canonical journal content."""
from __future__ import annotations
import logging
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

logger = logging.getLogger(__name__)

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
CREATE TABLE IF NOT EXISTS index_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chunk_retrievals (chunk_id TEXT NOT NULL, retrieved_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_chunk_retrievals_chunk_id ON chunk_retrievals(chunk_id);
"""

class JournalDatabase:
    """Owns schema lifecycle, including the sqlite-vec vector index.

    sqlite-vec is loaded as a runtime extension, which the stock macOS/python.org
    Python build disables (see docs/rag.md). Every code path here degrades to
    FTS5-only behavior instead of raising when the extension is unavailable —
    losing semantic search must never take down keyword search or the journal.
    """

    def __init__(self, path: Path, embedding_model: str = "text-embedding-3-small", embedding_dimensions: int = 1536) -> None:
        self.path = path
        self.embedding_model = embedding_model
        self.embedding_dimensions = embedding_dimensions

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(SCHEMA)
        if self._load_vector_extension(connection):
            self._ensure_vector_schema(connection)
        try: yield connection; connection.commit()
        except Exception: connection.rollback(); raise
        finally: connection.close()

    def _load_vector_extension(self, connection: sqlite3.Connection) -> bool:
        try:
            import sqlite_vec
        except ImportError:
            logger.warning("sqlite-vec is not installed; semantic search is unavailable")
            return False
        try:
            connection.enable_load_extension(True)
            sqlite_vec.load(connection)
            connection.enable_load_extension(False)
            return True
        except (AttributeError, sqlite3.OperationalError) as error:
            logger.warning("sqlite-vec extension could not be loaded (%s); falling back to FTS5-only search", error)
            return False

    def _ensure_vector_schema(self, connection: sqlite3.Connection) -> None:
        """Create/recreate docs_vec so its dimension always matches the configured model (AGENT.md sec.22).

        A model or dimension change makes existing vectors incomparable, not the Markdown they were
        derived from — so this only ever touches derived tables and re-arms pending_embedding.
        """
        existing_model = connection.execute("SELECT value FROM index_metadata WHERE key = 'embedding_model'").fetchone()
        existing_dimensions = connection.execute("SELECT value FROM index_metadata WHERE key = 'embedding_dimensions'").fetchone()
        table_exists = connection.execute("SELECT 1 FROM sqlite_master WHERE name = 'docs_vec'").fetchone()
        compatible = (
            table_exists
            and existing_model is not None and existing_model["value"] == self.embedding_model
            and existing_dimensions is not None and existing_dimensions["value"] == str(self.embedding_dimensions)
        )
        if compatible: return
        if table_exists:
            logger.warning("embedding model/dimensions changed (%s); rebuilding vector index", existing_model["value"] if existing_model else "none")
            connection.execute("DROP TABLE docs_vec")
        connection.execute(f"CREATE VIRTUAL TABLE docs_vec USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[{self.embedding_dimensions}])")
        connection.execute("UPDATE journal_entries SET pending_embedding = 1")
        connection.execute("INSERT INTO index_metadata(key, value) VALUES ('embedding_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (self.embedding_model,))
        connection.execute("INSERT INTO index_metadata(key, value) VALUES ('embedding_dimensions', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (str(self.embedding_dimensions),))

    @staticmethod
    def vector_ready(connection: sqlite3.Connection) -> bool:
        try:
            connection.execute("SELECT 1 FROM docs_vec LIMIT 0")
            return True
        except sqlite3.OperationalError:
            return False
