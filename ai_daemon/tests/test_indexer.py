import tempfile
import unittest
from pathlib import Path
from ai_daemon.core.database import JournalDatabase
from ai_daemon.indexer.pipeline import JournalIndexer

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
