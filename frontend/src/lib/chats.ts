import type { RankedChunk } from "../types/ai";

/**
 * Saved chats are Markdown files you can read in any editor. Each message starts with an HTML comment marker
 * (invisible when rendered) carrying who said it and when; an answer's sources follow it as a JSON comment so the
 * citation chips still work when the chat is reopened.
 *
 * ---
 * title: "Are you able to see my journals?"
 * created_at: 2026-10-31T15:20:00.000Z
 * updated_at: 2026-10-31T15:21:00.000Z
 * ---
 *
 * <!-- journaly:message role="user" at="2026-10-31T15:20:00.000Z" -->
 * Are you able to see my journals?
 *
 * <!-- journaly:message role="assistant" at="2026-10-31T15:20:04.000Z" -->
 * Yes — two entries came up… [entry:…]
 * <!-- journaly:sources [{"chunk_id":…}] -->
 */

/** Only what a citation chip needs from a retrieved chunk. */
export type Source = Pick<RankedChunk, "chunk_id" | "entry_id" | "filepath" | "created_at" | "heading" | "raw_content">;
export type StoredMessage =
  | { role: "user"; text: string; at: string }
  | { role: "assistant"; answer: string; citations: string[]; sources: Source[]; at: string };
export interface StoredChat { title: string; created_at: string; updated_at: string; messages: StoredMessage[] }

const MARKER = /^<!-- journaly:message role="(user|assistant)" at="([^"]+)" -->$/gm;
const SOURCES = /\n?<!-- journaly:sources (.*) -->\s*$/;

/** First question, cleaned up, as the chat's title. */
export function titleFor(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  return flat.length <= 60 ? flat || "Chat" : `${flat.slice(0, 60).replace(/\s+\S*$/, "")}…`;
}

/** Keep only chunks from entries the answer actually cites. */
export function sourcesFor(chunks: RankedChunk[], citations: string[]): Source[] {
  const cited = new Set(citations);
  return chunks.filter((c) => cited.has(c.entry_id)).map(({ chunk_id, entry_id, filepath, created_at, heading, raw_content }) => ({ chunk_id, entry_id, filepath, created_at, heading, raw_content }));
}

// A literal "-->" inside the JSON would end the comment early; > is the same character to JSON.parse.
const commentSafe = (json: string) => json.replace(/-->/g, "--\\u003e");

export function serializeChat(chat: StoredChat): string {
  const head = `---\ntitle: ${JSON.stringify(chat.title)}\ncreated_at: ${chat.created_at}\nupdated_at: ${chat.updated_at}\n---\n`;
  const body = chat.messages.map((m) => m.role === "user"
    ? `<!-- journaly:message role="user" at="${m.at}" -->\n${m.text}\n`
    : `<!-- journaly:message role="assistant" at="${m.at}" -->\n${m.answer}\n<!-- journaly:sources ${commentSafe(JSON.stringify(m.sources))} -->\n`);
  return [head, ...body].join("\n");
}

export function parseChat(document: string, fallbackTitle = "Chat"): StoredChat {
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(document);
  const field = (name: string) => front?.[1].split("\n").find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1).trim();
  const rawTitle = field("title");
  let title = fallbackTitle;
  if (rawTitle) { try { title = JSON.parse(rawTitle); } catch { title = rawTitle; } }
  const body = front ? document.slice(front[0].length) : document;

  const markers = [...body.matchAll(MARKER)];
  const messages: StoredMessage[] = markers.map((match, i) => {
    const start = match.index! + match[0].length; const end = i + 1 < markers.length ? markers[i + 1].index! : body.length;
    const text = body.slice(start, end).replace(/^\n/, "").replace(/\s+$/, "");
    if (match[1] === "user") return { role: "user", text, at: match[2] };
    const sourcesMatch = SOURCES.exec(text);
    let sources: Source[] = [];
    if (sourcesMatch) { try { sources = JSON.parse(sourcesMatch[1]); } catch { sources = []; } }
    const answer = sourcesMatch ? text.slice(0, sourcesMatch.index).replace(/\s+$/, "") : text;
    return { role: "assistant", answer, citations: [...new Set(sources.map((s) => s.entry_id))], sources, at: match[2] };
  });
  const now = new Date().toISOString();
  return { title, created_at: field("created_at") || now, updated_at: field("updated_at") || now, messages };
}
