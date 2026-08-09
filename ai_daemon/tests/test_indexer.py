import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from ai_daemon.core.database import JournalDatabase
from ai_daemon.indexer.pipeline import JournalIndexer
from ai_daemon.api.base import EmbeddingProvider
from ai_daemon.tests.support import vector_extension_available

class MockEmbeddingProvider(EmbeddingProvider):
    async def generate_embeddings(self, texts): return [[0.1, 0.2] for _ in texts]

class IndexerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name) / "Journal"; (self.root / "2026/08").mkdir(parents=True)
        self.indexer = JournalIndexer(self.root, JournalDatabase(Path(self.temp.name) / "index.db"))
    def tearDown(self): self.temp.cleanup()
    def test_rebuild_searches_structural_chunks_and_skips_unchanged_file(self):
        path = self.root / "2026/08/Ideas.md"; path.write_text("# Business\nNortheastern restaurant idea.\n\n## Software\nA separate thought.")
        summary = self.indexer.rebuild(); self.assertEqual(summary["files_indexed"], 1)
        self.assertEqual(self.indexer.index_file("2026/08/Ideas.md")["status"], "skipped")
        results = self.indexer.search_keyword("Northeastern"); self.assertEqual(len(results), 1); self.assertEqual(results[0]["heading"], "Business")
    def test_removes_deleted_file_from_index(self):
        path = self.root / "2026/08/Ideas.md"; path.write_text("A journal thought")
        self.indexer.index_file("2026/08/Ideas.md"); path.unlink(); self.indexer.index_file("2026/08/Ideas.md")
        self.assertEqual(self.indexer.search_keyword("thought"), [])
    def test_retry_embeddings_without_vector_extension_is_unavailable_and_does_not_crash(self):
        path = self.root / "2026/08/Ideas.md"; path.write_text("A journal thought")
        self.indexer.index_file("2026/08/Ideas.md")
        with patch.object(JournalDatabase, "_load_vector_extension", return_value=False):
            result = asyncio.run(self.indexer.retry_embeddings())
        self.assertEqual(result, {"status": "unavailable", "retried": 0, "completed": 0})
        self.assertEqual(len(self.indexer.search_keyword("thought")), 1, "FTS5 must keep working when vector search is unavailable")
    @unittest.skipUnless(vector_extension_available(), "requires an extension-capable Python (see ai_daemon/.runtime)")
    def test_retry_embeddings_preserves_index_when_provider_unavailable_then_completes(self):
        path = self.root / "2026/08/Ideas.md"; path.write_text("A journal thought")
        self.indexer.index_file("2026/08/Ideas.md")
        self.assertEqual(asyncio.run(self.indexer.retry_embeddings())["status"], "pending")
        database = JournalDatabase(self.indexer.database.path, embedding_dimensions=2)
        provider_indexer = JournalIndexer(self.root, database, MockEmbeddingProvider(), dimensions=2)
        self.assertEqual(asyncio.run(provider_indexer.retry_embeddings())["completed"], 1)
    @unittest.skipUnless(vector_extension_available(), "requires an extension-capable Python (see ai_daemon/.runtime)")
    def test_embedding_model_change_rebuilds_vector_index_without_losing_entries(self):
        path = self.root / "2026/08/Ideas.md"; path.write_text("A journal thought")
        database = JournalDatabase(self.indexer.database.path, embedding_dimensions=2)
        provider_indexer = JournalIndexer(self.root, database, MockEmbeddingProvider(), dimensions=2)
        provider_indexer.index_file("2026/08/Ideas.md")
        asyncio.run(provider_indexer.retry_embeddings())
        with provider_indexer.database.connection() as connection:
            self.assertEqual(connection.execute("SELECT pending_embedding FROM journal_entries").fetchone()[0], 0)
        resized = JournalDatabase(self.indexer.database.path, embedding_dimensions=3)
        with resized.connection() as connection:
            self.assertEqual(connection.execute("SELECT pending_embedding FROM journal_entries").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM docs_fts").fetchone()[0], 1, "reindexing derived vector storage must not touch FTS5/Markdown")
