import { describe, expect, it } from "vitest";
import { splitAnswer, splitMarks } from "./citations";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const FAKE = "11111111-1111-1111-1111-111111111111";

describe("splitAnswer", () => {
  it("turns validated ids into citation parts", () => {
    expect(splitAnswer(`Yes [entry:${ID}] indeed`, new Set([ID]))).toEqual([
      { kind: "text", text: "Yes " }, { kind: "citation", entryId: ID }, { kind: "text", text: " indeed" }]);
  });
  it("accepts ids written without the entry: prefix", () => {
    expect(splitAnswer(`See [${ID}].`, new Set([ID])).map((p) => p.kind)).toEqual(["text", "citation", "text"]);
  });
  it("leaves fabricated ids as plain text", () => {
    const parts = splitAnswer(`x [entry:${FAKE}]`, new Set([ID]));
    expect(parts.every((p) => p.kind === "text")).toBe(true);
    expect(parts.map((p) => (p as { text: string }).text).join("")).toBe(`x [entry:${FAKE}]`);
  });
});

describe("splitMarks", () => {
  it("separates highlighted terms", () => {
    expect(splitMarks("a <mark>b</mark> c")).toEqual([{ text: "a ", hit: false }, { text: "b", hit: true }, { text: " c", hit: false }]);
  });
});
