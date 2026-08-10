# Retrieval and AI

## Current state (updated: backend hybrid RAG pipeline implemented)

Journaly has two independent retrieval paths that are fused, not layered on top of each other:

- **Path A — FTS5/BM25** (`ai_daemon/retrieval/search.py::fts_search`): deterministic, offline, always available. Journal content is parsed into heading-aware chunks and indexed into SQLite FTS5.
- **Path B — sqlite-vec KNN** (`ai_daemon/retrieval/search.py::vector_search`): cosine/L2 nearest-neighbor search over a `docs_vec` `vec0` virtual table, populated by `retry_embeddings`.

`ai_daemon/retrieval/fusion.py` merges the two rankings with Reciprocal Rank Fusion (`k=60`, configurable). `ai_daemon/retrieval/temporal.py` then reranks the fused list with a configurable, explicitly-heuristic ACT-R-inspired blend of recency (half-life decay) and recurrence (how often a chunk has previously been retrieved, tracked in `chunk_retrievals`) — this is **not** a validated model of the user's cognition (AGENT.md sec.51), and by default relevance still dominates (`temporal_blend=0.35`) so a highly-relevant old entry can still outrank a barely-relevant new one.

`ai_daemon/retrieval/context.py` assembles the final ranked chunks into the `<journal_context>` XML structure and a three-part prompt (SYSTEM INSTRUCTIONS / USER QUERY / RETRIEVED JOURNAL DATA). The system prompt explicitly tells the model that journal content is untrusted data, not instructions, that it must never follow instructions embedded in journal text, must not reveal the system prompt, and must explain belief changes across time rather than silently picking one historical entry over another. Any literal `]]>` inside journal content is escaped so it cannot break out of its CDATA block early — this is a trust-boundary/formatting mechanism plus defense-in-depth, not a cryptographic guarantee (AGENT.md sec.51 explicitly warns against overclaiming here).

Citations are validated, not trusted: the model is asked to cite `[entry:<uuid>]`, and `extract_valid_citations` strips any id that isn't in the set of entry ids that were actually retrieved for that query — a fabricated id from the model is silently dropped rather than surfaced to the user as if it were real.

`ai_daemon/retrieval/service.py::RetrievalService` orchestrates all of the above and is what the RPC layer calls into. It also produces the full diagnostic object (`fts_results`, `vector_results`, `rrf_results`, `temporal_scores`, `final_results`, `latencies`) that a future AI Inspector UI will render — the backend already returns this on every `search_hybrid`/`chat` call, it just isn't visualized yet.

Embeddings and chat generation both go through `ai_daemon/api/openai.py::OpenAICompatibleProvider`, which implements the provider-independent `EmbeddingProvider`/`LLMProvider` ABCs in `ai_daemon/api/base.py`. If credentials or network access are absent, indexing still succeeds with `pending_embedding=true`, `search_keyword`/`search_hybrid` still work (FTS5-only), and `search_semantic`/`chat` return a structured, retryable error rather than crashing or hallucinating from empty context. API keys are read only from the `JOURNALY_OPENAI_API_KEY` process environment variable and are never written to the database or logs.

## RPC operations

- `search_keyword`: offline FTS5/BM25 search.
- `search_semantic`: vector-only search; returns `VECTOR_INDEX_UNAVAILABLE` or `EMBEDDING_PROVIDER_UNAVAILABLE` (retryable) if unavailable.
- `search_hybrid`: FTS + vector → RRF → temporal rerank, with the full diagnostic object.
- `chat`: hybrid retrieval → context assembly → LLM generation → citation validation. Returns `NO_CONTEXT_AVAILABLE` if nothing relevant is indexed, or `LLM_PROVIDER_UNAVAILABLE` (retryable) if generation fails.
- `retry_embeddings`: bounded retry of pending chunks into `docs_vec`; it never changes Markdown or removes FTS records.
- `index_file` and `rebuild_index`: recreate the derived index from Markdown.

## sqlite-vec compatibility note

The stock macOS/pyenv Python build disables SQLite extension loading, so `sqlite-vec` cannot load there — `JournalDatabase._load_vector_extension` catches this and falls back to FTS5-only mode (a warning is logged, nothing crashes). A controlled, extension-capable Python 3.12 (arm64, Homebrew-linked SQLite) is provisioned at `ai_daemon/.runtime/arm64` via `scripts/create_controlled_runtime.sh` + `scripts/validate_runtime.py`; that runtime was validated this session (`sqlite-vec v0.1.9`, `vec0` create/insert/KNN all pass) and is what `docs_vec` actually requires. Point `JOURNALY_PYTHON` at `ai_daemon/.runtime/arm64/bin/python` to get semantic search; anything else silently degrades to keyword-only search rather than failing.

