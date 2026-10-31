# AI providers

Journaly talks to AI services through one HTTP client, `ai_daemon/api/openai.py::OpenAICompatibleProvider`, which speaks the **OpenAI-compatible API** (`/v1/chat/completions`, `/v1/embeddings`). That is the de-facto standard, so it works with OpenAI, **Ollama**, LM Studio, vLLM, OpenRouter, Together, Groq, and many others — no code changes, only configuration. Retrieval and indexing depend only on the `EmbeddingProvider`/`LLMProvider` interfaces in `ai_daemon/api/base.py`.

Chat and embeddings are configured **independently**, so you can mix (e.g. local Ollama embeddings + a hosted chat model).

## Changing provider in the app (normal way)

Open the **AI settings** tab. For **Chat** and for **Semantic search** separately:

1. Pick a provider (Ollama, LM Studio, OpenAI, OpenRouter, or Custom). This fills in the server URL.
2. Type a model name, or press **Find models** to list what that server offers.
3. Paste an API key if the provider needs one. It goes straight into the **macOS Keychain**; the screen afterwards only shows "Saved in macOS Keychain" with a **Remove** button. Keys are never shown again, written to a file, or sent back to the UI.
4. Press **Save & test**. The app saves, restarts its AI service with the new settings, and makes one tiny request to each endpoint, showing ✓/✗ with the reason. If the embedding size is wrong it is corrected automatically to what the model really returns (only the embedding check is re-run). If embeddings work, the journal is re-embedded in the background.

A yellow notice warns whenever an endpoint is not on your computer, since journal text is sent to it. If Chat fails with a provider error, the message includes an **Open AI settings** button.

Where things are stored:
- Settings: `~/Library/Application Support/com.journaly.app/provider-settings.json` (override with `JOURNALY_SETTINGS`). Written atomically; contains no secrets.
- Keys: macOS Keychain, service `com.journaly.app`, accounts `chat-api-key` / `embedding-api-key`. Rust reads them only when starting the AI service and passes them in its environment.
- Once settings have been saved in the app, they take precedence over the `JOURNALY_CHAT_*`/`JOURNALY_EMBEDDING_*` environment variables below.

## Configuration for developers (files and environment)

Settings are read in this order (later wins): built-in defaults (OpenAI) → `journaly.config.json` in the repo root (or the path in `JOURNALY_CONFIG`) → environment variables.

| Setting (file key) | Environment variable | Default |
|---|---|---|
| `chat_base_url` | `JOURNALY_CHAT_BASE_URL` | `https://api.openai.com/v1` |
| `chat_model` | `JOURNALY_CHAT_MODEL` | `gpt-4o-mini` |
| `embedding_base_url` | `JOURNALY_EMBEDDING_BASE_URL` | `https://api.openai.com/v1` |
| `embedding_model` | `JOURNALY_EMBEDDING_MODEL` | `text-embedding-3-small` |
| `embedding_dimensions` | `JOURNALY_EMBEDDING_DIMENSIONS` | `1536` |
| `send_embedding_dimensions` | `JOURNALY_SEND_EMBEDDING_DIMENSIONS` | only for `api.openai.com` |
| `provider_timeout_seconds` | `JOURNALY_PROVIDER_TIMEOUT_SECONDS` | `120` |
| *(env only)* | `JOURNALY_CHAT_API_KEY`, `JOURNALY_EMBEDDING_API_KEY` | falls back to `JOURNALY_OPENAI_API_KEY` |

- **API keys are never read from the config file** (a key in the file is rejected at startup) and never logged or returned in dumps. In the app they live in the Keychain (above).
- A key is optional for local servers. It is required only for `api.openai.com`, where a missing key fails immediately.
- **`embedding_dimensions` must equal the model's real output size** (e.g. 768 for `nomic-embed-text`, 1536 for `text-embedding-3-small`). A mismatch is rejected and nothing is stored. Changing the embedding model or dimensions rebuilds the vector index automatically and re-embeds in the background; your Markdown is never touched.
- Errors from providers report the HTTP status (404 → model not found, 401/403 → check key) but never the response body.

## Example: fully local with Ollama

```bash
ollama pull nomic-embed-text      # embeddings (about 270 MB); verified working. Pull a chat model too, e.g. one you already have
cp journaly.config.example.json journaly.config.json
```

Then launch the app. Without an embedding model, keyword search and chat retrieval still work (FTS only); semantic search starts working once embeddings succeed.

## Known limits

- Only the OpenAI-compatible API is implemented. Native Anthropic and Gemini APIs would each need their own provider file (or use them through OpenRouter / an OpenAI-compatible gateway).
- Local "thinking" models can be slow: a 4B model on this machine took ~112 s to answer one chat. The Rust side allows 180 s per AI call.
- Small models don't always follow citation formatting. The backend accepts `[entry:<uuid>]` and bare `[<uuid>]`, and still discards any id that wasn't retrieved.
- Chat answers from small models can misstate details (the live test described all entries as written on one day because the test fixtures had no timestamps). Check citations.
