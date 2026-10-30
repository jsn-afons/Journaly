import { useState } from "react";
import type { EntrySummary } from "../lib/rpc";
import type { RetrievalDiagnostics } from "../types/ai";
import { Search } from "./Search";

interface Props {
  entries: EntrySummary[]; activePath?: string; status: { kind: string; text: string };
  onOpen(path: string): void; onCreate(): void; onDiagnostics(d: RetrievalDiagnostics): void;
}

export function Sidebar({ entries, activePath, status, onOpen, onCreate, onDiagnostics }: Props) {
  const [searching, setSearching] = useState(false);
  return <aside>
    <div className="sidebar-header"><h1>Journaly</h1><button onClick={onCreate}>New entry</button></div>
    <Search onOpen={onOpen} onActive={setSearching} onDiagnostics={onDiagnostics} />
    {!searching && <nav>{entries.map((item) => <button className={activePath === item.path ? "entry active" : "entry"} key={item.path} onClick={() => onOpen(item.path)}><span>{item.title}</span><small>{new Date(item.created_at).toLocaleDateString()}</small></button>)}</nav>}
    <section aria-live="polite" className={`status ${status.kind}`}>{status.text}</section>
  </aside>;
}
