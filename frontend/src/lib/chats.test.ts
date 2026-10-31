import { describe, expect, it } from "vitest";
import type { RankedChunk } from "../types/ai";
import { parseChat, serializeChat, sourcesFor, type StoredChat, titleFor } from "./chats";

const ID = "3f2b8c1e-0000-4000-8000-000000000001";
const chunk = (entry_id: string, raw_content: string): RankedChunk => ({ chunk_id: `${entry_id}:0`, entry_id, filepath: "2026/10/Chelsea Beat United.md", created_at: "2026-10-31T13:35:00Z", heading: "", raw_content, rrf_score: 1, temporal_score: 1, recurrence_count: 0 });

const chat: StoredChat = {
  title: 'He said "hi": --> tricky',
  created_at: "2026-10-31T15:20:00.000Z", updated_at: "2026-10-31T15:21:00.000Z",
  messages: [
    { role: "user", text: "Are you able to see my journals?\n\nSecond paragraph.", at: "2026-10-31T15:20:00.000Z" },
    { role: "assistant", answer: `Yes — **Chelsea** beat United [entry:${ID}].\n\n- a list`, citations: [ID], sources: sourcesFor([chunk(ID, "We won --> 2-0"), chunk("other", "x")], [ID]), at: "2026-10-31T15:20:04.000Z" },
    { role: "user", text: "Thanks", at: "2026-10-31T15:21:00.000Z" },
  ],
};

describe("saved chats", () => {
  it("round-trips through Markdown without losing anything", () => {
    expect(parseChat(serializeChat(chat))).toEqual(chat);
  });

  it("is readable Markdown", () => {
    const doc = serializeChat(chat);
    expect(doc.startsWith('---\ntitle: "He said \\"hi\\": --> tricky"\n')).toBe(true);
    expect(doc).toContain("Are you able to see my journals?\n\nSecond paragraph.");
    // the sources comment must not be closed early by "-->" inside the journal text
    expect(doc.match(/-->/g)!.length).toBe(4 + 1); // 3 message markers + 1 sources comment, + the one in the title line
  });

  it("keeps only cited sources", () => {
    expect(chat.messages[1].role === "assistant" && chat.messages[1].sources.map((s) => s.entry_id)).toEqual([ID]);
  });

  it("titles a chat from its first question", () => {
    expect(titleFor("  Hello   there ")).toBe("Hello there");
    expect(titleFor("word ".repeat(30)).endsWith("…")).toBe(true);
    expect(titleFor("word ".repeat(30)).length).toBeLessThanOrEqual(61);
  });

  it("tolerates hand-edited files", () => {
    expect(parseChat("just some notes", "Notes")).toMatchObject({ title: "Notes", messages: [] });
    const broken = '---\ntitle: "T"\n---\n<!-- journaly:message role="assistant" at="x" -->\nanswer\n<!-- journaly:sources not json -->';
    expect(parseChat(broken).messages[0]).toMatchObject({ answer: "answer", sources: [], citations: [] });
  });
});
