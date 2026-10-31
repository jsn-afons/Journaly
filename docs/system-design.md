# Journaly system design

The end-to-end picture: what each part does, how the parts talk, why it's built this way, and what the trade-offs are. The other docs go deeper on one area each: [architecture](architecture.md) (module map), [rag](rag.md) (retrieval pipeline), [database](database.md) (tables), [providers](providers.md) (AI settings), [packaging](packaging.md) (building the .app).

## 1. The 30-second version

Journaly is a Mac journaling app whose AI answers questions from your own entries. Your entries are plain Markdown files, which are the only real data; everything else (search index, AI vectors) is derived from them and can be rebuilt. The app is three cooperating parts:

- an **interface** (React, running in the Mac's built-in web view),
- a **core** (Rust, via Tauri) that owns the window, files, Keychain and the other process,
- an **AI service** (Python) that indexes, searches and talks to the AI provider.

Nothing is hosted. Everything runs on your Mac; the only network traffic is to the AI provider you choose (none at all with Ollama).

## 2. The parts and how they connect

```
┌───────────────────────────── Journaly.app (one Mac app) ─────────────────────────────┐
│                                                                                       │
│  Interface: React + TypeScript + CodeMirror, in the macOS web view (WKWebView)       │
│     editor · entry grid · search · chat · history · settings                          │
│                    │  invoke("save_entry", …)        ▲ results, streamed text          │
│                    ▼  Tauri commands (IPC)           │ Tauri Channel                   │
│  Core: Rust (Tauri)                                                                   │
│     journal.rs  files: create/save/rename/delete, atomic writes, path safety         │
│     chats.rs    saved chats            watcher.rs  notices file changes              │
│     settings.rs settings + Keychain    embedder.rs schedules background embedding    │
│     sidecar.rs  starts and talks to the AI service                                    │
│                    │  JSON lines over stdin/stdout (JSON-RPC)                          │
│                    ▼                                                                   │
│  AI service: Python (a separate process; frozen with PyInstaller in the .app)        │
│     indexer   Markdown → chunks → SQLite (FTS5 keyword index + sqlite-vec vectors)   │
│     retrieval hybrid search → fusion → time-aware rerank → prompt → answer           │
│     api       OpenAI-compatible client (DeepSeek, OpenAI, Ollama, LM Studio, …)      │
└───────────────────────────────────────────────────────────┬───────────────────────────┘
                                                            │ HTTPS (or localhost for Ollama)
  On disk:                                                  ▼
  ~/Documents/Journaly/Journal/YYYY/MM/*.md  ← source of truth        AI provider
  ~/Documents/Journaly/Chats/YYYY/MM/*.md    ← saved chats
  ~/Library/Application Support/com.journaly.app/  ← index database, provider settings
  macOS Keychain (com.journaly.app)                ← API keys
```

Three boundaries, each with its own protocol:

| Boundary | Mechanism | What crosses it |
|---|---|---|
| Interface → Core | **Tauri commands**: the UI calls `invoke("name", args)`, Rust runs a function marked `#[tauri::command]` and returns JSON. Errors arrive as `{code, message, retryable}`. | Every action: open/save entries, search, chat, settings |
| Core → Interface (streaming) | **Tauri Channel**: a one-way pipe Rust pushes messages into | Chat answer text as it's generated |
| Core → AI service | **JSON-RPC over stdio**: Rust starts the Python process and writes one JSON request per line to its stdin; Python writes one JSON response per line to stdout. Streaming chat sends extra "notification" lines (no `id`) before the final answer. | index a file, search, chat, embed, test provider |

Example of the Core ↔ AI service protocol:

```
→ {"jsonrpc":"2.0","id":7,"method":"search_keyword","params":{"query":"chelsea"}}
← {"jsonrpc":"2.0","id":7,"result":{"results":[{"filepath":"2026/10/Chelsea Beat United.md", …}]}}
```

The interface never talks to Python, the file system or the network directly. Everything goes through Rust, which is the single gatekeeper.

## 3. Why these technologies

### Why a desktop app with Tauri (and not a website, or Electron)

- **Local-first and private.** A journal is about as personal as data gets. As a desktop app the files never leave your Mac unless you send a question to a hosted AI provider.
- **Tauri vs Electron.** Both let you build the interface with web technology. Electron ships a whole copy of Chromium inside every app (typically 150 MB+); Tauri uses the web view macOS already has, so Journaly.app is about 41 MB, and ~29 MB of that is the bundled Python. Tauri's backend is Rust; Electron's is Node.js.
- **Web technology for the UI** because React and CodeMirror 6 (the editor behind live preview) are mature and fast to build with, and CSS makes the light/dark design straightforward.

### Why Rust for the core

The core does the things that must never go wrong: writing your files, guarding paths, holding API keys, and supervising the AI service.

- **Safety and correctness.** Rust's compiler rules out whole classes of bugs (memory errors, data races) before the program runs. Writing journal files atomically, rejecting paths like `../../secret`, and handling file-watcher events concurrently are exactly where those bugs would hurt.
- **Native OS access.** Rust has direct bindings for the Keychain (`keyring`), file watching (`notify`/FSEvents) and processes (`tokio`), and it compiles to one small, fast machine-code program with no runtime to install.
- **It comes with Tauri.** Tauri's backend *is* Rust, so it's the natural home for OS work.

### Why Python for the AI service

- **The AI and data ecosystem lives in Python.** `sqlite-vec` (vector search inside SQLite), `httpx` (async HTTP with streaming), `pydantic` (validated configuration and messages), and, if the app ever grows into local models, re-rankers or evaluation tooling, Python has them first and best.
- **Fast iteration.** Retrieval logic (chunking, fusion, reranking, prompts) changes often while tuning; Python is quick to change and test (the RAG evaluation harness is a pytest).
- **The specification asked for it.** AGENT.md assigns OS work to Rust and AI/RAG to Python; the reasons above are why that split makes sense.

### Why two languages in two processes, not one

- **Isolation.** If the AI service crashes, hangs on a slow provider, or leaks memory, the app and your files are unaffected. Rust notices, restarts it, and retries (`sidecar.rs`).
- **Clear ownership.** Rust owns everything about the operating system; Python owns everything about understanding text. Neither reaches into the other's job, which keeps each side small and testable.
- **A simple contract.** JSON lines over stdin/stdout is easy to debug (you can type requests by hand) and easy to fake in tests (the Rust tests start a tiny fake Python service).

### The honest costs of this design

- Two languages, two toolchains, two test suites.
- Shipping Python means freezing it (PyInstaller), which adds ~29 MB and a packaging step.
- One request at a time to the AI service: a long chat answer delays background indexing until it finishes.
- A single-language alternative (all Rust, or all Python with a different UI toolkit) would be simpler to ship but weaker either at OS integration or at AI tooling.

## 4. Data design: Markdown is the source of truth

- **Entries** are `.md` files in `Journal/YYYY/MM/Title.md` with a small frontmatter block (`id`, `created_at`) that never changes. You can open, edit, back up or sync them with any tool.
- **Everything else is derived.** `journal_index.db` (SQLite) holds chunks, the keyword index, vectors and retrieval history. Delete it and it is rebuilt from the Markdown on the next launch. Losing the database never loses writing.
- **Chats** are Markdown too (`Chats/`), kept outside `Journal/` so the AI never indexes its own answers as if you had written them.
- **Secrets** (API keys) live only in the macOS Keychain, never in files, logs, the database or the UI.

Why: files you can read without the app are durable and portable; a database you can rebuild means a bug in indexing can never destroy your journal.

## 5. Following a request end to end

### 5.1 Writing an entry

1. You type. CodeMirror updates the text; live preview hides Markdown symbols except on the cursor line (`lib/livePreview.ts`), without changing the text.
2. **Autosave** (`lib/autosave.ts`) waits until you pause for 1.2 s, then calls `save_entry(path, content, expected_content)`.
3. Rust compares `expected_content` with what's on disk. If another program changed the file meanwhile it refuses (`CONFLICT`) and the UI offers **Keep mine / Use disk**, so nothing is silently overwritten. Otherwise it writes a temp file and renames it over the original (an *atomic write*: a crash can't leave half a file).
4. The **watcher** (`watcher.rs`) sees the change (macOS FSEvents, 1.5 s debounce) and sends `index_file` to the AI service.
5. Python hashes the file; if unchanged it stops. Otherwise it splits the entry into heading-based **chunks**, stores them, adds them to the **FTS5** keyword index, and marks them *pending embedding*.
6. The **embedder** (`embedder.rs`) wakes and asks Python to embed pending chunks, 32 at a time. Python sends the text to the embedding model and stores the vectors in `docs_vec`. If the provider is down it backs off (1 min, doubling to 30 min) instead of hammering it.

