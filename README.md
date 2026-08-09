# Journaly

A local-first macOS Markdown journal. Markdown files are the canonical source of truth; search, embeddings, and AI metadata are derived and rebuildable.

## Current status

- **Phase 0 (foundation), Phase 1 (Markdown journal core), Phase 2 (indexing + offline FTS5 search):** done. Journal CRUD with frontmatter/atomic writes, filesystem watching, SHA-256-based skip-unchanged indexing, structural Markdown chunking, and offline BM25 keyword search all work.
- **Phase 3 (embeddings) + Phase 4 (hybrid RAG backend):** implemented this session — sqlite-vec vector storage, hybrid FTS+vector search with Reciprocal Rank Fusion, ACT-R-inspired temporal reranking, prompt-injection-resistant context assembly, citation validation, and a source-grounded `chat` RPC. See [docs/rag.md](docs/rag.md) for the full pipeline and its current limitations.
- **Not started:** the frontend UI for any of the above (Search/Chat/Citation/Inspector components), streaming chat, an Anthropic provider, macOS Keychain integration, database corruption recovery, and a concurrent-edit conflict UI.

## What's left (as of the most recent session)

This is the honest state of things, not a plan — see `docs/rag.md`, `docs/database.md`, and `docs/architecture.md` for the same information broken out by subsystem.

1. **Unconfirmed: the RAG eval harness.** `tests/eval_set.json` + `tests/rag/test_eval.py` (Recall@K over a fixture journal) were written, and a collection-time bug (`TypeError` from an incorrect ABC inheritance in a test stub) was found and fixed, but the fix was **not re-run to confirm it passes**. Run `ai_daemon/.runtime/arm64/bin/python -m pytest tests -q` from the repo root to check.
2. **Not re-verified: the full combined test suite** (`ai_daemon/tests` + `tests/`) on both the extension-capable runtime (`ai_daemon/.runtime/arm64`) and the fallback runtime (`ai_daemon/.venv312`). Each suite was green independently earlier in the session, but not re-run together after the eval harness and its bugfix were added.
3. **Not built at all:** the frontend Search/Chat/Citation/Inspector components (the backend already returns everything the Inspector needs — diagnostics with FTS/vector/RRF/temporal/final results and latencies — it's just not rendered anywhere yet), streaming chat responses, a second LLM provider, Keychain-backed API key storage, startup database corruption recovery, and a UI for resolving concurrent-edit conflicts (Rust already detects the conflict via `commands.rs::save_entry`'s `expected_content` parameter).
4. **No git commit was made** for this session's changes — the working tree has the Phase 3/4 backend work uncommitted, by design (committing wasn't requested).

## Development

See [development documentation](docs/development.md). The project requires Node.js, Rust stable/Tauri prerequisites, and Python 3.12. Semantic search requires an extension-capable Python (see `docs/rag.md`'s sqlite-vec compatibility note) — point `JOURNALY_PYTHON` at `ai_daemon/.runtime/arm64/bin/python` for that; the daemon runs fine without it, just in FTS5-only mode.
