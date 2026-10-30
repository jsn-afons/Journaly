import { useEffect, useRef, useState } from "react";
import { Chat } from "./components/Chat";
import { Editor } from "./components/Editor";
import { Inspector } from "./components/Inspector";
import { Sidebar } from "./components/Sidebar";
import type { RetrievalDiagnostics } from "./types/ai";
import { describeFailure } from "./lib/errors";
import { getHealth, journalRpc, type EntrySummary, type HealthResponse, type JournalEntry } from "./lib/rpc";

type Status = { kind: "loading" | "ready" | "error"; text: string };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: "loading", text: "Connecting to local services…" });
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [view, setView] = useState<"editor" | "chat">("editor");
  const [diagnostics, setDiagnostics] = useState<RetrievalDiagnostics | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved");
  const persisted = useRef("");
  const persistedTitle = useRef("");

  const refreshHealth = async () => { try { const result: HealthResponse = await getHealth(); setStatus({ kind: "ready", text: `${result.service} is ${result.status}` }); } catch (error) { setStatus({ kind: "error", text: describeFailure(error) }); } };
  const refreshEntries = async () => setEntries(await journalRpc.list());
  const open = async (path: string) => { setView("editor"); const loaded = await journalRpc.get(path); persisted.current = loaded.content; persistedTitle.current = loaded.title; setEntry(loaded); setSaveStatus("Saved"); };
  const create = async () => { const created = await journalRpc.create("Untitled", "# Untitled\n\n"); await refreshEntries(); await open(created.path); };
  const save = async () => { if (!entry) return; setSaveStatus("Saving…"); try { const renamed = entry.title === persistedTitle.current ? entry : await journalRpc.rename(entry.path, entry.title); const saved = await journalRpc.save(renamed.path, entry.content, persisted.current); persisted.current = saved.content; persistedTitle.current = saved.title; setEntry(saved); setSaveStatus("Saved"); await refreshEntries(); } catch (error) { setSaveStatus(`Save conflict: ${describeFailure(error)}`); } };
  const remove = async () => { if (!entry || !window.confirm(`Delete ${entry.title}?`)) return; await journalRpc.remove(entry.path); setEntry(null); setSaveStatus("Saved"); await refreshEntries(); };
  const edit = (content: string) => { if (!entry) return; setEntry({ ...entry, content }); setSaveStatus("Unsaved changes"); };

  useEffect(() => { void refreshHealth(); void refreshEntries(); }, []);
  const editor = entry ? <><header><input className="title" value={entry.title} aria-label="Entry title" onChange={(event) => { setEntry({ ...entry, title: event.target.value }); setSaveStatus("Unsaved changes"); }} /><div><span>{saveStatus}</span><button onClick={() => void remove()}>Delete</button><button onClick={() => void save()} disabled={saveStatus === "Saved"}>Save</button></div></header><Editor value={entry.content} onChange={edit} /></> : <div className="empty">Create or select a Markdown entry.</div>;
  return <main className={showInspector ? "app-shell with-inspector" : "app-shell"}>
    <Sidebar entries={entries} activePath={entry?.path} status={status} onOpen={(path) => void open(path)} onCreate={() => void create()} onDiagnostics={setDiagnostics} />
    <section className="workspace">
      <div className="tabs" role="tablist"><button role="tab" aria-selected={view === "editor"} className={view === "editor" ? "on" : ""} onClick={() => setView("editor")}>Editor</button><button role="tab" aria-selected={view === "chat"} className={view === "chat" ? "on" : ""} onClick={() => setView("chat")}>Chat</button><button className={showInspector ? "on inspector-toggle" : "inspector-toggle"} onClick={() => setShowInspector(!showInspector)}>Inspector</button></div>
      {view === "editor" ? <div className="pane">{editor}</div> : <Chat onOpenEntry={(path) => void open(path)} onDiagnostics={setDiagnostics} />}
    </section>
    {showInspector && <Inspector diagnostics={diagnostics} />}
  </main>;
}
