import type { EntrySummary } from "../lib/rpc";
import type { Theme } from "../lib/theme";
import { EmbeddingStatus } from "./EmbeddingStatus";
import { Icon } from "./Icon";

export type View = "grid" | "editor" | "settings";
const RECENT_LIMIT = 12;

interface Props {
  entries: EntrySummary[]; activePath?: string; view: View; theme: Theme;
  status: { kind: "loading" | "ready" | "error"; text: string };
  onNavigate(view: View): void; onOpen(path: string): void; onCreate(): void; onToggleTheme(): void;
}

export function Sidebar({ entries, activePath, view, theme, status, onNavigate, onOpen, onCreate, onToggleTheme }: Props) {
  return <aside className="sidebar">
    <div className="sidebar-top">
      <div className="brand"><span className="brand-mark" aria-hidden="true">✎</span><span>Journaly</span></div>
      <p className="section-label">Main</p>
      <nav className="nav">
        <button className={view === "grid" ? "nav-item active" : "nav-item"} onClick={() => onNavigate("grid")}><Icon name="grid" /> All entries</button>
        <button className="nav-item" onClick={onCreate}><Icon name="plus" /> New entry</button>
      </nav>
      {entries.length > 0 && <>
        <p className="section-label">Recent</p>
        <nav className="nav recent" aria-label="Recent entries">
          {entries.slice(0, RECENT_LIMIT).map((entry) => <button key={entry.path} className={view === "editor" && activePath === entry.path ? "nav-item active" : "nav-item"} onClick={() => onOpen(entry.path)} title={entry.path}>
            <Icon name="pen" /><span className="truncate">{entry.title}</span>
          </button>)}
        </nav>
      </>}
    </div>
    <div className="sidebar-bottom">
      <p className="section-label">Settings</p>
      <nav className="nav">
        <button className={view === "settings" ? "nav-item active" : "nav-item"} onClick={() => onNavigate("settings")}><Icon name="gear" /> AI settings</button>
        <button className="nav-item" onClick={onToggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
          <Icon name={theme === "light" ? "moon" : "sun"} /> {theme === "light" ? "Dark mode" : "Light mode"}
        </button>
      </nav>
      <p className={`service-status ${status.kind}`} title={status.text}><span className="dot" aria-hidden="true" />{status.kind === "ready" ? "Local services running" : status.kind === "loading" ? "Starting…" : status.text}</p>
      <EmbeddingStatus />
    </div>
  </aside>;
}
