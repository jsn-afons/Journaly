"""OpenAI-compatible HTTP provider: works with OpenAI, Ollama (/v1), LM Studio, OpenRouter, vLLM, etc.

Chat and embeddings have independent endpoints. An API key is optional for non-OpenAI hosts
(local servers need none) but required for api.openai.com, where a missing key fails fast.
"""
from __future__ import annotations
import json
from collections.abc import AsyncIterator
from urllib.parse import urlparse
import httpx
from ai_daemon.api.base import LLMProvider, ProviderUnavailable
from ai_daemon.core.config import DaemonConfig

OPENAI_HOST = "api.openai.com"

def _describe(error: httpx.HTTPError) -> str:
    """Status code or error type only — never the response body, which could echo journal text or credentials."""
    if isinstance(error, httpx.HTTPStatusError):
        code = error.response.status_code
        hint = " (model not found — is it pulled/available on that server?)" if code == 404 else " (check the API key)" if code in (401, 403) else ""
        return f"HTTP {code}{hint}"
    return type(error).__name__

class OpenAICompatibleProvider(LLMProvider):
    def __init__(self, chat_base_url: str, chat_model: str, embedding_base_url: str, embedding_model: str, dimensions: int,
                 chat_api_key: str | None = None, embedding_api_key: str | None = None,
                 send_dimensions: bool | None = None, timeout_seconds: float = 120) -> None:
        self.chat_base_url, self.chat_model, self.chat_api_key = chat_base_url.rstrip("/"), chat_model, chat_api_key
        self.embedding_base_url, self.embedding_model, self.embedding_api_key = embedding_base_url.rstrip("/"), embedding_model, embedding_api_key
        self.dimensions, self.timeout_seconds = dimensions, timeout_seconds
        self.send_dimensions = urlparse(self.embedding_base_url).hostname == OPENAI_HOST if send_dimensions is None else send_dimensions

    @classmethod
    def from_config(cls, config: DaemonConfig) -> "OpenAICompatibleProvider":
        return cls(config.chat_base_url, config.chat_model, config.embedding_base_url, config.embedding_model, config.embedding_dimensions,
                   config.chat_api_key, config.embedding_api_key, config.send_embedding_dimensions, config.provider_timeout_seconds)

    def _client(self, base_url: str, api_key: str | None) -> httpx.AsyncClient:
        if not api_key and urlparse(base_url).hostname == OPENAI_HOST:
            raise ProviderUnavailable("OpenAI credentials are unavailable (set JOURNALY_OPENAI_API_KEY)")
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        return httpx.AsyncClient(base_url=base_url, headers=headers, timeout=httpx.Timeout(self.timeout_seconds))

    async def _embed(self, texts: list[str]) -> list[list[float]]:
        payload: dict[str, object] = {"model": self.embedding_model, "input": texts}
        if self.send_dimensions: payload["dimensions"] = self.dimensions
        try:
            async with self._client(self.embedding_base_url, self.embedding_api_key) as client:
                response = await client.post("/embeddings", json=payload)
                response.raise_for_status(); return [item["embedding"] for item in response.json()["data"]]
        except httpx.HTTPError as error: raise ProviderUnavailable(f"Embedding provider unavailable: {_describe(error)}") from error
        except (KeyError, TypeError, ValueError) as error: raise ProviderUnavailable("Embedding provider returned an unexpected response") from error

    async def generate_embeddings(self, texts: list[str]) -> list[list[float]]:
        vectors = await self._embed(texts)
        if len(vectors) != len(texts) or any(len(vector) != self.dimensions for vector in vectors):
            raise ProviderUnavailable(f"Embedding provider returned vectors of a different size than the configured {self.dimensions} dimensions")
        return vectors

    async def probe_embedding_dimensions(self) -> int:
        """Embed one string and report the vector size the model really returns (no size check), for the settings UI."""
        [vector] = await self._embed(["dimension probe"])
        return len(vector)

    async def generate(self, messages: list[dict[str, str]], response_schema: dict | None = None, max_tokens: int | None = None) -> str:
        payload: dict[str, object] = {"model": self.chat_model, "messages": messages, "temperature": 0.2}
        if max_tokens is not None: payload["max_tokens"] = max_tokens
        if response_schema is not None:
            payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "response", "schema": response_schema, "strict": True}}
        try:
            async with self._client(self.chat_base_url, self.chat_api_key) as client:
                response = await client.post("/chat/completions", json=payload)
                response.raise_for_status()
                return str(response.json()["choices"][0]["message"]["content"])
        except httpx.HTTPError as error: raise ProviderUnavailable(f"Chat provider unavailable: {_describe(error)}") from error
        except (KeyError, IndexError, TypeError, ValueError) as error: raise ProviderUnavailable("Chat provider returned an unexpected response") from error

    async def generate_stream(self, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        """Server-sent events (`stream: true`). A server that ignores the flag and returns plain JSON is handled too."""
        payload = {"model": self.chat_model, "messages": messages, "temperature": 0.2, "stream": True}
        try:
            async with self._client(self.chat_base_url, self.chat_api_key) as client:
                async with client.stream("POST", "/chat/completions", json=payload) as response:
                    response.raise_for_status()
                    if "text/event-stream" not in response.headers.get("content-type", ""):
                        body = json.loads(await response.aread())
                        yield str(body["choices"][0]["message"]["content"]); return
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"): continue
                        data = line[5:].strip()
                        if data == "[DONE]": return
                        delta = (json.loads(data).get("choices") or [{}])[0].get("delta", {}).get("content")
                        if delta: yield delta
        except httpx.HTTPError as error: raise ProviderUnavailable(f"Chat provider unavailable: {_describe(error)}") from error
        except (KeyError, IndexError, TypeError, ValueError) as error: raise ProviderUnavailable("Chat provider returned an unexpected response") from error


async def list_models(base_url: str, api_key: str | None, timeout_seconds: float = 10) -> list[str]:
    """Model ids offered by an OpenAI-compatible endpoint (GET /models). Works for Ollama, LM Studio, OpenAI, OpenRouter."""
    base = base_url.rstrip("/")
    if urlparse(base).scheme not in ("http", "https"): raise ProviderUnavailable("URL must start with http:// or https://")
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(base_url=base, headers=headers, timeout=httpx.Timeout(timeout_seconds)) as client:
            response = await client.get("/models"); response.raise_for_status()
            return sorted({str(item["id"]) for item in response.json()["data"]})
    except httpx.HTTPError as error: raise ProviderUnavailable(f"Could not list models: {_describe(error)}") from error
    except (KeyError, TypeError, ValueError) as error: raise ProviderUnavailable("Endpoint did not return a model list") from error
