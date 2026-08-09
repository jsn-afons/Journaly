import asyncio
import tempfile
import unittest
from pathlib import Path

from ai_daemon.api.base import EmbeddingProvider, LLMProvider, ProviderUnavailable
from ai_daemon.core.database import JournalDatabase
from ai_daemon.indexer.pipeline import JournalIndexer
from ai_daemon.retrieval.service import RetrievalService, RetrievalUnavailable


class StubEmbeddingProvider(EmbeddingProvider):
    async def generate_embeddings(self, texts):
        raise ProviderUnavailable("no embedding provider configured for this test")


class StubLLMProvider(StubEmbeddingProvider, LLMProvider):
    def __init__(self, answer: str | None = None):
        self.answer = answer

    async def generate(self, messages, response_schema=None):
        if self.answer is None:
            raise ProviderUnavailable("chat provider unavailable")
        return self.answer


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "Journal"
        (self.root / "2026/08").mkdir(parents=True)
        self.database = JournalDatabase(Path(self.temp.name) / "index.db")
        (self.root / "2026/08/Ideas.md").write_text("# Business\nI want to start a restaurant.\n")
        JournalIndexer(self.root, self.database).rebuild()

    def tearDown(self):
        self.temp.cleanup()

    def _entry_id(self) -> str:
        with self.database.connection() as connection:
            return connection.execute("SELECT id FROM journal_entries LIMIT 1").fetchone()[0]

    def test_chat_returns_only_verified_citations(self):
        entry_id = self._entry_id()
        provider = StubLLMProvider(f"You wanted to open a restaurant [entry:{entry_id}] and also [entry:00000000-0000-0000-0000-000000000000].")
        service = RetrievalService(self.database, provider, provider)
        result = asyncio.run(service.chat("restaurant"))
        self.assertEqual(result["citations"], [entry_id])
        self.assertIn("restaurant", result["answer"])
        self.assertIn("final_results", result["diagnostics"])

    def test_chat_reports_structured_error_when_llm_unavailable(self):
        provider = StubLLMProvider(answer=None)
        service = RetrievalService(self.database, provider, provider)
        with self.assertRaises(RetrievalUnavailable) as context:
            asyncio.run(service.chat("restaurant"))
        self.assertEqual(context.exception.code, "LLM_PROVIDER_UNAVAILABLE")
        self.assertTrue(context.exception.retryable)

    def test_chat_reports_no_context_available_without_crashing(self):
        provider = StubLLMProvider("should never be called")
        service = RetrievalService(self.database, provider, provider)
        with self.assertRaises(RetrievalUnavailable) as context:
            asyncio.run(service.chat("a query matching nothing at all zzzznotfound"))
        self.assertEqual(context.exception.code, "NO_CONTEXT_AVAILABLE")
