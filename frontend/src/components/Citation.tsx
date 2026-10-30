import { useState } from "react";
import type { RankedChunk } from "../types/ai";

interface Props { entryId: string; chunks: RankedChunk[]; onOpen(path: string): void }

export const titleFromPath = (path: string) => path.split("/").pop()?.replace(/\.md$/i, "") ?? path;

/** Inline citation chip. Details come only from chunks the backend actually retrieved for this answer. */
export function Citation({ entryId, chunks, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const matches = chunks.filter((chunk) => chunk.entry_id === entryId);
  if (matches.length === 0) return null;
  const first = matches[0];
  return <span className="citation">
    <button className="citation-chip" aria-expanded={open} onClick={() => setOpen(!open)}>{titleFromPath(first.filepath)}</button>
    {open && <span className="citation-card" role="dialog" aria-label={`Source: ${titleFromPath(first.filepath)}`}>
      <strong>{titleFromPath(first.filepath)}</strong>
      <small>{new Date(first.created_at).toLocaleDateString()} · {first.filepath}</small>
      {matches.map((chunk) => <span className="citation-chunk" key={chunk.chunk_id}>
        {chunk.heading && <small>{chunk.heading}</small>}
        <pre>{chunk.raw_content}</pre>
      </span>)}
      <button onClick={() => { setOpen(false); onOpen(first.filepath); }}>Open entry</button>
    </span>}
  </span>;
}
