"""Orchestrates hybrid retrieval, temporal reranking, context assembly, and chat.

Mirrors JournalIndexer's role for the indexing pipeline: RPC handlers stay thin,
this owns the actual FTS+vector -> RRF -> temporal -> context -> LLM flow and
produces the diagnostic object the AI Inspector will render (AGENT.md sec.24, 43).
"""
from __future__ import annotations
import time
from datetime import UTC, datetime

from ai_daemon.api.base import EmbeddingProvider, LLMProvider, ProviderUnavailable
from ai_daemon.core.database import JournalDatabase
from ai_daemon.retrieval.context import assemble_context, build_messages, extract_valid_citations
from ai_daemon.retrieval.fusion import reciprocal_rank_fusion
from ai_daemon.retrieval.search import chunk_lookup, fts_search, recurrence_counts, record_retrievals, vector_search
from ai_daemon.retrieval.temporal import TemporalWeights, rerank


class RetrievalUnavailable(RuntimeError):
    """Structured, JSON-RPC-friendly error (AGENT.md sec.39) — never a bare stack trace."""

    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class RetrievalService:
    def __init__(
        self,
        database: JournalDatabase,
        embedding_provider: EmbeddingProvider,
        llm_provider: LLMProvider,
        limit: int = 25,
        temporal_weights: TemporalWeights | None = None,
    ) -> None:
        self.database = database
        self.embedding_provider = embedding_provider
        self.llm_provider = llm_provider
        self.limit = limit
        self.temporal_weights = temporal_weights or TemporalWeights()

    async def search_semantic(self, query: str) -> dict[str, object]:
        with self.database.connection() as connection:
            if not self.database.vector_ready(connection):
                raise RetrievalUnavailable("VECTOR_INDEX_UNAVAILABLE", "Semantic search requires the sqlite-vec extension, which is unavailable in this Python runtime")
        started = time.monotonic()
        try:
            [embedding] = await self.embedding_provider.generate_embeddings([query])
        except ProviderUnavailable as error:
            raise RetrievalUnavailable("EMBEDDING_PROVIDER_UNAVAILABLE", str(error), retryable=True) from error
        embedding_seconds = time.monotonic() - started
        with self.database.connection() as connection:
            results = vector_search(connection, embedding, self.limit)
        return {"results": results, "latencies": {"embedding_seconds": embedding_seconds}}

    async def _retrieve_hybrid(self, query: str) -> dict[str, object]:
        latencies: dict[str, float] = {}
        with self.database.connection() as connection:
            started = time.monotonic()
            fts_results = fts_search(connection, query, self.limit)
            latencies["fts_seconds"] = time.monotonic() - started

            vector_results: list[dict[str, object]] = []
            vector_error: str | None = None
            if self.database.vector_ready(connection):
                try:
                    started = time.monotonic()
                    [embedding] = await self.embedding_provider.generate_embeddings([query])
                    vector_results = vector_search(connection, embedding, self.limit)
                    latencies["vector_seconds"] = time.monotonic() - started
                except ProviderUnavailable as error:
                    vector_error = str(error)
            else:
                vector_error = "vector index unavailable"

            rankings = {"fts": [row["chunk_id"] for row in fts_results]}
            if vector_results: rankings["vector"] = [row["chunk_id"] for row in vector_results]
            rrf_ranked = reciprocal_rank_fusion(rankings)

            chunk_meta = chunk_lookup(connection, [chunk_id for chunk_id, _ in rrf_ranked])
            counts = recurrence_counts(connection, list(chunk_meta.keys()))
            candidates = [
                {**chunk_meta[chunk_id], "chunk_id": chunk_id, "rrf_score": score, "recurrence_count": counts.get(chunk_id, 0)}
                for chunk_id, score in rrf_ranked
                if chunk_id in chunk_meta
            ]
            started = time.monotonic()
            final_results = rerank(candidates, self.temporal_weights)[: self.limit]
            latencies["temporal_seconds"] = time.monotonic() - started

            if final_results:
                record_retrievals(connection, [entry["chunk_id"] for entry in final_results], datetime.now(UTC).isoformat())

        return {
            "query": query,
            "fts_results": fts_results,
            "vector_results": vector_results,
            "vector_error": vector_error,
            "rrf_results": [{"chunk_id": chunk_id, "score": score} for chunk_id, score in rrf_ranked],
            "temporal_scores": [{"chunk_id": entry["chunk_id"], "score": entry["temporal_score"]} for entry in final_results],
            "final_results": final_results,
            "latencies": latencies,
        }

    async def search_hybrid(self, query: str) -> dict[str, object]:
        return await self._retrieve_hybrid(query)

    async def chat(self, query: str) -> dict[str, object]:
        diagnostics = await self._retrieve_hybrid(query)
        top_chunks = diagnostics["final_results"]
        if not top_chunks:
            raise RetrievalUnavailable("NO_CONTEXT_AVAILABLE", "No journal content is indexed yet for this query")
        context_xml, known_entry_ids = assemble_context(top_chunks)
        messages = build_messages(query, context_xml)
        started = time.monotonic()
        try:
            answer = await self.llm_provider.generate(messages)
        except ProviderUnavailable as error:
            raise RetrievalUnavailable("LLM_PROVIDER_UNAVAILABLE", str(error), retryable=True) from error
        diagnostics["latencies"]["llm_seconds"] = time.monotonic() - started
        citations = extract_valid_citations(answer, known_entry_ids)
        return {"answer": answer, "citations": citations, "diagnostics": diagnostics}
