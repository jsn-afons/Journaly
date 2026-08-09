from __future__ import annotations
import httpx
from ai_daemon.api.base import LLMProvider, ProviderUnavailable

class OpenAICompatibleProvider(LLMProvider):
    def __init__(self, api_key: str | None, base_url: str, embedding_model: str, dimensions: int, chat_model: str = "gpt-4o-mini") -> None:
        self.api_key, self.base_url, self.embedding_model, self.dimensions, self.chat_model = api_key, base_url.rstrip("/"), embedding_model, dimensions, chat_model
    def _client(self) -> httpx.AsyncClient:
        if not self.api_key: raise ProviderUnavailable("OpenAI-compatible provider credentials are unavailable")
        return httpx.AsyncClient(base_url=self.base_url, headers={"Authorization": f"Bearer {self.api_key}"}, timeout=httpx.Timeout(30))
    async def generate_embeddings(self, texts: list[str]) -> list[list[float]]:
        try:
            async with self._client() as client:
                response = await client.post("/embeddings", json={"model": self.embedding_model, "input": texts, "dimensions": self.dimensions})
                response.raise_for_status(); payload = response.json(); vectors = [item["embedding"] for item in payload["data"]]
                if len(vectors) != len(texts) or any(len(vector) != self.dimensions for vector in vectors): raise ProviderUnavailable("Embedding provider returned an unexpected vector dimension")
                return vectors
        except httpx.HTTPError as error: raise ProviderUnavailable("Embedding provider unavailable") from error
    async def generate(self, messages: list[dict[str, str]], response_schema: dict | None = None) -> str:
        payload: dict[str, object] = {"model": self.chat_model, "messages": messages, "temperature": 0.2}
        if response_schema is not None:
            payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "response", "schema": response_schema, "strict": True}}
        try:
            async with self._client() as client:
                response = await client.post("/chat/completions", json=payload)
                response.raise_for_status()
                data = response.json()
                return str(data["choices"][0]["message"]["content"])
        except httpx.HTTPError as error: raise ProviderUnavailable("Chat provider unavailable") from error
        except (KeyError, IndexError) as error: raise ProviderUnavailable("Chat provider returned an unexpected response") from error
