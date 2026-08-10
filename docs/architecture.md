# Architecture

Journaly is a local-first macOS application. Markdown files in `Journal/` are the canonical data store; all SQLite and AI-derived data is rebuildable from them. The frontend communicates only through typed Tauri commands. Rust owns filesystem and OS integration; its sidecar client communicates with Python via line-delimited JSON-RPC on stdio. Python owns indexing and retrieval.

## Implemented flow

The Rust journal layer performs safe filesystem operations and watches `Journal/` recursively with a 1.5-second debounce. It sends journal-relative change events over JSON-RPC to Python. Python parses Markdown into structural chunks, stores derived data in SQLite/FTS5/sqlite-vec, and serves both offline keyword search and, when an embedding/LLM provider is configured, hybrid semantic search and source-grounded chat.

Embeddings and chat generation both sit behind async provider contracts (`ai_daemon/api/base.py::EmbeddingProvider`/`LLMProvider`), currently implemented once by `ai_daemon/api/openai.py::OpenAICompatibleProvider`. Failures at any point — missing credentials, network errors, missing sqlite-vec extension — preserve the complete filesystem journal and FTS5 index and either mark work pending for bounded retries (embeddings) or return a structured, retryable JSON-RPC error (semantic search, chat) rather than crashing or degrading silently into wrong answers.

`ai_daemon/retrieval/` owns everything downstream of "the two search paths exist": `search.py` (FTS5 + vector search functions), `fusion.py` (Reciprocal Rank Fusion), `temporal.py` (heuristic recency/recurrence reranking), `context.py` (prompt assembly, prompt-injection defense, citation validation), and `service.py` (`RetrievalService`, the orchestrator the RPC layer calls). See `docs/rag.md` for the full pipeline description and its current limitations.

## JSON-RPC methods

Implemented: `health`, `index_file`, `remove_file`, `rebuild_index`, `search_keyword`, `retry_embeddings`, `get_index_status`, `search_semantic`, `search_hybrid`, `chat`.

Not yet implemented: `get_entry` as a Python RPC method — citation resolution and entry display currently go through the existing Rust `get_entry` Tauri command (`commands.rs`), which reads directly from the filesystem, so a duplicate Python-side method wasn't added. Revisit only if the retrieval layer needs entry data the filesystem-backed command can't provide.

## What's left

- Frontend: no `Sidebar.tsx`/`Search.tsx`/`Chat.tsx`/`Citation.tsx`/`Inspector.tsx` yet — journal browsing/search/editing currently live inline in `App.tsx`, and there is no UI for AI search mode, chat, citations, or the retrieval diagnostics the backend already returns.
- Streaming chat responses (AGENT.md sec.30/36) — `chat` is currently a single non-streaming JSON-RPC response; see `docs/rag.md`.
- An Anthropic (or other) provider implementing the same `LLMProvider`/`EmbeddingProvider` ABCs, to prove the abstraction is actually swappable in practice, not just in theory.
- macOS Keychain integration for API keys (currently `JOURNALY_OPENAI_API_KEY` env var only).
- Startup SQLite integrity check + corrupt-database rename-and-rebuild (AGENT.md sec.33).
- A conflict-resolution UI for the external-edit-vs-unsaved-changes case; the Rust layer already detects it (`save_entry`'s `expected_content` parameter) but nothing surfaces it to the user yet.

The full test suite (`ai_daemon/tests` + `tests/`, including `tests/rag/test_eval.py`) passes on both the extension-capable runtime and the fallback runtime — see `docs/rag.md`.
