# Progress log

Newest first. Updated as work happens, so this always says where the project is.

## Installed app: Delete broken, New entry looked broken (2026-11-04)

Reported from the .app: New entry "does nothing" then several files appear; Delete does nothing; generally slow.

Measured instead of guessed, with a temporary self-test build (real production window and security policy, temp folders) clicking the real buttons:
- **Delete never worked on macOS.** It used `window.confirm`; `wry` implements no confirm dialog, so it returned `false` in 4 ms and the handler quit silently. Unit tests and the browser checks missed it because a normal browser does have a dialog. Replaced with inline Delete/Keep ("Keep" lands where the trash icon was, so a double click is safe).
- **New entry was working, invisibly.** File created in 8-14 ms, screen updated in 15-59 ms, unchanged with a simulated 8 s embedding server. The real files were 6-9 s apart and Ollama's log shows each succeeded. A new blank page looks the same as the last one and nothing took focus, so it read as "nothing happened". Now the title is focused and selected; a blank entry is reused rather than duplicated (`lib/entries.ts::isBlankEntry`); extra clicks during a create/delete are ignored; failures are shown instead of swallowed.
- **Ruled out by evidence:** Keychain dialog (no log entries, 2-3 ms read), security policy, the AI service (no restarts in 8 h), Ollama load (under 1 s, requests 48-939 ms).
- **Slowness itself was not reproduced.** The Mac has 8 GB RAM with 2.2 GB in swap, which may contribute; unproven.
- Hardening: read commands (`list_entries`, `get_entry`, `search_journal`, `get_provider_settings`, `list_chats`, `get_chat`) moved off the main thread. Writes stay serial, so two creates can't pick the same file name.
- Lesson: anything depending on the host window must be tested in the real window, not a browser mock.

## Installable app, new system prompt, app icon (2026-10-31)

- **System prompt**: replaced with the user's psychologically informed companion prompt (`ai_daemon/retrieval/system_prompt.md`, loaded at startup). Added: app rules first (data-not-instructions, `[entry:<uuid>]` citations, timeline, conversation memory); a three-sentence target (top, style section, closing directive; safety overrides it); section 9 rewritten because the model has no tools (retrieval happens before it is called); a "Quietly Building Confidence" section (self-efficacy/mastery evidence from the journal, attribution, autonomy support, small wins, specific acknowledgment; never flattery). A test guards the parts the app depends on. ~7k tokens per request.
- **Journaly.app** (`scripts/build_app.sh`, see docs/packaging.md): the Python AI service is frozen with PyInstaller into `Contents/Resources/journaly-ai` (own Python + libraries, 29 MB; verified running with no Python on PATH and no Homebrew links via `otool -L`); release builds use `~/Documents/Journaly/{Journal,Chats}` and `~/Library/Application Support/com.journaly.app` for the index; `tauri dev` unchanged. Ad hoc signed. The existing journal was copied (not moved) to `~/Documents/Journaly/Journal`.
- **Icon**: all sizes regenerated from `journaly.icns` (`tauri icon`), `icon.icns` is the original file.
- Found while testing: the app's AI service waits for the Keychain prompt (reading the API key) before starting, so an unanswered prompt looks like "AI not running".

## Chat memory (2026-10-31)

Follow-up questions now work: the AI sees the earlier messages of the conversation, including chats reopened from History.

- **Two halves.** (1) *Prompt*: the last turns go between the system instructions and the new question, so the model knows what "it"/"that" refers to. (2) *Retrieval*: a follow-up like "by how much?" has no useful search words, so the journal is searched for the previous question plus the new one. Only the user's words feed the search, never the model's.
- **Bounds** (`context.py`): at most 6 earlier messages, 2,000 characters each, 6,000 in total (newest kept first); the history always starts with a user message. Old answers have their citation ids removed, since those referred to an earlier retrieval; citations are still only accepted from this question's retrieved entries.
- **Safety**: history is validated twice: Rust accepts only `{role, content}` strings, Python keeps only `user`/`assistant` roles (a smuggled `system` message is dropped).
- Code: `ai_daemon/retrieval/context.py` (`recent_history`, `retrieval_query`, `build_messages`), `service.py::chat(history=…)`, `commands.rs::ChatTurn`, `Chat.tsx::historyFor`.
- Checked: Python 64 (4 new: follow-up retrieval + message order, malformed history, budget, retrieval query), Rust 15, frontend 38; browser with a recording backend: the follow-up carried the earlier Q&A, and a chat reopened from History sent all four earlier messages.
- Mistake caught: writing the new tests replaced an existing `test_context.py` (9 tests). Noticed because the suite dropped from 60 to 55; restored from git and appended. Lesson: check whether a file exists before writing it, and treat a falling test count as a failure.
- Note: the first Rust test run after each rebuild can take 1–5 minutes (macOS checking the new unsigned test binary); later runs take under a second.

