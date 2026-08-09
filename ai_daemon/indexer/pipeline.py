from __future__ import annotations
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from ai_daemon.core.database import JournalDatabase
from ai_daemon.indexer.chunker import chunk_markdown
from ai_daemon.indexer.parser import parse_or_adopt
from ai_daemon.api.base import EmbeddingProvider, ProviderUnavailable, UnavailableEmbeddingProvider
from ai_daemon.retrieval.search import fts_search

class JournalIndexer:
    def __init__(self, journal_root: Path, database: JournalDatabase, embedding_provider: EmbeddingProvider | None = None, embedding_model: str = "text-embedding-3-small", dimensions: int = 1536) -> None:
        self.root = journal_root.resolve(); self.database = database; self.embedding_provider = embedding_provider or UnavailableEmbeddingProvider(); self.embedding_model = embedding_model; self.dimensions = dimensions
    def index_file(self, relative_path: str) -> dict[str, object]:
        path = self._path(relative_path)
        if not path.exists(): return self.remove_file(relative_path)
        entry = parse_or_adopt(path); digest = hashlib.sha256(path.read_bytes()).hexdigest()
        relative = path.relative_to(self.root).as_posix()
        with self.database.connection() as connection:
            existing = connection.execute("SELECT content_hash FROM journal_entries WHERE filepath = ?", (relative,)).fetchone()
            if existing and existing["content_hash"] == digest: return {"status": "skipped", "path": relative}
            connection.execute("DELETE FROM docs_fts WHERE entry_id = ?", (entry.id,))
            if self.database.vector_ready(connection):
                connection.execute("DELETE FROM docs_vec WHERE chunk_id IN (SELECT id FROM chunks WHERE entry_id = ?)", (entry.id,))
            connection.execute("DELETE FROM chunks WHERE entry_id = ?", (entry.id,))
            connection.execute("INSERT INTO journal_entries(id, filepath, content_hash, created_at, modified_at, pending_embedding) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET filepath=excluded.filepath, content_hash=excluded.content_hash, modified_at=excluded.modified_at, pending_embedding=1", (entry.id, relative, digest, entry.created_at, datetime.now(UTC).isoformat()))
            for chunk in chunk_markdown(entry.content):
                chunk_id = f"{entry.id}:{chunk.chunk_index}"; connection.execute("INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?)", (chunk_id, entry.id, chunk.heading_path, chunk.raw_content, chunk.chunk_index, entry.created_at)); connection.execute("INSERT INTO docs_fts(chunk_id, entry_id, heading, content) VALUES (?, ?, ?, ?)", (chunk_id, entry.id, chunk.heading_path, chunk.raw_content))
        return {"status": "indexed", "path": relative, "chunks": len(chunk_markdown(entry.content)), "embedding_status": "pending"}
    def rebuild(self) -> dict[str, int]:
        total = indexed = failed = pending = 0
        for path in self.root.rglob("*.md"):
            total += 1
            try:
                result = self.index_file(path.relative_to(self.root).as_posix()); indexed += result["status"] == "indexed"; pending += result.get("embedding_status") == "pending"
            except Exception: failed += 1
        return {"files_scanned": total, "files_indexed": indexed, "files_failed": failed, "embeddings_pending": pending}
    def search_keyword(self, query: str) -> list[dict[str, object]]:
        with self.database.connection() as connection:
            return fts_search(connection, query)
    async def retry_embeddings(self, limit: int = 32) -> dict[str, int | str]:
        with self.database.connection() as connection:
            if not self.database.vector_ready(connection): return {"status": "unavailable", "retried": 0, "completed": 0}
            rows = connection.execute("SELECT c.id, c.raw_content FROM chunks c JOIN journal_entries e ON e.id=c.entry_id WHERE e.pending_embedding = 1 ORDER BY e.modified_at LIMIT ?", (limit,)).fetchall()
        if not rows: return {"status": "complete", "retried": 0, "completed": 0}
        try: vectors = await self.embedding_provider.generate_embeddings([row["raw_content"] for row in rows])
        except ProviderUnavailable: return {"status": "pending", "retried": len(rows), "completed": 0}
        if len(vectors) != len(rows) or any(len(vector) != self.dimensions for vector in vectors): return {"status": "pending", "retried": len(rows), "completed": 0}
        with self.database.connection() as connection:
            for row, vector in zip(rows, vectors):
                connection.execute("DELETE FROM docs_vec WHERE chunk_id = ?", (row["id"],))
                connection.execute("INSERT INTO docs_vec(chunk_id, embedding) VALUES (?, ?)", (row["id"], json.dumps(vector)))
            entry_ids = {row["id"].split(":", 1)[0] for row in rows}
            for entry_id in entry_ids:
                remaining = connection.execute("SELECT COUNT(*) FROM chunks c LEFT JOIN docs_vec v ON v.chunk_id=c.id WHERE c.entry_id=? AND v.chunk_id IS NULL", (entry_id,)).fetchone()[0]
                if remaining == 0: connection.execute("UPDATE journal_entries SET pending_embedding=0 WHERE id=?", (entry_id,))
        return {"status": "complete", "retried": len(rows), "completed": len(rows)}
    def remove_file(self, relative_path: str) -> dict[str, object]:
        with self.database.connection() as connection:
            row = connection.execute("SELECT id FROM journal_entries WHERE filepath = ?", (relative_path,)).fetchone()
            if row:
                connection.execute("DELETE FROM docs_fts WHERE entry_id = ?", (row["id"],))
                if self.database.vector_ready(connection):
                    connection.execute("DELETE FROM docs_vec WHERE chunk_id IN (SELECT id FROM chunks WHERE entry_id = ?)", (row["id"],))
                connection.execute("DELETE FROM journal_entries WHERE id = ?", (row["id"],))
        return {"status": "removed", "path": relative_path}
    def _path(self, relative_path: str) -> Path:
        path = (self.root / relative_path).resolve()
        if self.root not in path.parents and path != self.root: raise ValueError("path outside journal root")
        return path
