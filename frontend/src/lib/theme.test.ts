import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, loadTheme } from "./theme";

// Minimal stand-ins (no jsdom dependency): only what theme.ts touches.
const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;

describe("theme", () => {
  beforeEach(() => {
    store.clear();
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    g.document = { documentElement: { dataset: {} as Record<string, string> } };
  });
  it("defaults to light", () => expect(loadTheme()).toBe("light"));
  it("applies and remembers dark", () => {
    applyTheme("dark");
    expect((g.document as { documentElement: { dataset: Record<string, string> } }).documentElement.dataset.theme).toBe("dark");
    expect(loadTheme()).toBe("dark");
  });
  it("falls back to light when storage throws", () => {
    g.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadTheme()).toBe("light");
    expect(() => applyTheme("dark")).not.toThrow();
  });
});
