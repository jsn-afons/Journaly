"""RAG evaluation harness (AGENT.md sec.42): Recall@K over tests/eval_set.json.

Fixture Markdown files are copied into a temp dir before indexing because indexing
injects UUID/created_at frontmatter into any file that lacks it (AGENT.md sec.10) —
running it directly against tests/fixtures would dirty a checked-in fixture on every
run. expected_chunk_ids from the spec is replaced here with expected_entry_titles:
chunk ids are UUIDs minted at index time, so a static JSON fixture can't pin them
without also seeding UUID generation, which would obscure the eval's actual intent.
"""
from __future__ import annotations
import asyncio
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from ai_daemon.core.database import JournalDatabase
from ai_daemon.indexer.pipeline import JournalIndexer
from ai_daemon.retrieval.service import RetrievalService
from ai_daemon.api.base import LLMProvider, ProviderUnavailable

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "Journal"
EVAL_SET = Path(__file__).resolve().parent.parent / "eval_set.json"
RECALL_THRESHOLD = 0.8
TOP_K = 5


class _UnavailableProvider(LLMProvider):
    async def generate_embeddings(self, texts):
        raise ProviderUnavailable("no embedding provider configured for the eval harness")

    async def generate(self, messages, response_schema=None):
        raise ProviderUnavailable("no LLM provider configured for the eval harness")


class RagEvalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name) / "Journal"
        shutil.copytree(FIXTURES, root)
        self.database = JournalDatabase(Path(self.temp.name) / "index.db")
        self.indexer = JournalIndexer(root, self.database)
        summary = self.indexer.rebuild()
        self.assertEqual(summary["files_failed"], 0)
        self.service = RetrievalService(self.database, _UnavailableProvider(), _UnavailableProvider())
        self.cases = json.loads(EVAL_SET.read_text())

    def tearDown(self):
        self.temp.cleanup()

    def test_recall_at_k_meets_threshold(self):
        recalls = []
        for case in self.cases:
            result = asyncio.run(self.service.search_hybrid(case["query"]))
            retrieved_titles = {Path(entry["filepath"]).stem for entry in result["final_results"][:TOP_K]}
            expected = set(case["expected_entry_titles"])
            hit = expected & retrieved_titles
            recall = len(hit) / len(expected)
            recalls.append(recall)
            self.assertTrue(hit, f"query {case['query']!r} retrieved none of {expected} (got {retrieved_titles})")
        average_recall = sum(recalls) / len(recalls)
        self.assertGreaterEqual(average_recall, RECALL_THRESHOLD, f"Recall@{TOP_K} {average_recall:.2f} below threshold; recalls={recalls}")
