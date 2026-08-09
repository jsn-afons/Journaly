# Database

`journal_index.db` is derived data, not the journal. It uses WAL mode and foreign keys and can be regenerated from `Journal/` using `rebuild_index`.

Current tables:

- `journal_entries`: indexed path, immutable entry ID/creation time, content hash, modification time, and embedding-pending state.
- `chunks`: heading-aware Markdown chunks tied to an entry.
- `docs_fts`: FTS5 search index for deterministic BM25 search.
- `docs_vec`: a `sqlite-vec` `vec0` virtual table (`chunk_id TEXT PRIMARY KEY, embedding float[N]`) holding embeddings for semantic KNN search. Only created/queried when the `sqlite-vec` extension can actually be loaded in the current Python (see `docs/rag.md`); otherwise the daemon simply runs in FTS5-only mode. `vec0` has no `UPSERT`/foreign-key support, so `retry_embeddings` does an explicit delete-then-insert, and `index_file`/`remove_file` explicitly delete matching `docs_vec` rows before deleting the `chunks` they reference (no cascading FK exists on the virtual table).
- `index_metadata`: key/value store recording the `embedding_model` and `embedding_dimensions` that `docs_vec` was built with. `JournalDatabase._ensure_vector_schema` compares this against the configured model/dimensions on every connection; on a mismatch it drops and recreates `docs_vec` at the new dimension and marks every `journal_entries` row `pending_embedding=1` again. This only ever touches derived vector data — Markdown files and FTS5 are never affected by an embedding model change (AGENT.md sec.22).
- `chunk_retrievals`: append-only log of `(chunk_id, retrieved_at)` rows, written every time a chunk is returned by `search_hybrid`/`chat`. This is what feeds the "recurrence" term in temporal reranking (`docs/rag.md`) — how often a thought has actually been revisited, not just how old it is.

When a Markdown file's SHA-256 matches its indexed hash, parsing and embedding work are skipped.

## Extension loading

`JournalDatabase.connection()` attempts to load the `sqlite-vec` extension on every connection (`enable_load_extension` + `sqlite_vec.load`). If that fails — either because `sqlite_vec` isn't installed or because the interpreter's SQLite build disables extension loading — it's caught, logged as a warning, and the base schema (`journal_entries`, `chunks`, `docs_fts`, etc.) still initializes normally. `JournalDatabase.vector_ready(connection)` is the cheap way callers check whether `docs_vec` is actually usable on the current connection, rather than trusting a cached flag that could go stale across process/connection boundaries.

## What's left

This file and the schema it describes were updated and are believed accurate as of this session, but the final combined test run (`ai_daemon/tests` + the new `tests/rag/test_eval.py`) that would confirm the `docs_vec`/`index_metadata` rebuild-on-mismatch behavior end-to-end was not completed — see `docs/rag.md`'s "What's left" section.
