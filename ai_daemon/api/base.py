"""Provider contracts; retrieval code never depends on a vendor SDK."""
from __future__ import annotations
from abc import ABC, abstractmethod

class ProviderUnavailable(RuntimeError): pass

class EmbeddingProvider(ABC):
    @abstractmethod
    async def generate_embeddings(self, texts: list[str]) -> list[list[float]]: ...

class LLMProvider(EmbeddingProvider, ABC):
    @abstractmethod
    async def generate(self, messages: list[dict[str, str]], response_schema: dict | None = None) -> str: ...

class UnavailableEmbeddingProvider(EmbeddingProvider):
    async def generate_embeddings(self, texts: list[str]) -> list[list[float]]:
        raise ProviderUnavailable("No embedding provider is configured")
