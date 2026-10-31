export interface Preset { id: string; label: string; baseUrl: string; needsKey: boolean; hint: string }

export const PRESETS: Preset[] = [
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", needsKey: false, hint: "Runs on your Mac. No account or key. Make sure the Ollama app is running." },
  { id: "lmstudio", label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", needsKey: false, hint: "Start the local server in LM Studio first." },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", needsKey: true, hint: "Requires an API key from platform.openai.com." },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true, hint: "One key for many hosted models. Most do not offer embeddings." },
  { id: "custom", label: "Custom (OpenAI-compatible)", baseUrl: "", needsKey: false, hint: "Any server that implements /v1/chat/completions and /v1/embeddings." },
];

const normalize = (url: string) => url.trim().replace(/\/+$/, "").toLowerCase();

/** Which preset a saved base URL corresponds to; anything unrecognised is "custom". */
export function detectPreset(baseUrl: string): Preset {
  return PRESETS.find((p) => p.id !== "custom" && normalize(p.baseUrl) === normalize(baseUrl)) ?? PRESETS[PRESETS.length - 1];
}

export function isLocalUrl(baseUrl: string): boolean {
  try { const host = new URL(baseUrl).hostname; return host === "localhost" || host === "127.0.0.1" || host === "::1"; } catch { return false; }
}
