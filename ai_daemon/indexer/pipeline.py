from __future__ import annotations
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from ai_daemon.core.database import JournalDatabase
from ai_daemon.indexer.chunker import chunk_markdown
from ai_daemon.indexer.parser import parse_or_adopt

class JournalIndexer:
    def __init__(self, journal_root: Path, database: JournalDatabase) -> None: self.root = journal_root.resolve(); self.database = database
    def index_file(self, relative_path: str) -> dict[str, object]:
        path = self._path(relative_path)
        if not path.exists(): return self.remove_file(relative_path)
        entry = parse_or_adopt(path); digest = hashlib.sha256(path.read_bytes()).hexdigest()
        relative = path.relative_to(self.root).as_posix()
        with self.database.connection() as connection:
            existing = connection.execute("SELECT content_hash FROM journal_entries WHERE filepath = ?", (relative,)).fetchone()
            if existing and existing["content_hash"] == digest: return {"status": "skipped", "path": relative}
            connection.execute("DELETE FROM docs_fts WHERE entry_id = ?", (entry.id,)); connection.execute("DELETE FROM chunks WHERE entry_id = ?", (entry.id,))
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
            rows = connection.execute("SELECT f.entry_id, e.filepath, e.created_at, f.heading, snippet(docs_fts, 3, '<mark>', '</mark>', '…', 16) AS snippet, bm25(docs_fts) AS score FROM docs_fts f JOIN journal_entries e ON e.id=f.entry_id WHERE docs_fts MATCH ? ORDER BY score LIMIT 25", (query,)).fetchall()
            return [dict(row) for row in rows]
    def remove_file(self, relative_path: str) -> dict[str, object]:
        with self.database.connection() as connection:
            row = connection.execute("SELECT id FROM journal_entries WHERE filepath = ?", (relative_path,)).fetchone()
            if row: connection.execute("DELETE FROM docs_fts WHERE entry_id = ?", (row["id"],)); connection.execute("DELETE FROM journal_entries WHERE id = ?", (row["id"],))
        return {"status": "removed", "path": relative_path}
    def _path(self, relative_path: str) -> Path:
        path = (self.root / relative_path).resolve()
        if self.root not in path.parents and path != self.root: raise ValueError("path outside journal root")
        return path
