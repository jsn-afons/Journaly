import { describe, expect, it } from "vitest";
import { toneFor, wordCount } from "./entries";

describe("entries helpers", () => {
  it("gives the same month the same tone", () => {
    expect(toneFor("2026-06-01T10:00:00Z")).toBe(toneFor("2026-06-20T10:00:00Z"));
    expect(toneFor("2026-06-01T10:00:00Z")).not.toBe(toneFor("2026-07-15T10:00:00Z"));
  });
  it("tolerates bad dates", () => expect(toneFor("nope")).toBe("pink"));
  it("counts words", () => expect(wordCount("# Hi there\n\nthree")).toBe(4));
});
