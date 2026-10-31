import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver } from "./autosave";

describe("Autosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces rapid changes into one save of the latest value", async () => {
    const saved: string[] = [];
    const saver = new Autosaver<string>(async (v) => void saved.push(v), 1000);
    saver.change("a"); await vi.advanceTimersByTimeAsync(500); saver.change("ab"); await vi.advanceTimersByTimeAsync(999);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual(["ab"]);
  });

  it("never overlaps saves and saves edits made during a save", async () => {
    let active = 0, maxActive = 0; const saved: string[] = [];
    const saver = new Autosaver<string>(async (v) => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 300)); saved.push(v); active--; }, 100);
    saver.change("one"); await vi.advanceTimersByTimeAsync(150);   // save of "one" in flight
    saver.change("two"); await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toEqual(["one", "two"]); expect(maxActive).toBe(1);
  });

  it("flush saves immediately", async () => {
    const saved: string[] = [];
    const saver = new Autosaver<string>(async (v) => void saved.push(v), 10_000);
    saver.change("now"); await saver.flush();
    expect(saved).toEqual(["now"]); expect(saver.hasPending).toBe(false);
  });

  it("stops after a failure, keeps the value, and retries on resume", async () => {
    let fail = true; const saved: string[] = []; const errors: unknown[] = [];
    const saver = new Autosaver<string>(async (v) => { if (fail) throw new Error("conflict"); saved.push(v); }, 100, (e) => errors.push(e));
    saver.change("draft"); await vi.advanceTimersByTimeAsync(100);
    expect(errors).toHaveLength(1); expect(saver.hasPending).toBe(true);
    saver.change("draft 2"); await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual([]);                                      // paused: no blind retries
    fail = false; saver.resume(); await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual(["draft 2"]);
  });

  it("discard drops unsaved work", async () => {
    const saved: string[] = [];
    const saver = new Autosaver<string>(async (v) => void saved.push(v), 100);
    saver.change("x"); saver.discard(); await vi.advanceTimersByTimeAsync(500);
    expect(saved).toEqual([]); expect(saver.hasPending).toBe(false);
  });
});
