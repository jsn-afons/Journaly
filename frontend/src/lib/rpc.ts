import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatResult, KeywordHit, RetrievalDiagnostics } from "../types/ai";
import type { KeyChange, KeyRole, ProviderSettings, ProviderTestResult, SettingsView } from "../types/settings";

export interface HealthResponse { status: "ok"; service: "ai_daemon" }
export interface EntrySummary { id: string; path: string; title: string; created_at: string }
export interface JournalEntry extends EntrySummary { content: string }

export async function getHealth(): Promise<HealthResponse> {
  return invoke<HealthResponse>("health_check");
}

export const journalRpc = {
  list: () => invoke<EntrySummary[]>("list_entries"),
  create: (title: string, content = "") => invoke<JournalEntry>("create_entry", { title, content }),
  get: (path: string) => invoke<JournalEntry>("get_entry", { path }),
  save: (path: string, content: string, expectedContent: string) => invoke<JournalEntry>("save_entry", { path, content, expectedContent }),
  rename: (path: string, title: string) => invoke<JournalEntry>("rename_entry", { path, title }),
  remove: (path: string) => invoke<void>("delete_entry", { path }),
  search: (query: string) => invoke<EntrySummary[]>("search_journal", { query }),
};

export const aiRpc = {
  keyword: (query: string) => invoke<{ results: KeywordHit[] }>("ai_search_keyword", { query }),
  hybrid: (query: string) => invoke<RetrievalDiagnostics>("ai_search_hybrid", { query }),
  chat: (query: string) => invoke<ChatResult>("ai_chat", { query }),
  /** Streams answer pieces to `onDelta`; resolves with the complete, citation-validated result. */
  chatStream: (query: string, onDelta: (text: string) => void) => {
    const channel = new Channel<string>();
    channel.onmessage = onDelta;
    return invoke<ChatResult>("ai_chat_stream", { query, onDelta: channel });
  },
  retryEmbeddings: () => invoke<{ status: string; retried: number; completed: number }>("ai_retry_embeddings"),
};

export const settingsRpc = {
  get: () => invoke<SettingsView>("get_provider_settings"),
  save: (settings: ProviderSettings, keyChanges: KeyChange[]) => invoke<SettingsView>("save_provider_settings", { settings, keyChanges }),
  test: (parts?: ("chat" | "embedding")[]) => invoke<Partial<ProviderTestResult>>("test_provider", { parts }),
  models: (baseUrl: string, role: KeyRole, apiKey?: string) => invoke<{ models: string[] }>("list_provider_models", { baseUrl, role, apiKey: apiKey || null }),
};
