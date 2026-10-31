import { describe, expect, it } from "vitest";
import { describeEmbedStatus, type EmbedStatus } from "./embedStatus";

const base: EmbedStatus = { state: "up_to_date", pending_entries: 0, last_error: null, next_retry_seconds: null };

describe("describeEmbedStatus", () => {
  it("counts entries while working", () => {
    expect(describeEmbedStatus({ ...base, state: "working", pending_entries: 1 }).text).toContain("1 entry");
    expect(describeEmbedStatus({ ...base, state: "working", pending_entries: 3 }).text).toContain("3 entries");
  });
  it("explains a paused provider with the retry time and reason", () => {
    const d = describeEmbedStatus({ ...base, state: "waiting", next_retry_seconds: 240, last_error: "HTTP 401" });
    expect(d.text).toContain("4 min"); expect(d.detail).toBe("HTTP 401"); expect(d.tone).toBe("warn");
  });
  it("reassures that keyword search works when vectors are unavailable", () => {
    expect(describeEmbedStatus({ ...base, state: "unavailable" }).text).toContain("keyword search still works");
  });
});