### 5.2 Keyword search

The search box calls `ai_search_keyword` → Rust → `search_keyword` → Python runs an FTS5 query (BM25 ranking, Porter stemming, case-insensitive) and returns highlighted snippets. Works offline. If the AI service is down, the interface falls back to Rust's plain file scan (`search_journal`), so search still works without the index.

### 5.3 Asking the AI a question

1. The chat sends your question plus the recent conversation (`ai_chat_stream(query, history)`).
2. **Retrieval** in Python (`retrieval/service.py`):
   - The search text is your question plus your previous question, so follow-ups like "by how much?" still find the right entries.
   - **Keyword search** (FTS5/BM25) and **meaning search** (the question is embedded and compared with entry vectors, sqlite-vec KNN) run separately.
   - **Reciprocal Rank Fusion** merges the two ranked lists (k = 60): an entry ranked high by either method rises.
   - **Temporal rerank** (inspired by the ACT-R memory model) blends in recency (30-day half-life) and how often a passage has come up before. Relevance still dominates (35% time-based).
3. **Prompt assembly** (`retrieval/context.py`): the system prompt (`system_prompt.md`), up to 6 earlier messages, then your question with the retrieved passages wrapped in `<journal_context>` and marked as untrusted data.
4. **Generation**: the provider streams the answer; each piece goes Python → Rust (notification line) → UI (Channel), so you see it as it's written.
5. **Citation check**: the model cites entries as `[entry:<id>]`. Only ids that were actually retrieved for this question survive; anything else is dropped, so the AI can't link to an entry it didn't see.
6. **Saving**: the chat is written to `Chats/…md`, and the AI Inspector shows each ranking stage and its timing.