## Chat history (2026-10-31)

Chats are now saved and can be reopened. Each conversation is a Markdown file in `Chats/YYYY/MM/<first question>.md`, next to `Journal/` (deliberately not inside it, so chats are never indexed and fed back to the AI as if they were journal entries). `Chats/` is in `.gitignore`.

- **Format** (`frontend/src/lib/chats.ts`): frontmatter (`title`, `created_at`, `updated_at`), then each message after an invisible HTML-comment marker with its role and time. Each answer keeps the chunks it cited as a JSON comment, so citation chips still open the right entry after reopening. Readable in any Markdown editor; hand-edited or broken files still load.
- **Saving**: after every completed answer (not errors or half-streamed text). The first answer creates the file; later ones rewrite it atomically. A failed save shows a notice but never interrupts the chat.
- **UI**: a **History** tab in the AI panel (newest first, click to reopen, delete with a confirm click), and a **+** button for a new chat.
- **Rust** (`src-tauri/src/chats.rs`): `list_chats`, `get_chat`, `create_chat`, `save_chat`, `delete_chat`. Path-safety code (no `..` escapes, atomic writes) moved from `journal.rs` into a shared `paths.rs::Folder` so the journal and chats use the same checks instead of two copies.
- Checked: Rust 15 tests (3 new), frontend 38 (5 new: round-trip, comment-safety, titles, broken files); in the browser with an in-memory backend: ask → saved, follow-up → same file, New chat, History → reopen with working citations, continue → same file, delete.
- (Memory for follow-ups was added next; see Chat memory.)

## "Find models" showed nothing (2026-10-31)

The lookup worked (Ollama returned its models), but results were offered through an HTML `<datalist>`, which the macOS web view rarely shows and which hides options that don't match the text already in the box (e.g. `text-embedding-3-small`). Found models are now shown as buttons under the Model field; clicking one fills it in. Checked in the browser with a stubbed backend returning the real Ollama list.

## Search fix and code-block escape (2026-10-31)

**Keyword search found nothing.** The index was empty (0 rows), so search had nothing to match. Two causes:
1. The file watcher was given the journal path as `src-tauri/../Journal`. macOS reports changes with fully resolved paths (`…/journaly/Journal/…`), and Rust's `strip_prefix` compares path components literally, so `..` never matched and every change was dropped. Fixed by resolving (canonicalizing) the root before watching (`watcher.rs::watch_root`, with a regression test).
2. Nothing indexed files that already existed or were edited while the app was closed. The watcher now runs a sync on startup (`rebuild_index`): new/changed files are indexed, unchanged ones skipped by content hash, and entries whose file was deleted are removed. `remove_file` also now deletes the entry's chunks (they were left behind).

Search is case-insensitive: FTS5's `unicode61` tokenizer lowercases both the indexed text and the query. Now covered by a test (`chelsea`, `CHELSEA`, `ChElSeA`). Verified on the real journal: after the app restarted, both entries were indexed and `CHELSEA` matched.

**Stuck in a code block.** A fence with no closing ``` runs to the end of the document, and a block on the last line had no line below it. Now (`frontend/src/lib/codeBlocks.ts`):
- Enter on a new opening fence (```` ```python ````) adds the closing fence and puts the cursor between.
- ↓ on the last line, or clicking below the text, closes an unfinished block if needed and moves the cursor to a new line under it.
- The editor now fills its whole area, so clicks below short entries reach it (they used to land on an empty `div`).

Checked: Python 60 passed, Rust 12 passed, frontend 33 tests + build; all three escape routes exercised in the browser.

## Live preview editor (2026-10-31)

