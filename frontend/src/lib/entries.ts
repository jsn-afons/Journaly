/** Card palette cycles by month so entries written in the same month share a colour. */
export const CARD_TONES = ["pink", "blue", "gray", "green"] as const;
export type CardTone = typeof CARD_TONES[number];

export function toneFor(createdAt: string): CardTone {
  const date = new Date(createdAt);
  return CARD_TONES[Number.isNaN(date.getTime()) ? 0 : date.getMonth() % CARD_TONES.length];
}

export const monthLabel = (createdAt: string) => new Date(createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
export const dayLabel = (createdAt: string) => new Date(createdAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
/** A new entry nobody has written in yet: the starter heading (or nothing) and still titled Untitled. */
export const isBlankEntry = (title: string, content: string) => /^Untitled( \d+)?$/.test(title) && /^(#\s*Untitled)?\s*$/.test(content);

export const wordCount = (text: string) => (text.match(/\S+/g) ?? []).length;
