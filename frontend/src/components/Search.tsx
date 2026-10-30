import { useEffect, useRef, useState } from "react";
import { aiRpc, journalRpc } from "../lib/rpc";
import { describeFailure } from "../lib/errors";
import { splitMarks } from "../lib/citations";
import type { RetrievalDiagnostics } from "../types/ai";
import { titleFromPath } from "./Citation";

type Mode = "normal" | "ai";
interface Hit { key: string; path: string; heading: string; snippet: string; created_at: string; score?: number }
interface Props { onOpen(path: string): void; onActive(active: boolean): void; onDiagnostics(d: RetrievalDiagnostics): void }

const DEBOUNCE_MS = 250;

/** Normal mode: offline FTS5/BM25. AI mode: hybrid FTS + vector + RRF + temporal rerank. */
export function Search({ onOpen, onActive, onDiagnostics }: Props) {
  const [mode, setMode] = useState<Mode>("normal");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [notice, setNotice] = useState("");
  const latest = useRef(0);

  useEffect(() => {
    onActive(query.trim() !== "");
    if (!query.trim()) { setHits([]); setNotice(""); return; }
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        let next: Hit[]; let message = "";
        if (mode === "ai") {
          const result = await aiRpc.hybrid(query);
          onDiagnostics(result);
          next = result.final_results.map((c) => ({ key: c.chunk_id, path: c.filepath, heading: c.heading, snippet: c.raw_content.slice(0, 160), created_at: c.created_at, score: c.temporal_score }));
          if (result.vector_error) message = `Keyword results only — ${result.vector_error}`;
        } else {
          next = (await aiRpc.keyword(query)).results.map((h) => ({ key: h.chunk_id, path: h.filepath, heading: h.heading, snippet: h.snippet, created_at: h.created_at }));
        }
        if (ticket === latest.current) { setHits(next); setNotice(message); }
      } catch (error) {
        if (ticket !== latest.current) return;
        if (mode === "normal") { // keep search usable if the daemon is down: fall back to the Rust filename/content scan
          const files = await journalRpc.search(query).catch(() => []);
          setHits(files.map((f) => ({ key: f.path, path: f.path, heading: "", snippet: "", created_at: f.created_at })));
          setNotice("Index unavailable — showing basic file search");
        } else { setHits([]); setNotice(describeFailure(error)); }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, mode]);

  return <div className="search">
    <div className="mode-toggle" role="group" aria-label="Search mode">
      <button className={mode === "normal" ? "on" : ""} onClick={() => setMode("normal")}>Normal</button>
      <button className={mode === "ai" ? "on" : ""} onClick={() => setMode("ai")}>AI</button>
    </div>
    <input aria-label="Search journal" placeholder={mode === "ai" ? "Search by meaning" : "Search journal"} value={query} onChange={(e) => setQuery(e.target.value)} />
    {notice && <p className="notice">{notice}</p>}
    {query.trim() && <nav className="hits">
      {hits.length === 0 && !notice && <p className="notice">No matches</p>}
      {hits.map((hit) => <button className="entry" key={hit.key} onClick={() => onOpen(hit.path)}>
        <span>{titleFromPath(hit.path)}</span>
        {hit.heading && <small>{hit.heading}</small>}
        {hit.snippet && <small className="snippet">{splitMarks(hit.snippet).map((p, i) => p.hit ? <mark key={i}>{p.text}</mark> : p.text)}</small>}
        <small>{new Date(hit.created_at).toLocaleDateString()}{hit.score !== undefined && ` · ${hit.score.toFixed(3)}`}</small>
      </button>)}
    </nav>}
  </div>;
}
