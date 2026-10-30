# Progress log

Newest first. Updated as work happens, so this always says where the project is.

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
1. Try a real API key end to end.
2. Streaming chat (needs JSON-RPC notifications in `rpc_server.py` and `sidecar.rs`).
3. Conflict-resolution UI; Keychain; corruption recovery; Anthropic provider.
