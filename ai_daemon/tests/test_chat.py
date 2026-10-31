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
        self.last_messages = messages
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

    def test_follow_up_question_uses_conversation_memory(self):
        entry_id = self._entry_id()
        provider = StubLLMProvider(f"About the restaurant [entry:{entry_id}].")
        service = RetrievalService(self.database, provider, provider)
        history = [
            {"role": "user", "content": "What did I say about a restaurant?"},
            {"role": "assistant", "content": f"You wanted to start one [entry:{entry_id}]."},
        ]
        # "Why?" alone matches nothing in the journal; the previous question makes retrieval find the entry.
        with self.assertRaises(RetrievalUnavailable):
            asyncio.run(service.chat("Why?"))
        result = asyncio.run(service.chat("Why?", history=history))
        self.assertEqual(result["citations"], [entry_id])
        roles = [m["role"] for m in provider.last_messages]
        self.assertEqual(roles, ["system", "user", "assistant", "user"])
        self.assertEqual(provider.last_messages[2]["content"], "You wanted to start one .")  # old citation ids removed
        self.assertTrue(provider.last_messages[-1]["content"].startswith("USER QUERY:\nWhy?"))

    def test_chat_returns_only_verified_citations(self):
        entry_id = self._entry_id()
        provider = StubLLMProvider(f"You wanted to open a restaurant [entry:{entry_id}] and also [entry:00000000-0000-0000-0000-000000000000].")
        service = RetrievalService(self.database, provider, provider)
        result = asyncio.run(service.chat("restaurant"))
        self.assertEqual(result["citations"], [entry_id])
        self.assertIn("restaurant", result["answer"])
        self.assertIn("final_results", result["diagnostics"])

    def test_chat_finds_context_for_natural_language_question(self):
        # Regression: AND-ing filler words ("what have I thought about") used to return no context.
        provider = StubLLMProvider("ok")
        service = RetrievalService(self.database, provider, provider)
        result = asyncio.run(service.chat("What have I thought about restaurants?"))
        self.assertTrue(result["diagnostics"]["final_results"])

    def test_chat_streams_pieces_and_validates_citations_on_full_answer(self):
        entry_id = self._entry_id()
        provider = StubLLMProvider(f"Restaurant [entry:{entry_id}] fake [entry:00000000-0000-0000-0000-000000000000]")
        service = RetrievalService(self.database, provider, provider)
        pieces: list[str] = []
        result = asyncio.run(service.chat("restaurant", pieces.append))
        self.assertEqual("".join(pieces), result["answer"])
        self.assertEqual(result["citations"], [entry_id])

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
            asyncio.run(service.chat("zzzznotfound qqqqmissing"))
        self.assertEqual(context.exception.code, "NO_CONTEXT_AVAILABLE")
