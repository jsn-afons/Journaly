import type { JournalEntry } from "../lib/rpc";
import { dayLabel, wordCount } from "../lib/entries";
import { Editor } from "./Editor";
import { Icon } from "./Icon";

export type SaveState = { kind: "saved"; at: Date | null } | { kind: "pending" } | { kind: "saving" } | { kind: "conflict" } | { kind: "error"; message: string };

interface Props {
  entry: JournalEntry; save: SaveState;
  onTitle(title: string): void; onTitleCommit(): void; onContent(content: string): void; onDelete(): void;
  onKeepMine(): void; onUseDisk(): void; onRetry(): void;
}

const time = (at: Date) => at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function label(save: SaveState): string {
  switch (save.kind) {
    case "saved": return save.at ? `Saved ${time(save.at)}` : "Saved";
    case "pending": return "Edited";
    case "saving": return "Saving…";
    case "conflict": return "Changed on disk";
    case "error": return "Not saved";
  }
}

/** Focused, centred writing view. Changes save automatically; the status pill shows where things stand. */
export function EntryView({ entry, save, onTitle, onTitleCommit, onContent, onDelete, onKeepMine, onUseDisk, onRetry }: Props) {
  const crumbs = ["journal", ...entry.path.split("/")];
  return <section className="entry-view">
    <div className="entry-meta-bar">
      <div className="crumbs mono">{crumbs.map((part, i) => <span key={i} className={i === crumbs.length - 1 ? "current" : ""}>{part}</span>)}</div>
      <div className="entry-actions">
        <span className={`save-status ${save.kind}`} role="status" title={save.kind === "error" ? save.message : "Changes save automatically (⌘S saves now)"}>{label(save)}</span>
        <button className="ghost" onClick={onDelete} aria-label="Delete entry" title="Delete entry"><Icon name="trash" /></button>
      </div>
    </div>
    {save.kind === "conflict" && <div className="conflict-banner" role="alert">
      <p><strong>This entry was changed outside Journaly</strong> while you were editing. Autosave is paused so nothing is overwritten.</p>
      <div><button className="primary small" onClick={onKeepMine}>Keep my version</button><button className="outline" onClick={onUseDisk}>Use the version on disk</button></div>
    </div>}
    {save.kind === "error" && <div className="conflict-banner" role="alert">
      <p><strong>Couldn’t save.</strong> {save.message} Your text is still here; autosave is paused.</p>
      <div><button className="primary small" onClick={onRetry}>Try again</button></div>
    </div>}
    <input className="entry-title" value={entry.title} aria-label="Entry title" onChange={(e) => onTitle(e.target.value)}
      onBlur={onTitleCommit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} />
    <p className="entry-sub">{dayLabel(entry.created_at)} · {wordCount(entry.content)} words</p>
    <Editor value={entry.content} onChange={onContent} />
  </section>;
}