### 5.4 Changing AI settings

The settings page sends settings and any new key to `save_provider_settings`. Rust validates them, writes the settings file, stores keys in the Keychain, and restarts the AI service with the settings path and keys in its environment. Python never touches the Keychain. **Save & test** sends one tiny request to each endpoint and fixes the embedding size automatically.

## 6. The AI part, in two layers

**Universal framework: what any "chat with your documents" (RAG) system needs**

1. Load documents → 2. split them into chunks → 3. index chunks for keyword search and/or embed them as vectors → 4. on a question, retrieve the most relevant chunks → 5. put them in the prompt with instructions → 6. generate an answer → 7. (ideally) show sources.

**Context framework: how Journaly does each step, and what's its own**

1. Loading is the Markdown files themselves, kept current by the watcher plus a sync at startup.
2. Chunks follow Markdown headings, so a chunk is a coherent section, not an arbitrary slice.
3. Both keyword (FTS5) and vector (sqlite-vec) indexes live in one SQLite file; no separate vector database server.
4. Retrieval is **hybrid** (keyword + meaning, fused with RRF) plus a **time-aware rerank**. That's Journaly's own twist: a journal is a timeline, so how recent and how recurrent a thought is matters.
5. The prompt treats your journal as data, not instructions (a prompt-injection defense), and tells the model to explain how your views changed over time instead of picking one entry.
6. Any OpenAI-compatible provider works; chat and embeddings can be different providers.
7. Citations are validated against what was actually retrieved.

## 7. Security and privacy

| Risk | Defense | Where |
|---|---|---|
| A path like `../../etc/passwd` from the UI | Paths must be relative, `.md`, and resolve inside the folder (symlinks included) | `paths.rs::Folder` |
| A crash mid-save corrupts an entry | Atomic write: temp file + rename | `paths.rs::atomic_write` |
| Overwriting changes made in another app | `expected_content` check → conflict banner | `journal.rs::save_entry` |
| API keys leaking | Keychain only; passed to Python via environment at start; never written, logged or sent to the UI | `settings.rs`, `sidecar.rs` |
| A journal entry containing "ignore your instructions…" | Journal text wrapped as untrusted data; the system prompt forbids following it; CDATA escaping | `context.py` |
| The AI inventing sources | Citations accepted only for retrieved entries | `context.py::extract_valid_citations` |
| Smuggling a fake "system" message through chat history | Rust accepts only `{role, content}` strings; Python keeps only `user`/`assistant` | `commands.rs::ChatTurn`, `context.py::recent_history` |
| Private data in git | `Journal/`, `Chats/`, database and config are git-ignored | `.gitignore` |
| Something injected into the web view | Content Security Policy allows only the app's own scripts and styles | `tauri.conf.json` |

