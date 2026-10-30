# Journaly

A local-first macOS Markdown journal. Markdown files are the canonical source of truth; search, embeddings, and AI metadata are derived and rebuildable.

## Current status

- **Phases 0–4:** done and committed — journal CRUD, filesystem watching, hash-skipping indexing, structural chunking, FTS5 keyword search, sqlite-vec embeddings, hybrid RRF search, temporal reranking, prompt-injection-resistant context assembly, citation validation, `chat` RPC. See [docs/rag.md](docs/rag.md).
- **Phase 5 (frontend for AI features):** implemented, **uncommitted**. Sidebar, Search (Normal/AI toggle), Chat, Citation popovers, and Inspector components; Rust `ai_*` passthrough commands; structured `{code, message, retryable}` errors from Rust to React. Details in [docs/progress.md](docs/progress.md).
- **Not started:** streaming chat, an Anthropic provider, macOS Keychain integration, database corruption recovery, a conflict-resolution UI, and a UI to resolve or trigger `rebuild_index`/`retry_embeddings`.

Test status (verified this session): `ai_daemon/tests` + `tests/` → 31 passed (extension-capable runtime) / 29 passed + 2 skipped (fallback); `cargo test` 3 passed; frontend `tsc` clean, `vitest` 3 passed, `vite build` succeeds. **Smoke-tested** (see [docs/progress.md](docs/progress.md)): the app launches and spawns the sidecar, and the new UI works against a stubbed bridge. **Not verified:** a real API-key round trip, and the native window's editing/saving flows.

For a running log of what changed and what's next, read [docs/progress.md](docs/progress.md).

## Development

See [development documentation](docs/development.md). The project requires Node.js, Rust stable/Tauri prerequisites, and Python 3.12. Semantic search requires an extension-capable Python (see `docs/rag.md`'s sqlite-vec compatibility note) — point `JOURNALY_PYTHON` at `ai_daemon/.runtime/arm64/bin/python` for that; the daemon runs fine without it, just in FTS5-only mode.
