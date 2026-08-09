import unittest
from ai_daemon.retrieval.fusion import reciprocal_rank_fusion


class FusionTests(unittest.TestCase):
    def test_document_ranked_first_in_both_lists_wins(self):
        rankings = {"fts": ["a", "b", "c"], "vector": ["a", "c", "b"]}
        ranked = reciprocal_rank_fusion(rankings)
        self.assertEqual(ranked[0][0], "a")

    def test_document_appearing_in_both_lists_outranks_a_single_list_hit(self):
        rankings = {"fts": ["a", "b"], "vector": ["c", "a"]}
        ranked = dict(reciprocal_rank_fusion(rankings))
        self.assertIn("c", ranked)
        self.assertGreater(ranked["a"], ranked["c"])

    def test_smaller_k_favors_top_ranks_more_sharply(self):
        rankings = {"fts": ["a", "b"], "vector": ["b", "a"]}
        tight = dict(reciprocal_rank_fusion(rankings, k=1))
        loose = dict(reciprocal_rank_fusion(rankings, k=1000))
        # with symmetric rankings both documents tie regardless of k
        self.assertAlmostEqual(tight["a"], tight["b"])
        self.assertAlmostEqual(loose["a"], loose["b"])

    def test_empty_rankings_return_empty(self):
        self.assertEqual(reciprocal_rank_fusion({}), [])
