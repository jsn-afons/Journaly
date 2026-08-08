import { useEffect, useRef, useState } from "react";
import { Editor } from "./components/Editor";
import { getHealth, journalRpc, type EntrySummary, type HealthResponse, type JournalEntry } from "./lib/rpc";

type Status = { kind: "loading" | "ready" | "error"; text: string };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: "loading", text: "Connecting to local services…" });
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [query, setQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState("Saved");
  const persisted = useRef("");
  const persistedTitle = useRef("");

  const refreshHealth = async () => { try { const result: HealthResponse = await getHealth(); setStatus({ kind: "ready", text: `${result.service} is ${result.status}` }); } catch (error) { setStatus({ kind: "error", text: error instanceof Error ? error.message : "Unable to reach local AI service" }); } };
  const refreshEntries = async (search = query) => setEntries(search.trim() ? await journalRpc.search(search) : await journalRpc.list());
  const open = async (path: string) => { const loaded = await journalRpc.get(path); persisted.current = loaded.content; persistedTitle.current = loaded.title; setEntry(loaded); setSaveStatus("Saved"); };
  const create = async () => { const created = await journalRpc.create("Untitled", "# Untitled\n\n"); await refreshEntries(); await open(created.path); };
  const save = async () => { if (!entry) return; setSaveStatus("Saving…"); try { const renamed = entry.title === persistedTitle.current ? entry : await journalRpc.rename(entry.path, entry.title); const saved = await journalRpc.save(renamed.path, entry.content, persisted.current); persisted.current = saved.content; persistedTitle.current = saved.title; setEntry(saved); setSaveStatus("Saved"); await refreshEntries(); } catch (error) { setSaveStatus(`Save conflict: ${error instanceof Error ? error.message : "file changed on disk"}`); } };
  const remove = async () => { if (!entry || !window.confirm(`Delete ${entry.title}?`)) return; await journalRpc.remove(entry.path); setEntry(null); setSaveStatus("Saved"); await refreshEntries(); };
  const edit = (content: string) => { if (!entry) return; setEntry({ ...entry, content }); setSaveStatus("Unsaved changes"); };
  const onSearch = async (value: string) => { setQuery(value); await refreshEntries(value); };

  useEffect(() => { void refreshHealth(); void refreshEntries(""); }, []);
  return <main className="app-shell">
    <aside><div className="sidebar-header"><h1>Journaly</h1><button onClick={() => void create()}>New entry</button></div><input aria-label="Search journal" placeholder="Search journal" value={query} onChange={(event) => void onSearch(event.target.value)} /><nav>{entries.map((item) => <button className={entry?.path === item.path ? "entry active" : "entry"} key={item.path} onClick={() => void open(item.path)}><span>{item.title}</span><small>{new Date(item.created_at).toLocaleDateString()}</small></button>)}</nav><section aria-live="polite" className={`status ${status.kind}`}>{status.text}</section></aside>
    <section className="workspace">{entry ? <><header><input className="title" value={entry.title} aria-label="Entry title" onChange={(event) => { setEntry({ ...entry, title: event.target.value }); setSaveStatus("Unsaved changes"); }} /><div><span>{saveStatus}</span><button onClick={() => void remove()}>Delete</button><button onClick={() => void save()} disabled={saveStatus === "Saved"}>Save</button></div></header><Editor value={entry.content} onChange={edit} /></> : <div className="empty">Create or select a Markdown entry.</div>}</section>
  </main>;
}