What leaves your Mac: only the text sent to the AI provider you configure, meaning the question, recent chat messages and the retrieved journal passages for chat, and entry text for embeddings. With Ollama, nothing leaves.

## 8. Reliability: how it fails gracefully

- **No AI configured or provider down** → journaling and keyword search still work; AI features return a clear, retryable error.
- **Vector extension unavailable** → falls back to keyword-only search and says so.
- **AI service crashes or times out** → Rust restarts it on the next request (5 s for quick calls, 180 s for AI calls; long streaming answers don't time out while text keeps arriving).
- **Index database lost or stale** → rebuilt or brought up to date from the Markdown on launch.
- **Conflicting edit** → autosave pauses and asks you.

## 9. Code map

| Path | Language | Responsibility |
|---|---|---|
| `frontend/src/App.tsx` | TypeScript | Navigation, open entry, autosave, theme |
| `frontend/src/components/` | TSX | UI: `Editor`, `EntryGrid`, `EntryView`, `Search`, `AiPanel`, `Chat`, `ChatHistory`, `Citation`, `Inspector`, `Settings`, `Sidebar` |
| `frontend/src/lib/` | TypeScript | Logic with unit tests: `rpc` (all calls to Rust), `autosave`, `livePreview`, `codeBlocks`, `chats` (chat file format), `citations`, `presets`, `theme` |
| `src-tauri/src/main.rs` | Rust | Startup: where data lives (dev vs installed), wiring |
| `src-tauri/src/commands.rs` | Rust | Every command the UI can call |
| `src-tauri/src/journal.rs`, `chats.rs`, `paths.rs` | Rust | Entry and chat files, path safety, atomic writes |
| `src-tauri/src/watcher.rs`, `embedder.rs` | Rust | File watching + startup sync, background embedding |
| `src-tauri/src/sidecar.rs` | Rust | Start/restart the AI service, JSON-RPC, streaming |
| `src-tauri/src/settings.rs`, `errors.rs` | Rust | Provider settings + Keychain; error format sent to the UI |
| `ai_daemon/api/rpc_server.py` | Python | JSON-RPC entry point and method dispatch |
| `ai_daemon/api/openai.py`, `base.py`, `diagnostics.py` | Python | AI provider client, provider interface, Save & test |
| `ai_daemon/core/` | Python | Configuration, database schema, message models |
| `ai_daemon/indexer/` | Python | Parse Markdown, chunk, index, embed |
| `ai_daemon/retrieval/` | Python | Search, fusion, temporal rerank, prompt + citations, chat orchestration, `system_prompt.md` |
| `tests/rag/` | Python | Retrieval quality evaluation (Recall@5 on a fixture journal) |
| `scripts/build_app.sh`, `build_daemon.sh` | Shell | Build Journaly.app, freeze the AI service |

## 10. Known limitations and what you'd change next

- One request at a time to the AI service (a queue or worker pool would fix it).
- The open entry doesn't refresh when another app edits it, unless you've typed (then the conflict banner appears).
- Conflicts are whole-file choices; no line-by-line merge.
- The ~7k-token system prompt is sent with every question: fine for hosted models, heavy for small local ones.
- No startup integrity check for a corrupted database (you'd delete `journal_index.db`; it rebuilds).
- Apple Silicon only, ad hoc signed, no auto-updater (see packaging.md).

## 11. Questions you might be asked

- **"Why not just use a vector database?"** For one person's journal, SQLite with FTS5 and sqlite-vec in a single file is plenty fast, needs no server, and keeps keyword and vector data together. A separate vector DB adds a moving part for no gain at this scale.
- **"Why hybrid search instead of only embeddings?"** Embeddings find meaning ("football" ≈ "Chelsea match") but can miss exact names and rare words; keyword search is the reverse. Fusing both is more robust than either.
- **"How do you stop the AI making things up?"** It only sees retrieved passages, is told to separate what the journal says from inference, and its citations are checked against what was retrieved.
- **"What happens to my data if the app breaks?"** Your journal is plain Markdown in Documents; the app can be deleted and the files remain readable.
- **"Why is Python a separate process?"** Isolation (a crash or hang can't take down the app or files), clear ownership, and the best AI libraries.
