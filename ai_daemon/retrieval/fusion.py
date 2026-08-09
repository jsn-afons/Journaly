"""Reciprocal Rank Fusion: merges independent rankings without hard-coding the algorithm elsewhere."""
from __future__ import annotations

DEFAULT_K = 60


def reciprocal_rank_fusion(rankings: dict[str, list[str]], k: int = DEFAULT_K) -> list[tuple[str, float]]:
    """rankings maps a path name (e.g. "fts", "vector") to a doc_id list already ordered best-first."""
    scores: dict[str, float] = {}
    for ranking in rankings.values():
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda item: item[1], reverse=True)
