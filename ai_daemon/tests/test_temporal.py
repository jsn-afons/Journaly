import unittest
from datetime import UTC, datetime
from ai_daemon.retrieval.temporal import TemporalWeights, rerank, temporal_score


class TemporalScoreTests(unittest.TestCase):
    def test_recency_decays_with_age(self):
        weights = TemporalWeights()
        self.assertGreater(temporal_score(0, 0, weights), temporal_score(365, 0, weights))

    def test_recurrence_increases_score(self):
        weights = TemporalWeights()
        self.assertGreater(temporal_score(30, 10, weights), temporal_score(30, 0, weights))


class RerankTests(unittest.TestCase):
    def test_relevance_still_matters_not_purely_recency(self):
        """A much more relevant old entry can still beat a barely-relevant new one (sec.25)."""
        now = datetime(2026, 1, 1, tzinfo=UTC)
        entries = [
            {"chunk_id": "old-highly-relevant", "rrf_score": 1.0, "created_at": "2020-01-01T00:00:00Z", "recurrence_count": 0},
            {"chunk_id": "new-barely-relevant", "rrf_score": 0.01, "created_at": "2025-12-31T00:00:00Z", "recurrence_count": 0},
        ]
        weights = TemporalWeights(temporal_blend=0.2)
        ranked = rerank(entries, weights, now=now)
        self.assertEqual(ranked[0]["chunk_id"], "old-highly-relevant")

    def test_recent_entry_can_overtake_when_relevance_is_close(self):
        now = datetime(2026, 1, 1, tzinfo=UTC)
        entries = [
            {"chunk_id": "old", "rrf_score": 1.0, "created_at": "2020-01-01T00:00:00Z", "recurrence_count": 0},
            {"chunk_id": "new", "rrf_score": 0.95, "created_at": "2025-12-31T00:00:00Z", "recurrence_count": 0},
        ]
        ranked = rerank(entries, TemporalWeights(temporal_blend=0.7), now=now)
        self.assertEqual(ranked[0]["chunk_id"], "new")

    def test_empty_entries_returns_empty(self):
        self.assertEqual(rerank([]), [])
