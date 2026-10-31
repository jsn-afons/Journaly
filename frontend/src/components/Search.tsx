import { useEffect, useRef, useState } from "react";
import { aiRpc, journalRpc } from "../lib/rpc";
import { describeFailure } from "../lib/errors";
import type { RetrievalDiagnostics } from "../types/ai";
import { Icon } from "./Icon";

export type SearchMode = "normal" | "ai";
export interface SearchHit { key: string; path: string; heading: string; snippet: string; created_at: string; score?: number }
/** `hits` is null when the search box is empty (show all entries instead). */
export interface SearchState { query: string; hits: SearchHit[] | null; notice: string; loading: boolean }

interface Props { onChange(state: SearchState): void; onDiagnostics(d: RetrievalDiagnostics): void }

const DEBOUNCE_MS = 250;

/** Pill search in the header. Normal: offline FTS5/BM25. AI: hybrid FTS + vector + RRF + temporal rerank. */
export function Search({ onChange, onDiagnostics }: Props) {
  const [mode, setMode] = useState<SearchMode>("normal");
  const [query, setQuery] = useState("");
  const latest = useRef(0);

  useEffect(() => {
    if (!query.trim()) { onChange({ query, hits: null, notice: "", loading: false }); return; }
    const ticket = ++latest.current;
    onChange({ query, hits: [], notice: "", loading: true });
    const timer = setTimeout(async () => {
      const publish = (hits: SearchHit[], notice = "") => { if (ticket === latest.current) onChange({ query, hits, notice, loading: false }); };
      try {
        if (mode === "ai") {
          const result = await aiRpc.hybrid(query);
          onDiagnostics(result);
          publish(result.final_results.map((c) => ({ key: c.chunk_id, path: c.filepath, heading: c.heading, snippet: c.raw_content.slice(0, 220), created_at: c.created_at, score: c.temporal_score })),
            result.vector_error ? `Keyword results only — ${result.vector_error}` : "");
        } else {
          publish((await aiRpc.keyword(query)).results.map((h) => ({ key: h.chunk_id, path: h.filepath, heading: h.heading, snippet: h.snippet, created_at: h.created_at })));
        }
      } catch (error) {
        if (ticket !== latest.current) return;
        if (mode === "normal") { // keep search usable if the index service is down: fall back to the Rust file scan
          const files = await journalRpc.search(query).catch(() => []);
          publish(files.map((f) => ({ key: f.path, path: f.path, heading: "", snippet: f.excerpt, created_at: f.created_at })), "Index unavailable — showing basic file search");
        } else publish([], describeFailure(error));
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, mode]);

  return <div className="search">
    <div className="search-pill">
      <Icon name="search" size={13} />
      <input aria-label="Search journal" placeholder={mode === "ai" ? "Search by meaning…" : "Search your journal"} value={query} onChange={(e) => setQuery(e.target.value)} />
      {query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery("")}><Icon name="close" size={12} /></button>}
    </div>
    <div className="segmented" role="group" aria-label="Search mode">
      <button className={mode === "normal" ? "on" : ""} aria-pressed={mode === "normal"} onClick={() => setMode("normal")} title="Keyword search (works offline)"><Icon name="search" size={12} /><span className="label">Keyword</span></button>
      <button className={mode === "ai" ? "on" : ""} aria-pressed={mode === "ai"} onClick={() => setMode("ai")} title="Search by meaning (needs an AI provider)"><Icon name="sparkles" size={12} /><span className="label">AI</span></button>
    </div>
  </div>;
}
