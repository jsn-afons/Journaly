"""ACT-R-inspired temporal reranking.

This is a configurable heuristic, not a validated model of the user's cognition
(AGENT.md sec.51). It blends recency and recurrence with the RRF relevance score
so that recent, actively-revisited thoughts are favored without silently burying
intentional retrieval of older ones (AGENT.md sec.25-26).
"""
from __future__ import annotations
import math
from dataclasses import dataclass
from datetime import UTC, datetime


@dataclass(frozen=True)
class TemporalWeights:
    recency_half_life_days: float = 30.0
    recency_weight: float = 0.7
    recurrence_weight: float = 0.3
    temporal_blend: float = 0.35  # 0 = pure relevance, 1 = pure temporal


def temporal_score(age_days: float, recurrence_count: int, weights: TemporalWeights = TemporalWeights()) -> float:
    recency = 0.5 ** (max(age_days, 0.0) / weights.recency_half_life_days)
    recurrence = math.log1p(max(recurrence_count, 0)) / math.log1p(10)
    return weights.recency_weight * recency + weights.recurrence_weight * min(recurrence, 1.0)


def rerank(
    entries: list[dict[str, object]],
    weights: TemporalWeights = TemporalWeights(),
    now: datetime | None = None,
) -> list[dict[str, object]]:
    """entries need 'chunk_id', 'rrf_score', 'created_at' (ISO-8601), and optionally 'recurrence_count'."""
    if not entries: return []
    now = now or datetime.now(UTC)
    max_relevance = max(entry["rrf_score"] for entry in entries) or 1.0
    scored = []
    for entry in entries:
        created_at = datetime.fromisoformat(str(entry["created_at"]).replace("Z", "+00:00"))
        age_days = (now - created_at).total_seconds() / 86400
        t_score = temporal_score(age_days, int(entry.get("recurrence_count", 0)), weights)
        relevance = entry["rrf_score"] / max_relevance
        final_score = (1 - weights.temporal_blend) * relevance + weights.temporal_blend * t_score
        scored.append({**entry, "temporal_score": t_score, "final_score": final_score})
    return sorted(scored, key=lambda entry: entry["final_score"], reverse=True)
