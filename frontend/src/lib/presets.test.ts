import { describe, expect, it } from "vitest";
import { detectPreset, isLocalUrl } from "./presets";

describe("detectPreset", () => {
  it("recognises known endpoints regardless of trailing slash or case", () => {
    expect(detectPreset("http://localhost:11434/v1/").id).toBe("ollama");
    expect(detectPreset("HTTPS://api.openai.com/v1").id).toBe("openai");
  });
  it("falls back to custom", () => expect(detectPreset("https://example.com/v1").id).toBe("custom"));
});

describe("isLocalUrl", () => {
  it("is true only for loopback hosts", () => {
    expect(isLocalUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalUrl("https://api.openai.com/v1")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
  });
});
