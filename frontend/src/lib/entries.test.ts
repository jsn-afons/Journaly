import { describe, expect, it } from "vitest";
import { isBlankEntry, toneFor, wordCount } from "./entries";

describe("entries helpers", () => {
  it("gives the same month the same tone", () => {
    expect(toneFor("2026-06-01T10:00:00Z")).toBe(toneFor("2026-06-20T10:00:00Z"));
    expect(toneFor("2026-06-01T10:00:00Z")).not.toBe(toneFor("2026-07-15T10:00:00Z"));
  });
  it("tolerates bad dates", () => expect(toneFor("nope")).toBe("pink"));
  it("recognises only untouched new entries as blank", () => {
    expect(isBlankEntry("Untitled", "# Untitled\n\n")).toBe(true);
    expect(isBlankEntry("Untitled 3", "")).toBe(true);
    expect(isBlankEntry("Untitled", "# Untitled\n\nToday I ran")).toBe(false);
    expect(isBlankEntry("Chelsea", "# Untitled\n\n")).toBe(false);
    expect(isBlankEntry("Untitled draft", "")).toBe(false);
  });
  it("counts words", () => expect(wordCount("# Hi there\n\nthree")).toBe(4));
});
