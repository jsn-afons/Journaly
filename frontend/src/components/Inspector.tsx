import type { RetrievalDiagnostics } from "../types/ai";
import { titleFromPath } from "./Citation";

/** Debug view of why each result was retrieved (AGENT.md sec.24, 43). Every stage the backend reports is shown. */
export function Inspector({ diagnostics }: { diagnostics: RetrievalDiagnostics | null }) {
  if (!diagnostics) return <div className="inspector"><h2>Inspector</h2><p className="notice">Run an AI search or chat question to see how results were ranked.</p></div>;
  const byChunk = new Map(diagnostics.final_results.map((c) => [c.chunk_id, c]));
  const label = (id: string) => { const c = byChunk.get(id); return c ? `${titleFromPath(c.filepath)}${c.heading ? ` › ${c.heading}` : ""}` : id.slice(0, 8); };
  return <div className="inspector">
    <h2>Inspector</h2>
    <p className="query">“{diagnostics.query}”</p>
    <h3>Latency</h3>
    <ul>{Object.entries(diagnostics.latencies).map(([k, v]) => <li key={k}>{k.replace(/_seconds$/, "")}: {(v * 1000).toFixed(0)} ms</li>)}</ul>
    <h3>FTS5 (BM25)</h3>
    <ol>{diagnostics.fts_results.map((r) => <li key={r.chunk_id}>{titleFromPath(r.filepath)} <small>{r.score.toFixed(2)}</small></li>)}</ol>
    <h3>Vector</h3>
    {diagnostics.vector_error && <p className="notice">{diagnostics.vector_error}</p>}
    <ol>{diagnostics.vector_results.map((r) => <li key={r.chunk_id}>{titleFromPath(r.filepath)} <small>distance {r.distance.toFixed(3)}</small></li>)}</ol>
    <h3>RRF</h3>
    <ol>{diagnostics.rrf_results.map((r) => <li key={r.chunk_id}>{label(r.chunk_id)} <small>{r.score.toFixed(4)}</small></li>)}</ol>
    <h3>Temporal</h3>
    <ol>{diagnostics.temporal_scores.map((r) => <li key={r.chunk_id}>{label(r.chunk_id)} <small>{r.score.toFixed(4)}</small></li>)}</ol>
    <h3>Final context</h3>
    <ol>{diagnostics.final_results.map((r) => <li key={r.chunk_id}>{label(r.chunk_id)} <small>recurrence {r.recurrence_count}</small></li>)}</ol>
  </div>;
}
