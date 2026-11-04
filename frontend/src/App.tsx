import { useEffect, useRef, useState } from "react";
import { AiPanel } from "./components/AiPanel";
import { EntryGrid } from "./components/EntryGrid";
import { EntryView, type SaveState } from "./components/EntryView";
import { Icon } from "./components/Icon";
import { Search, type SearchState } from "./components/Search";
import { Settings } from "./components/Settings";
import { Sidebar, type View } from "./components/Sidebar";
import type { RetrievalDiagnostics } from "./types/ai";
import type { SettingsView } from "./types/settings";
import { asFailure, describeFailure } from "./lib/errors";
import { Autosaver } from "./lib/autosave";
import { applyTheme, loadTheme, type Theme } from "./lib/theme";
import { isBlankEntry } from "./lib/entries";
import { getHealth, journalRpc, settingsRpc, type EntrySummary, type JournalEntry } from "./lib/rpc";

type Status = { kind: "loading" | "ready" | "error"; text: string };
const WIDE_WINDOW = 1200;
/** Quiet period after the last keystroke before writing to disk. */
const AUTOSAVE_DELAY_MS = 1200;
type Draft = { path: string; content: string };
const EMPTY_SEARCH: SearchState = { query: "", hits: null, notice: "", loading: false };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: "loading", text: "Connecting to local services…" });
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [view, setView] = useState<View>("grid");
  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH);
  const [diagnostics, setDiagnostics] = useState<RetrievalDiagnostics | null>(null);
  const [provider, setProvider] = useState<SettingsView | null>(null);
  // The drawer starts open only when there is room for it beside the entries.
  const [aiOpen, setAiOpen] = useState(() => window.innerWidth >= WIDE_WINDOW);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [save, setSaveState] = useState<SaveState>({ kind: "saved", at: null });
  const saveRef = useRef<SaveState>(save);
  const setSave = (next: SaveState) => { saveRef.current = next; setSaveState(next); };
  const entryRef = useRef<JournalEntry | null>(null);
  const persisted = useRef("");          // content as last read from / written to disk
  const persistedTitle = useRef("");
  const busy = useRef(false);            // a create or delete is running; extra clicks are ignored
  const [titleFocus, setTitleFocus] = useState(0);

  useEffect(() => applyTheme(theme), [theme]);
  const showEntry = (next: JournalEntry | null) => { entryRef.current = next; setEntry(next); };

  const refreshHealth = async () => { try { const result = await getHealth(); setStatus({ kind: "ready", text: `${result.service} is ${result.status}` }); } catch (error) { setStatus({ kind: "error", text: describeFailure(error) }); } };
  const refreshEntries = async () => setEntries(await journalRpc.list());

  const saver = useRef<Autosaver<Draft>>();
  if (!saver.current) {
    saver.current = new Autosaver<Draft>(async ({ path, content }) => {
      setSave({ kind: "saving" });
      const saved = await journalRpc.save(path, content, persisted.current);
      persisted.current = saved.content;
      setSave(saver.current!.hasPending ? { kind: "pending" } : { kind: "saved", at: new Date() });
      void refreshEntries();
    }, AUTOSAVE_DELAY_MS, (error) => setSave(asFailure(error).code === "CONFLICT" ? { kind: "conflict" } : { kind: "error", message: describeFailure(error) }));
  }

  /** Rename the file if the title changed. Called when the title field loses focus and before leaving an entry. */
  const commitTitle = async () => {
    const current = entryRef.current;
    if (!current || current.title === persistedTitle.current) return;
    try {
      await saver.current!.flush();
      const renamed = await journalRpc.rename(current.path, current.title);
      persistedTitle.current = renamed.title;
      showEntry({ ...entryRef.current!, path: renamed.path, title: renamed.title });
      await refreshEntries();
    } catch (error) {
      setSave({ kind: "error", message: describeFailure(error) });
      showEntry({ ...entryRef.current!, title: persistedTitle.current });   // keep the file's real name
    }
  };
  /** Write anything pending before switching away from the current entry. */
  const leaveEntry = async () => { await commitTitle(); await saver.current!.flush(); };

  const navigate = async (next: View) => { await leaveEntry(); setView(next); };
  const open = async (path: string) => {
    await leaveEntry();
    const loaded = await journalRpc.get(path);
    persisted.current = loaded.content; persistedTitle.current = loaded.title;
    saver.current!.discard(); showEntry(loaded); setSave({ kind: "saved", at: null }); setView("editor");
  };
  /** Already on a blank new entry? Go to its title rather than piling up identical files; either way the title gets
   *  focus and is selected, which is the visible sign that New entry worked (a new blank page looks like the last one). */
  const create = async () => {
    if (busy.current) return; busy.current = true;
    try {
      const current = entryRef.current;
      if (!(view === "editor" && current && isBlankEntry(current.title, current.content))) {
        await leaveEntry();
        const created = await journalRpc.create("Untitled", "# Untitled\n\n");
        await refreshEntries(); await open(created.path);
      }
      setTitleFocus((n) => n + 1);
    } catch (error) { setStatus({ kind: "error", text: `Couldn’t create an entry: ${describeFailure(error)}` }); }
    finally { busy.current = false; }
  };
  const remove = async () => {
    const current = entryRef.current;
    if (!current || busy.current) return; busy.current = true;
    try {
      saver.current!.discard();
      await journalRpc.remove(current.path); showEntry(null); setSave({ kind: "saved", at: null }); setView("grid"); await refreshEntries();
    } catch (error) { setSave({ kind: "error", message: `Couldn’t delete this entry: ${describeFailure(error)}` }); }
    finally { busy.current = false; }
  };
  const edit = (content: string) => {
    const current = entryRef.current; if (!current || content === current.content) return;
    showEntry({ ...current, content });
    // While a conflict or error is unresolved, autosave is paused; keep saying so instead of a misleading "Edited".
    const blocked = saveRef.current.kind === "conflict" || saveRef.current.kind === "error";
    if (!blocked) setSave({ kind: "pending" });
    saver.current!.change({ path: current.path, content });
  };
  const retitle = (title: string) => { const current = entryRef.current; if (current) showEntry({ ...current, title }); };

  // Conflict resolution: the file changed on disk after we last read it.
  const keepMine = async () => {
    const current = entryRef.current; if (!current) return;
    try {
      const saved = await journalRpc.save(current.path, current.content, null);
      persisted.current = saved.content; saver.current!.discard(); setSave({ kind: "saved", at: new Date() }); void refreshEntries();
    } catch (error) { setSave({ kind: "error", message: describeFailure(error) }); }
  };
  const useDisk = async () => {
    const current = entryRef.current; if (!current) return;
    const loaded = await journalRpc.get(current.path);
    saver.current!.discard(); persisted.current = loaded.content; persistedTitle.current = loaded.title;
    showEntry(loaded); setSave({ kind: "saved", at: null });
  };

  const retrySave = () => { setSave({ kind: "pending" }); saver.current!.resume(); };

  // Save now on ⌘S, and whenever the window loses focus.
  useEffect(() => {
    const flushNow = () => void leaveEntry();
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); flushNow(); } };
    window.addEventListener("keydown", onKey); window.addEventListener("blur", flushNow);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("blur", flushNow); };
  }, []);

  useEffect(() => { void refreshHealth(); void settingsRpc.get().then(setProvider).catch(() => undefined); void refreshEntries(); }, []);

  const crumb = view === "settings" ? "AI settings" : view === "editor" && entry ? entry.title : search.hits ? "Search" : "All entries";

  return <main className={aiOpen ? "app-shell with-ai" : "app-shell"}>
    <Sidebar entries={entries} activePath={entry?.path} view={view} theme={theme} status={status}
      onNavigate={(next) => void navigate(next)} onOpen={(path) => void open(path)} onCreate={() => void create()} onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")} />
    <section className="workspace">
      <header className="app-header">
        <div className="crumb">
          {view !== "grid" && <button className="back" onClick={() => void navigate("grid")}><Icon name="back" size={11} /> Journal</button>}
          {view !== "grid" && <span className="sep">/</span>}
          <h1>{crumb}</h1>
        </div>
        <Search onChange={(next) => { setSearch(next); if (next.hits && view !== "grid") void navigate("grid"); }} onDiagnostics={setDiagnostics} />
        <div className="header-actions">
          <button className="outline" onClick={() => void create()} title="New entry"><Icon name="plus" /><span className="label">New</span></button>
          <button className={aiOpen ? "dark on" : "dark"} onClick={() => setAiOpen(!aiOpen)} aria-pressed={aiOpen} title="AI Copilot"><Icon name="sparkles" /><span className="label">AI Copilot</span></button>
        </div>
      </header>
      <div className="workspace-body">
        {view === "settings" ? <Settings onSaved={setProvider} />
          : view === "editor" && entry ? <EntryView entry={entry} save={save} titleFocus={titleFocus} onTitle={retitle} onTitleCommit={() => void commitTitle()} onContent={edit} onDelete={() => void remove()} onKeepMine={() => void keepMine()} onUseDisk={() => void useDisk()} onRetry={retrySave} />
          : <EntryGrid entries={entries} search={search} onOpen={(path) => void open(path)} onCreate={() => void create()} />}
      </div>
    </section>
    {aiOpen && <AiPanel provider={provider} diagnostics={diagnostics} onClose={() => setAiOpen(false)} onOpenSettings={() => void navigate("settings")} onOpenEntry={(path) => void open(path)} onDiagnostics={setDiagnostics} />}
  </main>;
}
