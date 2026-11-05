# Architecture

For the end-to-end picture and the reasoning behind the design, start with [system-design.md](system-design.md). This page is the module-level reference.

Journaly is a local-first macOS application. Markdown files in the journal folder (`~/Documents/Journaly/Journal` in the installed app, `Journal/` in development) are the canonical data store; all SQLite and AI-derived data is rebuildable from them. The frontend communicates only through typed Tauri commands. Rust owns filesystem and OS integration; its sidecar client communicates with Python via line-delimited JSON-RPC on stdio. Python owns indexing and retrieval.

## Implemented flow

The Rust journal layer performs safe filesystem operations and watches `Journal/` recursively with a 1.5-second debounce. It sends journal-relative change events over JSON-RPC to Python. Python parses Markdown into structural chunks, stores derived data in SQLite/FTS5/sqlite-vec, and serves both offline keyword search and, when an embedding/LLM provider is configured, hybrid semantic search and source-grounded chat.

Embeddings and chat generation both sit behind async provider contracts (`ai_daemon/api/base.py::EmbeddingProvider`/`LLMProvider`), currently implemented once by `ai_daemon/api/openai.py::OpenAICompatibleProvider`, an OpenAI-compatible client whose chat and embedding endpoints are configurable independently (see `docs/providers.md`; works with Ollama and other compatible servers). Failures at any point — missing credentials, network errors, missing sqlite-vec extension — preserve the complete filesystem journal and FTS5 index and either mark work pending for bounded retries (embeddings) or return a structured, retryable JSON-RPC error (semantic search, chat) rather than crashing or degrading silently into wrong answers.

`ai_daemon/retrieval/` owns everything downstream of "the two search paths exist": `search.py` (FTS5 + vector search functions), `fusion.py` (Reciprocal Rank Fusion), `temporal.py` (heuristic recency/recurrence reranking), `context.py` (prompt assembly, prompt-injection defense, citation validation), and `service.py` (`RetrievalService`, the orchestrator the RPC layer calls). See `docs/rag.md` for the full pipeline description and its current limitations.

## Frontend

`App.tsx` owns navigation (grid / editor / settings), the open entry and autosave (`lib/autosave.ts`). Layout: `Sidebar`, header `Search`, `EntryGrid` or `EntryView` or `Settings`, and the `AiPanel` drawer (`Chat`, `Inspector`). Styling is one token-based stylesheet with light and dark values (`lib/theme.ts` switches `data-theme`). React still talks only to Tauri commands.

## Background embedding

Rust owns scheduling: `embedder.rs` asks the daemon to embed pending chunks after file changes, at startup and after settings changes, with exponential backoff on failure. See `docs/rag.md`.

## Provider settings

The AI settings tab saves non-secret settings through Rust (`settings.rs`) to a JSON file in the app's config directory and API keys to the macOS Keychain. Rust then restarts the daemon, passing `JOURNALY_CONFIG` and the keys as environment variables; the daemon never reads the Keychain itself. See `docs/providers.md`.

## JSON-RPC methods

Implemented: `health`, `index_file`, `remove_file`, `rebuild_index`, `search_keyword`, `retry_embeddings`, `get_index_status`, `search_semantic`, `search_hybrid`, `chat` (optionally streaming via `chat_delta` notifications, see `docs/rag.md`), `test_provider`, `list_models`.

Not yet implemented: `get_entry` as a Python RPC method — citation resolution and entry display currently go through the existing Rust `get_entry` Tauri command (`commands.rs`), which reads directly from the filesystem, so a duplicate Python-side method wasn't added. Revisit only if the retrieval layer needs entry data the filesystem-backed command can't provide.

## What's left

See the limitations in [system-design.md](system-design.md#10-known-limitations-and-what-youd-change-next) and the "Not working or not built yet" table in [status.md](status.md). The frontend, conflict-resolution UI, chat history and packaging described as future work in earlier versions of this page have since been built (see `docs/progress.md`). AI calls time out after 180 s per line (streamed answers keep the request alive); quick calls after 5 s.
