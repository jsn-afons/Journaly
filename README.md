# Journaly

A local-first macOS Markdown journal with an AI chat that answers from your own entries. Your Markdown files are the source of truth; search indexes, embeddings and AI metadata are derived and can always be rebuilt from them.

## What works right now

Last checked 2026-10-31. "Verified" means covered by automated tests and/or exercised in the UI; see the notes column for how.

### Journal (no AI needed, works offline)

| Feature | Status | Notes |
|---|---|---|
| Create, open, edit, rename, delete entries | ✅ Working | Files live in `Journal/YYYY/MM/Title.md` with immutable `id`/`created_at` frontmatter. Rust unit tests. |
| Safe saving | ✅ Working | Atomic writes (temp file + rename); duplicate titles get `Title 2.md`. |
| Edits made outside the app | ✅ Working | Detected by the file watcher (1.5 s debounce) and re-indexed; files without frontmatter are adopted without losing content. |
| Keyword search (Normal mode) | ✅ Working | SQLite FTS5/BM25 with stemming, highlighted snippets. Falls back to a simple file scan if the index service is down. |
| Index rebuilt from Markdown | ✅ Working (backend) | `rebuild_index` works and is tested, but there is **no button for it in the app yet**. |

### AI

| Feature | Status | Notes |
|---|---|---|
| Choose any AI provider in the app | ✅ Working | **AI settings** tab: Ollama, LM Studio, OpenAI, OpenRouter, or any OpenAI-compatible server, chosen separately for chat and for embeddings. **Save & test** checks both and fixes the embedding size automatically. See [docs/providers.md](docs/providers.md). |
| API keys in the macOS Keychain | ✅ Working | Never shown again, written to files, or sent back to the UI. Keychain read/write verified with a real Keychain test; saving/removing a key through the app window not yet clicked through. |
| Chat with your journal | ✅ Working | Hybrid retrieval → answer with clickable citations to the source entries. Explains how your views changed over time. |
| **Streaming chat** | ✅ Working (new) | The answer appears as it is generated, then is replaced by the final version with validated citation chips. Tested end to end with a mock streaming server and in the UI with a simulated stream. |
| Citations can't be made up | ✅ Working | Only ids of entries that were actually retrieved become citations. |
| Automatic background embedding | ✅ Working (new) | New and edited entries are embedded for meaning-based search a few seconds after saving, in small batches. If the provider is offline or misconfigured it retries with backoff (1 min doubling to 30 min) instead of hammering it; saving AI settings retries at once. The sidebar shows "up to date", "indexing N entries", or "paused — retrying in X min" with the reason. Tested with a fake AI service and mock providers; not yet run in the native app. |
| Meaning-based search (AI mode) | ✅ Working | Needs an embedding model and the extension-capable Python runtime (see Development). Without them it falls back to keyword results and says so. |
| AI Inspector | ✅ Working | Shows keyword, vector, fusion and time-based rankings plus timings for the last AI search/chat. |
| Prompt-injection defence | ✅ Working | Journal text is passed as untrusted data with explicit instructions not to follow it. A mitigation, not a guarantee. |

### Not working or not built yet

| Gap | What that means for you |
|---|---|
| No autosave | You must press **Save**. |
| No conflict-resolution screen | If a file changed on disk while you were editing, saving is refused with a "Save conflict" message (your edits aren't lost, but there's no side-by-side view to choose a version). |
| No "Rebuild index" button | Only possible from the backend. (Re-embedding now happens automatically.) |
| No startup database corruption recovery | If the index database is corrupted you'd have to delete `journal_index.db` yourself; your Markdown is unaffected either way. |
| Chats are not saved | Closing the app or switching away loses the conversation; chats are not stored as Markdown. |
| Editor is plain Markdown | No live preview, no `[[wikilinks]]`, backlinks, graph or folder tree like Obsidian. |
| No native Anthropic or Gemini provider | Use them through OpenRouter or another OpenAI-compatible gateway. |
| Only one request at a time to the AI service | While a long chat answer is generating, background re-indexing of edited files waits until it finishes. |
| Not packaged as an installable `.app` | Run it in development mode (below). |

### What has not been checked on a real setup

- A full chat with a hosted provider and a real API key (none available yet).
- Clicking through the native app window itself: the UI has been exercised in a browser with a simulated or bridged backend. The native app has been launched and its AI service starts.
- Live tests against local models are deliberately **not** run on this laptop (too heavy). Provider behaviour is covered by mock-server tests.

## Test status

Python: 58 passed on the extension-capable runtime / 54 passed + 4 skipped on the fallback runtime (the skips need the vector extension). Rust: 10 passed (+1 opt-in real-Keychain test). Frontend: `tsc` clean, 10 tests, `vite build` succeeds.

For a dated log of what changed and why, read [docs/progress.md](docs/progress.md).

## Development

See [docs/development.md](docs/development.md). Requires Node.js, Rust stable with the Tauri prerequisites, and Python 3.12. Meaning-based search needs an extension-capable Python: point `JOURNALY_PYTHON` at `ai_daemon/.runtime/arm64/bin/python`. Without it the app runs in keyword-only mode.

Start the app from the `src-tauri` folder:

```bash
cd src-tauri && JOURNALY_PYTHON="$(cd .. && pwd)/ai_daemon/.runtime/arm64/bin/python" ../frontend/node_modules/.bin/tauri dev
```

Other docs: [architecture](docs/architecture.md), [database](docs/database.md), [retrieval and AI](docs/rag.md), [AI providers](docs/providers.md).
