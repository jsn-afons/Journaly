# Project status

What works, what isn't built yet, and how it has been tested. For a dated history of changes, see [progress.md](progress.md). How to install is in the [README](../README.md).

## What works

Last checked 2026-10-31. "Verified" means covered by automated tests and/or exercised in the UI; see the notes column for how.

### Journal (no AI needed, works offline)

| Feature | Status | Notes |
|---|---|---|
| Create, open, edit, rename, delete entries | ✅ Working | Files live in `Journal/YYYY/MM/Title.md` with immutable `id`/`created_at` frontmatter. Rust unit tests. |
| Safe saving | ✅ Working | Atomic writes (temp file + rename); duplicate titles get `Title 2.md`. |
| **Autosave** | ✅ Working (new) | Saves about 1.2 s after you stop typing; ⌘S, switching entries, going back to the grid, or the window losing focus saves immediately. The title renames the file when you leave the title field (or press Enter). The status pill shows Edited / Saving… / Saved 10:42. Saver logic unit-tested; flows exercised in the browser with a simulated backend. |
| **Conflict handling** | ✅ Working (new) | If the file was changed outside Journaly while you were editing, autosave pauses and a banner offers **Keep my version** or **Use the version on disk**. Nothing is overwritten silently. Other save errors show **Try again**. |
| **New look + dark mode** | ✅ Working (new) | Minimal macOS-style layout from `mock-frontend.html`: sidebar, pastel entry cards (colour by month), focused editor, AI Copilot drawer. **Dark mode** toggle in the sidebar, remembered between launches; light is the default. |
| **Live preview editor** | ✅ Working (new) | Obsidian-style: Markdown renders as you write (headings, bold/italic/strikethrough, code, links, bullets, clickable task checkboxes, quotes, code blocks, rules); the raw syntax shows only on the line you're editing. Undo/redo, list continuation on Enter; code blocks close themselves and you can always click or ↓ out of them. Files stay plain Markdown. Unit-tested and checked in the browser; not yet seen in the native window. |
| Edits made outside the app | ✅ Working | Detected by the file watcher (1.5 s debounce) and re-indexed; files without frontmatter are adopted without losing content. On startup the index catches up with anything added, edited or deleted while the app was closed. |
| Keyword search (Normal mode) | ✅ Working (fixed) | SQLite FTS5/BM25 with stemming, highlighted snippets, not case-sensitive. (Before 2026-10-31 nothing was being indexed, so it found nothing.) Falls back to a simple file scan if the index service is down. |
| Index rebuilt from Markdown | ✅ Working (backend) | `rebuild_index` works and is tested, but there is **no button for it in the app yet**. |

### AI

| Feature | Status | Notes |
|---|---|---|
| Choose any AI provider in the app | ✅ Working | **AI settings** tab: Ollama, LM Studio, OpenAI, OpenRouter, or any OpenAI-compatible server, chosen separately for chat and for embeddings. **Save & test** checks both and fixes the embedding size automatically. See [docs/providers.md](providers.md). |
| API keys in the macOS Keychain | ✅ Working | Never shown again, written to files, or sent back to the UI. Keychain read/write verified with a real Keychain test; saving/removing a key through the app window not yet clicked through. |
| Chat with your journal | ✅ Working | Hybrid retrieval → answer with clickable citations to the source entries. Explains how your views changed over time. **Remembers the conversation** (last 6 messages), so follow-ups like "by how much?" work, also in chats reopened from History. |
| **Streaming chat** | ✅ Working (new) | The answer appears as it is generated, then is replaced by the final version with validated citation chips. Tested end to end with a mock streaming server and in the UI with a simulated stream. |
| Citations can't be made up | ✅ Working | Only ids of entries that were actually retrieved become citations. |
| Automatic background embedding | ✅ Working (new) | New and edited entries are embedded for meaning-based search a few seconds after saving, in small batches. If the provider is offline or misconfigured it retries with backoff (1 min doubling to 30 min) instead of hammering it; saving AI settings retries at once. The sidebar shows "up to date", "indexing N entries", or "paused — retrying in X min" with the reason. Tested with a fake AI service and mock providers; not yet run in the native app. |
| Meaning-based search (AI mode) | ✅ Working | Needs an embedding model and the extension-capable Python runtime (see Development). Without them it falls back to keyword results and says so. |
| AI Inspector | ✅ Working | Shows keyword, vector, fusion and time-based rankings plus timings for the last AI search/chat. |
| **Chat history** | ✅ Working (new) | Every chat is saved as a Markdown file in `Chats/` after each answer. The **History** tab lists them; click to reopen (citations still work) and keep going, or delete. **+** starts a new chat. Checked in the browser with a simulated backend; not yet in the app window. |
| Prompt-injection defence | ✅ Working | Journal text is passed as untrusted data with explicit instructions not to follow it. A mitigation, not a guarantee. |

### Not working or not built yet

| Gap | What that means for you |
|---|---|
| Open entry doesn't refresh from outside edits | If another app changes the entry you have open and you haven't typed since, the editor keeps showing the old text until you reopen it. If you *have* typed, the conflict banner appears instead. |
| No side-by-side diff in a conflict | You choose a whole version (yours or the disk's); there's no line-by-line merge. |
| Card grid has no favourites, tags or folders | The mock's placeholder sections (Favorites, Tags, Notebooks) were left out because the app has no such data yet. |
| No "Rebuild index" button | Only possible from the backend. (Re-embedding now happens automatically.) |
| No startup database corruption recovery | If the index database is corrupted you'd have to delete `journal_index.db` yourself; your Markdown is unaffected either way. |
| Live preview gaps | Links aren't clickable, and images and tables show as Markdown text. (Wikilinks, backlinks and a graph view are intentionally out of scope.) |
| No native Anthropic or Gemini provider | Use them through OpenRouter or another OpenAI-compatible gateway. |
| Only one request at a time to the AI service | While a long chat answer is generating, background re-indexing of edited files waits until it finishes. |

### What has not been checked on a real setup

- A full chat with a hosted provider and a real API key (none available yet).
- Clicking through the native app window itself: the UI (including the new design, dark mode, and autosave) has been exercised in a browser with a simulated backend. The native app has been launched and its AI service starts, but the redesign has not been seen inside it yet.
- Live tests against local models are deliberately **not** run on this laptop (too heavy). Provider behaviour is covered by mock-server tests.

## Test status

Python: 65 passed on the extension-capable runtime / 54 passed + 4 skipped on the fallback runtime (the skips need the vector extension). Rust: 15 passed (+1 opt-in real-Keychain test). Frontend: `tsc` clean, 39 tests, `vite build` succeeds.

For a dated log of what changed and why, read [docs/progress.md](progress.md).
