# Development

Prerequisites: Node.js 20+, Rust stable with the Tauri macOS prerequisites, and Python 3.12 with `pydantic`, `httpx`, and `sqlite-vec` installed. Use a Python 3.12 interpreter for the app with `JOURNALY_PYTHON=/path/to/python3.12` when it is not the default.

Install frontend dependencies with `npm --prefix frontend install`, then launch with `npm --prefix frontend run tauri`. Run daemon tests with `npm run test:python`.

## Controlled runtime (required for semantic search)

The stock macOS/pyenv Python build disables SQLite extension loading, so `sqlite-vec` can't load there — the daemon degrades gracefully to FTS5-only search in that case, but to actually exercise vector search or the vector-path tests you need an extension-capable Python. `scripts/create_controlled_runtime.sh` provisions one at `ai_daemon/.runtime/arm64` using a Homebrew Python 3.12 (arm64); `scripts/validate_runtime.py` checks it end-to-end (FTS5, extension loading, `sqlite-vec` load, `vec0` create/insert/KNN). Point `JOURNALY_PYTHON` at `ai_daemon/.runtime/arm64/bin/python` to run the app or tests against it.

## Running tests

Two test locations exist:

- `ai_daemon/tests/` — unit tests for indexing, hashing, chunking, embeddings, fusion, temporal reranking, context assembly/citation validation, and chat, run with `python -m pytest ai_daemon/tests -q`.
- `tests/` (repo root) — the RAG evaluation harness (`tests/eval_set.json`, `tests/fixtures/Journal/`, `tests/rag/test_eval.py`), run with `python -m pytest tests -q`.

Run both from the repo root (not from inside `ai_daemon/`) so `ai_daemon` resolves as an importable package. Some tests are guarded with `unittest.skipUnless(vector_extension_available(), ...)` (see `ai_daemon/tests/support.py`) and only run on an extension-capable interpreter like `ai_daemon/.runtime/arm64/bin/python`; they're silently skipped, not failed, on a stock Python.

## Journal location

Set `JOURNALY_JOURNAL_DIR` when launching the app to use a different journal folder (default: `Journal/` at the repo root). Rust reads it and passes it to the Python daemon, so both always use the same directory.
