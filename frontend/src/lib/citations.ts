export type AnswerPart = { kind: "text"; text: string } | { kind: "citation"; entryId: string };

const CITATION = /\[entry:([0-9a-fA-F-]{36})\]/g;

/** Split an answer into text and citation parts. Only ids in `valid` (validated by the backend) become citations; others stay as plain text. */
export function splitAnswer(answer: string, valid: ReadonlySet<string>): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of answer.matchAll(CITATION)) {
    const index = match.index ?? 0;
    if (!valid.has(match[1])) continue;
    if (index > last) parts.push({ kind: "text", text: answer.slice(last, index) });
    parts.push({ kind: "citation", entryId: match[1] });
    last = index + match[0].length;
  }
  if (last < answer.length) parts.push({ kind: "text", text: answer.slice(last) });
  return parts;
}

/** Render FTS5 snippets (which wrap hits in <mark>) without ever using innerHTML. */
export function splitMarks(snippet: string): { text: string; hit: boolean }[] {
  return snippet.split(/(<mark>.*?<\/mark>)/g).filter(Boolean).map((piece) =>
    piece.startsWith("<mark>") ? { text: piece.slice(6, -7), hit: true } : { text: piece, hit: false });
}
