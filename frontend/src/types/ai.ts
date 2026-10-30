/** Shapes returned by the Python daemon, forwarded verbatim by the Rust `ai_*` commands. */
export interface KeywordHit { chunk_id: string; entry_id: string; filepath: string; created_at: string; heading: string; snippet: string; score: number }
export interface RankedChunk { chunk_id: string; entry_id: string; filepath: string; created_at: string; heading: string; raw_content: string; rrf_score: number; temporal_score: number; recurrence_count: number }
export interface VectorHit { chunk_id: string; entry_id: string; filepath: string; created_at: string; heading: string; distance: number }

export interface RetrievalDiagnostics {
  query: string;
  fts_results: KeywordHit[];
  vector_results: VectorHit[];
  vector_error: string | null;
  rrf_results: { chunk_id: string; score: number }[];
  temporal_scores: { chunk_id: string; score: number }[];
  final_results: RankedChunk[];
  latencies: Record<string, number>;
}

export interface ChatResult { answer: string; citations: string[]; diagnostics: RetrievalDiagnostics }

/** Structured error from Rust (`errors.rs::WireError`). */
export interface AppFailure { code: string; message: string; retryable: boolean }
