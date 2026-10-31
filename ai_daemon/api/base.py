"""Provider contracts; retrieval code never depends on a vendor SDK."""
from __future__ import annotations
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

class ProviderUnavailable(RuntimeError): pass

class EmbeddingProvider(ABC):
    @abstractmethod
    async def generate_embeddings(self, texts: list[str]) -> list[list[float]]: ...

class LLMProvider(EmbeddingProvider, ABC):
    @abstractmethod
    async def generate(self, messages: list[dict[str, str]], response_schema: dict | None = None) -> str: ...

    async def generate_stream(self, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        """Yield the answer in pieces. Providers without streaming fall back to one piece, so callers need no special case."""
        yield await self.generate(messages)

class UnavailableEmbeddingProvider(EmbeddingProvider):
    async def generate_embeddings(self, texts: list[str]) -> list[list[float]]:
        raise ProviderUnavailable("No embedding provider is configured")