If the configured embedding model or its dimension changes, `JournalDatabase._ensure_vector_schema` drops and recreates `docs_vec` and re-arms `pending_embedding` on every entry — Markdown and FTS5 are untouched, only derived vector data is rebuilt (AGENT.md sec.22).

FTS5 query note: FTS5's *query parser* (not its tokenizer) treats punctuation like `?`, `-`, `:`, `*` as operators, so a natural-language question like `"restaurants?"` was a syntax error, not just a non-match. `sanitize_fts_query` extracts word tokens and quotes each one individually before building the MATCH expression, which fixed this but changes semantics from substring/phrase matching to implicit AND-of-terms — acceptable for a keyword path that sits alongside semantic search for recall, but worth knowing if `search_keyword` results look stricter than expected for long queries (AGENT.md sec.16 asks us to verify FTS5 behavior rather than assume it).

FTS5 tokenizer note: `docs_fts` is created with `tokenize='porter unicode61'`. The default `unicode61` tokenizer does no stemming, so a query for `restaurant` would not match journal text containing only `restaurants` — the RAG eval harness (below) caught this directly (recall was 0.78, below the 0.8 threshold, entirely because of a singular/plural mismatch). Porter stemming is built into SQLite core (not an extension), works identically on the extension-capable and fallback runtimes, and fixed the eval failure outright. Because `docs_fts` is created `IF NOT EXISTS`, this only applies going forward — an existing on-disk `journal_index.db` created before this change keeps its old tokenizer until `rebuild_index` recreates the database from scratch (nothing production has shipped yet, so no migration path was built for this).

## Streaming (deliberate deviation, not yet implemented)

AGENT.md sec.30/36 call for streaming chat responses. This backend pass implements `chat` as a single non-streaming JSON-RPC response, because there's no frontend consumer yet to stream *to* — line-delimited JSON-RPC over stdio could support streaming via partial-result notifications, but building that without a UI to verify it against risked getting the framing wrong. This should be revisited when `Chat.tsx` is built (see "What's left" below).

## RAG evaluation

`tests/eval_set.json` + `tests/rag/test_eval.py` compute Recall@K (`K=5`, threshold `0.8`) against a small fixture journal at `tests/fixtures/Journal/` that reproduces the "belief changes over time" restaurant example from AGENT.md sec.26 (Jan: wants to start one, Mar: reconsiders, Jun: decides against it) plus an unrelated control entry. `expected_chunk_ids` from the spec's example schema is replaced with `expected_entry_titles`, because chunk ids are UUIDs minted at index time — a static JSON fixture can't pin them without also seeding UUID generation, which would obscure what the eval is actually checking.

**Status: passing.** `ai_daemon/.runtime/arm64/bin/python -m pytest ai_daemon/tests tests -q` → 28 passed; `ai_daemon/.venv312/bin/python3 -m pytest ai_daemon/tests tests -q` → 26 passed, 2 skipped (the 2 skips are vector-path tests correctly gated to the extension-capable runtime). Getting there required the `tokenize='porter unicode61'` fix described above — the eval harness is what caught the missing-stemming bug in the first place.

## What's left before Phase 4 (backend) is fully done

Nothing — the backend RAG pipeline (embeddings, hybrid search, temporal reranking, context assembly/prompt-injection defense, citations, chat, structured errors, eval harness) is implemented and the full test suite passes on both runtimes. What's left is everything explicitly out of scope for this pass, listed below.

## Explicitly out of scope for this pass (next pass, per the approved plan)

Frontend `Search.tsx` (normal/AI mode toggle), `Chat.tsx`, `Citation.tsx`, `Inspector.tsx` (the backend already returns everything the Inspector needs, it just isn't rendered); streaming chat; an Anthropic provider (the `LLMProvider`/`EmbeddingProvider` abstraction in `ai_daemon/api/base.py` was built so this only requires a new `ai_daemon/api/anthropic.py`, no retrieval/indexing changes); macOS Keychain integration (API key currently comes from `JOURNALY_OPENAI_API_KEY` env var only); database corruption recovery (integrity check + rename-and-rebuild on startup); concurrent-edit conflict UI (the Rust layer already detects the conflict via `expected_content`, per `commands.rs::save_entry`, but there's no UI to resolve it).
