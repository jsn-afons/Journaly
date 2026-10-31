import type { EntrySummary } from "../lib/rpc";
import { splitMarks } from "../lib/citations";
import { dayLabel, monthLabel, toneFor } from "../lib/entries";
import { titleFromPath } from "./Citation";
import type { SearchState } from "./Search";
import { Icon } from "./Icon";

interface Props { entries: EntrySummary[]; search: SearchState; onOpen(path: string): void; onCreate(): void }

/** Pastel card grid: all entries, or search results when the search box has text. */
export function EntryGrid({ entries, search, onOpen, onCreate }: Props) {
  if (search.hits) {
    return <section className="grid-view">
      <p className="grid-caption">{search.loading ? "Searching…" : `${search.hits.length} ${search.hits.length === 1 ? "match" : "matches"} for “${search.query}”`}</p>
      {search.notice && <p className="notice warn">{search.notice}</p>}
      <div className="card-grid">
        {search.hits.map((hit) => <Card key={hit.key} tone={toneFor(hit.created_at)} label={hit.heading || monthLabel(hit.created_at)} title={titleFromPath(hit.path)} date={hit.created_at} onOpen={() => onOpen(hit.path)}
          body={splitMarks(hit.snippet).map((part, i) => part.hit ? <mark key={i}>{part.text}</mark> : part.text)} score={hit.score} />)}
      </div>
    </section>;
  }
  if (entries.length === 0) {
    return <section className="grid-view empty-state">
      <h2>Your journal is empty</h2>
      <p>Entries are plain Markdown files on your Mac.</p>
      <button className="primary" onClick={onCreate}><Icon name="plus" /> Write your first entry</button>
    </section>;
  }
  return <section className="grid-view">
    <div className="card-grid">
      {entries.map((entry) => <Card key={entry.path} tone={toneFor(entry.created_at)} label={monthLabel(entry.created_at)} title={entry.title} date={entry.created_at} onOpen={() => onOpen(entry.path)} body={entry.excerpt || <em>Empty entry</em>} />)}
    </div>
  </section>;
}

interface CardProps { tone: string; label: string; title: string; date: string; body: React.ReactNode; score?: number; onOpen(): void }

function Card({ tone, label, title, date, body, score, onOpen }: CardProps) {
  return <article className={`entry-card tone-${tone}`}>
    <header><span>{label}</span>{score !== undefined && <small title="Final ranking score">{score.toFixed(3)}</small>}</header>
    <button className="sheet" onClick={onOpen}>
      <h3>{title}</h3>
      <time dateTime={date}>{dayLabel(date)}</time>
      <p>{body}</p>
    </button>
  </article>;
}