The editor now works like Obsidian's Live Preview: Markdown renders in place and the raw syntax reappears only on the line(s) the cursor is on, so it can still be edited. Rendering never changes the file; your entries stay plain Markdown.

- Rendered: headings (sizes per level), **bold**, *italic*, ~~strikethrough~~, `inline code`, `[links](url)` (shown as their text), bullet lists (•), numbered lists, task lists as clickable checkboxes (ticking one writes `[x]` into the file and autosaves), block quotes, fenced code blocks, horizontal rules. Light and dark themes.
- Editing: GitHub-flavoured Markdown parsing, undo/redo (⌘Z / ⇧⌘Z; there was no undo before), Enter continues lists and tasks, Tab indents.
- Code: `frontend/src/lib/livePreview.ts` (a CodeMirror view plugin built from the Markdown syntax tree; the decision logic is a pure function so it is unit-tested without a browser), styles in `styles.css` under "Live preview". Added `@codemirror/commands` and `@codemirror/language`.
- Checked: 7 new unit tests (28 frontend tests total), `tsc` + `vite build`; editor mounted alone in the browser pane: rendering, cursor reveal, checkbox toggle, list continuation, undo, dark mode.
- Not yet: links are not clickable (opening a URL needs Tauri's opener plugin), images show as Markdown text, tables are not rendered. Wikilinks/backlinks/graph are out of scope by choice. Not yet seen inside the native window.

## Build fix (2026-10-31)

`tauri dev` failed to compile: when a `[dev-dependencies]` section was added for the Rust tests, it was inserted in the middle of `[dependencies]`, turning `tracing`, `tracing-subscriber`, `keyring` and `uuid` into test-only dependencies. `cargo test` still passed (test builds include dev-dependencies), which hid the problem; a normal build did not. Fixed in `src-tauri/Cargo.toml`, verified with `cargo build`, `cargo test` and a real `tauri dev` launch. Lesson: verify with `cargo build`, not only `cargo test`.

Also: opening `localhost:1420` in a normal browser now shows "Open Journaly in its app window" instead of failing on every action ("Cannot read properties of undefined (reading 'invoke')"), since the UI can only reach Rust inside the Tauri window.

## Redesign, dark mode, autosave (2026-10-31)

**Redesign** (from `mock-frontend.html`): rebuilt the frontend as sidebar + header (breadcrumb, pill search with Keyword/AI toggle, New, AI Copilot) + content + collapsible AI drawer. New components: `EntryGrid` (pastel cards, colour by month, excerpts), `EntryView` (centred editor), `AiPanel` (Chat + Inspector tabs; chat stays mounted), `Icon` (inline SVG; the CSP blocks icon CDNs). `styles.css` rewritten around light/dark design tokens; CodeMirror themed from the same tokens. Header collapses to icon buttons when narrow; the AI drawer opens by default only on windows ≥1200 px; default window size raised to 1320×840 (min 900×600). Rust `EntrySummary` gained an `excerpt` (derived preview, never written to disk; unit-tested). Placeholder sections from the mock (Favorites, Tags, Notebooks, profile) were not copied, since the app has nothing behind them.

**Dark mode**: sidebar toggle; stored in `localStorage` (`journaly.theme`) and applied as `data-theme` on `<html>`; light by default; storage failures fall back to light.

**Autosave** (`lib/autosave.ts` + `App.tsx`): debounced 1.2 s, saves never overlap, latest text always wins; flush on ⌘S, window blur, switching entry/view, creating; title renames on blur/Enter. A CONFLICT pauses autosave and shows a banner (Keep my version → overwrite; Use the version on disk → reload); other errors show Try again. The Save button was removed.

**Bugs found and fixed while testing**: citation card overflowed the narrow drawer (now anchored to the chat column); header controls overlapped at mid widths; typing during a conflict replaced the conflict banner with "Edited" while autosave stayed paused (state now sticks until resolved).

**Verified**: frontend 21 tests (new: autosave ×5, theme ×3, card helpers ×3), `tsc`, build; Rust 11 (new: excerpt); Python unchanged and passing. In the browser pane with a simulated backend: grid, search with highlights, open/edit/rename/delete, chat streaming + citations + Inspector, AI settings, dark mode on every view, autosave debounce, rename on blur, both conflict choices, and save-before-switch.

**Not verified**: the redesign inside the native Tauri window; focus-dependent behaviour (window blur save) in the real app.

**Next**: Rebuild-index button; refresh an open, unedited entry when it changes on disk; saving chats; startup corruption recovery.

## Automatic background embedding (2026-10-31)

**Done**
- Rust `embedder.rs`: background task that embeds pending chunks in batches after file changes, at startup and after settings saves; exponential backoff 1 → 30 min on failure; file-change wakes don't cut a backoff short. New `embedding_status` command.
- Sidebar line (`EmbeddingStatus.tsx`, polls every 5 s): up to date / indexing N entries / paused with retry time and reason / unavailable.
- AI settings no longer runs its own re-embed loop; it hands off to the background embedder.
- **Bug fixed**: `retry_embeddings` said "complete" after every successful batch even with more pending, so only the first 32 chunks were embedded by any loop. It now reports `pending` until done, with `pending_entries` and an `error` reason.

**Verified**: Python 58 passed / 54 + 4 skipped (new: multi-batch completion regression, failure reason); Rust 10 passed (new: batching against fake daemons for progress, provider failure and unavailable vectors; backoff wake rule); frontend 10 tests (status wording), build OK; sidebar status rendered correctly in the browser pane with a stub.

**Not verified**: the task running inside the native app over time (timers, real file saves). No local models were run.

**Next**: autosave; conflict-resolution screen; Rebuild index button; saving chats; startup corruption recovery.

## Streaming chat (2026-10-31)

**Done**: streaming chat end to end — daemon `chat_delta` notifications, SSE parsing in the provider, Rust `request_streaming` + `ai_chat_stream` command over a Tauri `Channel`, and the chat UI showing text as it arrives. Also: after a transport failure the Rust client now restarts the daemon instead of reusing a pipe whose position is unknown. Details in `docs/rag.md` → Streaming.

**Verified**: Python 56 passed / 54 + 2 skipped (new: SSE parsing, streaming service, real daemon process vs mock streaming server); Rust 6 passed (new: client vs fake daemon, including a normal request after a stream); frontend `tsc`, 7 tests, build. UI checked in the browser pane with a simulated stream: text grew piece by piece and the final answer showed one citation chip.

**Not verified**: streaming from a real provider (no API key; local models not run on this laptop by request).

**Also tried**: fetching the Stitch design screen "macOS Journaling App - Restored Note Grid, Editor & AI Chat" (project 31308702803042924). The Stitch connector failed to authenticate ("does not support dynamic client registration"), so no image or code was retrieved and no redesign was made.

**Docs**: README rewritten as a clear "working / not working / not checked" breakdown.

**Next**: automatic background embedding of new/edited entries; autosave; conflict-resolution screen; Rebuild/Re-embed buttons; saving chats; startup corruption recovery.

## AI provider settings in the UI (2026-10-31)

**Done**
- **AI settings tab** (`frontend/src/components/Settings.tsx`): provider presets (Ollama, LM Studio, OpenAI, OpenRouter, Custom) for chat and embeddings separately, server URL, model with **Find models**, API key field, **Save & test** with per-endpoint ✓/✗, automatic embedding-size correction, background re-embedding, and a warning when an endpoint is not local. Chat shows "Choose a provider" when nothing is set up and an **Open AI settings** button on provider errors.
- **Rust** (`src-tauri/src/settings.rs`, `commands.rs`, `sidecar.rs`): settings saved atomically to `~/Library/Application Support/com.journaly.app/provider-settings.json` after validation (http/https only, non-empty models, sane dimensions). API keys go to the **macOS Keychain** via the `keyring` crate (new dependency, `apple-native` backend) and are never returned to the UI. Saving restarts the daemon (`kill_on_drop` now actually stops the old process; previously the child handle was dropped and the process was orphaned). New commands: `get_provider_settings`, `save_provider_settings`, `test_provider`, `list_provider_models`. New error codes: `INVALID_SETTINGS`, `KEYCHAIN_ERROR`.
- **Python**: `test_provider` RPC (`api/diagnostics.py`, can check chat and/or embeddings; chat check capped at 16 output tokens), `list_models` RPC, provider errors returned as `PROVIDER_UNAVAILABLE` instead of a generic internal error.
- Bug found and fixed during testing: the form sent view-only fields (`has_chat_key`, …) back as settings; the daemon (correctly) refuses unknown keys. The form now sends only the five settings fields.

**Verified**
- Python: 52 passed (extension runtime) / 50 + 2 skipped (fallback), including new mock-server tests for `test_provider`, `list_models`, dimension detection, embeddings-only checks and the output cap. Rust: 5 tests + an opt-in real-Keychain round trip (`cargo test -- --ignored`, passed). Frontend: `tsc` clean, 7 vitest tests.
- The Settings screen ran in the browser pane against the real daemon through a temporary bridge: preset switching, **Find models**, **Save & test**, the automatic 1536→768 correction and re-embedding all worked.

**Not verified / decisions**
- **No more live tests against local models on this laptop** (user request: it is not powerful enough). Provider behaviour is covered with mock HTTP servers; any live check is for the user to run.
- The final change (embeddings-only re-test, 16-token chat cap) is covered by unit tests only.
- The native Tauri window itself was not driven (the bridge stood in for Rust), so Keychain save/remove through the UI and the daemon restart are tested only at the unit level.
- Minor visual: the Model input looks slightly clipped at some widths.

**Next**: streaming chat; conflict-resolution UI; startup database corruption recovery; in-app "Rebuild index" button; native Anthropic/Gemini providers (or use them via OpenRouter today).

## Configurable providers / Ollama (2026-10-31)

**Done**
- Chat and embeddings now have independent endpoint/model settings (`core/config.py`, `DaemonConfig.load`): defaults < `journaly.config.json` < env vars. API keys: env only, rejected in the file, excluded from dumps/repr.
- `api/openai.py` rewritten: keyless for non-OpenAI hosts, `dimensions` sent only to OpenAI by default, longer timeout (120s; Rust AI timeout raised to 180s), errors report HTTP status without response bodies.
- Citation parsing accepts `[uuid]` as well as `[entry:uuid]` (backend and frontend) because the local model omitted the prefix; the retrieved-ids allow-list is unchanged.
- New: `docs/providers.md`, `journaly.config.example.json`; `journaly.config.json` gitignored.

**Verified**
- Real run against local Ollama `qwen3.5:4b` with no key: index rebuild OK, chat returned a grounded, chronological answer (112 s on this machine). Embeddings returned 404 because no embedding model is installed; the app degraded to keyword-only retrieval and reported it, as designed.
- 8 new provider tests against a real local HTTP server (no auth header without key, separate chat/embedding servers, dimension mismatch, 404 message, unreachable server), 3 config tests, 1 citation test. Suites: 44 passed (extension runtime) / 42 passed + 2 skipped (fallback); frontend 4 tests; `cargo check` clean.

**Semantic search verified live (2026-10-31)**: after `ollama pull nomic-embed-text` (274 MB, approved), a rebuild + `retry_embeddings` embedded all 4 fixture entries (768-dim) with no key. The query "opening an eatery" — which shares no words with the journal — returned keyword search: nothing; semantic search: the three restaurant entries first (cosine distance 0.78–0.89) and the unrelated running entry last (1.05); hybrid search returned all with no vector error (vector step 32 ms). Caveat: the fixtures have no timestamps, so temporal scores were all identical in this run and the temporal ordering was not exercised.

**Not verified**
- Any non-Ollama provider; the app UI with Ollama (only the daemon was driven); a full chat with vectors active (chat takes ~2 min on this machine).

**Next**: in-app provider settings screen; streaming (a 2-minute silent wait is poor UX with local models); Keychain; conflict UI; corruption recovery.

## Journal directory mismatch fixed (2026-10-30)

Rust resolves the journal location (`JOURNALY_JOURNAL_DIR`, default `<repo>/Journal`) and now exports that value to the daemon when spawning it (`sidecar.rs`); `DaemonConfig.journal_directory` reads it (`core/config.py`). Rust is the single owner of the path. The database path is still `<cwd>/journal_index.db`. Tests: `ai_daemon/tests/test_config.py`; suites pass (31 on the extension-capable runtime; 29 plus 2 skipped on the fallback); `cargo check` clean. Not re-run in the live app.

## Smoke test of Phase 5 (2026-10-30)

**What ran**
- `tauri dev` launched the real native app against the extension-capable runtime; the Rust shell compiled, the Vite dev server served the UI, and the Python sidecar was spawned. No errors in the launch log.
- The daemon was driven over stdio (rebuild, keyword search, hybrid search, chat) against a copy of the fixture journal.
- The new UI was exercised in the browser pane with a **stubbed** Tauri bridge (the native window can't be driven from here): Normal and AI search, snippet highlighting, chat, citation chips, citation card, error message, and the Inspector all rendered and behaved correctly. A `<script>` in a snippet displayed as inert text.

**Bugs found and fixed**
1. `tauri.conf.json`: `beforeDevCommand` used `npm --prefix ../frontend`, but Tauri runs it from the repo root, so `tauri dev` could not start. Now `npm --prefix frontend`.
2. **Chat found no context for natural-language questions.** The keyword path AND-ed every word, so "What have I thought about restaurants?" matched nothing and `chat` returned `NO_CONTEXT_AVAILABLE`, even though the journal had matches. Hybrid/chat now OR the terms (BM25 still ranks rarer words higher); plain keyword search still uses AND. Regression test added in `ai_daemon/tests/test_chat.py`; the existing "no context" test now uses a query of genuinely absent words.
3. Chat pane had a hard-coded height that made the page scroll ~4px; now fills its container.

**Still unverified**
- A real end-to-end chat/embedding round trip with an API key (no key was used).
- The native window's own interactions (editing, saving, conflict handling) were not driven; only the pieces above were.

**Open issue found, since fixed (below)**
- Rust read `JOURNALY_JOURNAL_DIR` but the Python daemon ignored it.

## Phase 5 — frontend for AI features (in progress → code complete, not yet run in the app)

**Done**
- Restored `frontend/index.html` (it was deleted in the working tree; Vite could not have built without it).
- `src-tauri/src/sidecar.rs`: added `request()` with a 90s timeout for AI methods (the old hard-coded 5s would have killed any `chat` call). Health keeps 5s.
- `src-tauri/src/errors.rs`: errors now serialize as `{code, message, retryable}` instead of a bare string, so React can branch on `code` (AGENT.md sec.39). The daemon's `retryable` flag is now carried through.
- `src-tauri/src/commands.rs` / `main.rs`: `ai_search_keyword`, `ai_search_hybrid`, `ai_chat`, `ai_retry_embeddings`, `ai_index_status` — thin passthroughs to the daemon.
- Frontend: `App.tsx` split into `Sidebar`, `Search`, `Chat`, `Citation`, `Inspector` (+ `Editor`). Types in `types/ai.ts`; helpers in `lib/errors.ts` and `lib/citations.ts` (unit-tested).
  - **Search**: Normal mode = offline FTS5/BM25 (falls back to the old Rust file scan if the daemon is down); AI mode = hybrid retrieval, shows fallback notice if vectors are unavailable. Debounced 250ms, stale responses discarded. Snippet highlights render via React nodes, never `innerHTML`.
  - **Chat**: single non-streaming request; error states use `describeFailure`.
  - **Citation**: chips appear only for ids the backend validated; the card shows title, date, heading, original Markdown, path, and an Open button. Details come from the chunks retrieved for that answer, so nothing is fabricated client-side.
  - **Inspector**: toggle in the tab bar; shows FTS, vector, RRF, temporal, final context, and latencies from the last AI search or chat.

**Verified**: `cargo check`/`cargo test`, `tsc --noEmit`, `vitest`, `vite build`, and both Python suites.

**Not verified**: launching the real app; behavior with a real API key; visual polish/layout of the new panes.

**Known gaps / decisions**
- The sidecar client holds one mutex, so a slow `chat` blocks watcher-triggered indexing until it returns. Fine for single-user; revisit with streaming.
- Normal search no longer matches by filename alone when the daemon is healthy (it searches indexed content); filename matching only appears in the fallback.
- Pre-existing: the README previously claimed no commit had been made; Phases 3–4 were committed (`5fbbf44`, `13ced0b`).

**Next**
1. Run the full app against Ollama with real journal entries (including timestamps) and try chat with vectors active.
2. Streaming chat (needs JSON-RPC notifications in `rpc_server.py` and `sidecar.rs`).
3. Conflict-resolution UI; Keychain; corruption recovery; Anthropic provider.
