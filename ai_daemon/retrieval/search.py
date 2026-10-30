"""Two independent retrieval paths: FTS5/BM25 and sqlite-vec cosine/L2 KNN.

Neither function knows about the other; fusion.py combines their rankings.
"""
from __future__ import annotations
import json
import re
import sqlite3

_WORD_PATTERN = re.compile(r"\w+", re.UNICODE)


def sanitize_fts_query(query: str, match_any: bool = False) -> str | None:
    """FTS5's query parser (not its tokenizer) treats punctuation like ?, -, :, "*" as
    operators, so a natural-language question like "restaurants?" is a syntax error, not
    just an unmatched term. Quoting each extracted word token neutralizes that, at the cost
    of implicit AND-of-terms rather than substring matching — acceptable for a keyword path
    that sits alongside semantic search for recall (AGENT.md sec.16 asks us to verify FTS5
    behavior rather than assume it, not to promise phrase/substring semantics).
    """
    tokens = _WORD_PATTERN.findall(query)
    if not tokens: return None
    # match_any (OR) is for natural-language questions in hybrid/chat: with AND, filler words like
    # "what have I thought about" must all appear and the keyword path returns nothing. BM25 still
    # ranks rarer terms higher, so OR stays meaningful. Plain keyword search keeps AND.
    return (" OR " if match_any else " ").join(f'"{token}"' for token in tokens)


def fts_search(connection: sqlite3.Connection, query: str, limit: int = 25, match_any: bool = False) -> list[dict[str, object]]:
    sanitized = sanitize_fts_query(query, match_any)
    if sanitized is None: return []
    rows = connection.execute(
        "SELECT f.chunk_id, f.entry_id, e.filepath, e.created_at, f.heading, "
        "snippet(docs_fts, 3, '<mark>', '</mark>', '…', 16) AS snippet, bm25(docs_fts) AS score "
        "FROM docs_fts f JOIN journal_entries e ON e.id = f.entry_id "
        "WHERE docs_fts MATCH ? ORDER BY score LIMIT ?",
        (sanitized, limit),
    ).fetchall()
    return [dict(row) for row in rows]


def vector_search(connection: sqlite3.Connection, query_embedding: list[float], limit: int = 25) -> list[dict[str, object]]:
    """Raises sqlite3.OperationalError if docs_vec is unavailable; callers must check vector readiness first."""
    rows = connection.execute(
        "SELECT v.chunk_id, v.distance, c.entry_id, c.heading_path AS heading, c.raw_content, "
        "e.filepath, e.created_at "
        "FROM docs_vec v JOIN chunks c ON c.id = v.chunk_id JOIN journal_entries e ON e.id = c.entry_id "
        "WHERE v.embedding MATCH ? AND k = ? ORDER BY v.distance",
        (json.dumps(query_embedding), limit),
    ).fetchall()
    return [dict(row) for row in rows]


def chunk_lookup(connection: sqlite3.Connection, chunk_ids: list[str]) -> dict[str, dict[str, object]]:
    """Resolve chunk_ids (as surfaced by either search path) to full chunk + entry metadata for context assembly."""
    if not chunk_ids: return {}
    placeholders = ",".join("?" for _ in chunk_ids)
    rows = connection.execute(
        f"SELECT c.id AS chunk_id, c.entry_id, c.heading_path AS heading, c.raw_content, c.created_at, "
        f"e.filepath FROM chunks c JOIN journal_entries e ON e.id = c.entry_id WHERE c.id IN ({placeholders})",
        chunk_ids,
    ).fetchall()
    return {row["chunk_id"]: dict(row) for row in rows}


def record_retrievals(connection: sqlite3.Connection, chunk_ids: list[str], retrieved_at: str) -> None:
    connection.executemany(
        "INSERT INTO chunk_retrievals(chunk_id, retrieved_at) VALUES (?, ?)",
        [(chunk_id, retrieved_at) for chunk_id in chunk_ids],
    )


def recurrence_counts(connection: sqlite3.Connection, chunk_ids: list[str]) -> dict[str, int]:
    if not chunk_ids: return {}
    placeholders = ",".join("?" for _ in chunk_ids)
    rows = connection.execute(
        f"SELECT chunk_id, COUNT(*) AS count FROM chunk_retrievals WHERE chunk_id IN ({placeholders}) GROUP BY chunk_id",
        chunk_ids,
    ).fetchall()
    return {row["chunk_id"]: row["count"] for row in rows}
