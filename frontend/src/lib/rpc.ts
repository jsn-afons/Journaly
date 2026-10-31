import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatResult, KeywordHit, RetrievalDiagnostics } from "../types/ai";
import type { KeyChange, KeyRole, ProviderSettings, ProviderTestResult, SettingsView } from "../types/settings";

export interface HealthResponse { status: "ok"; service: "ai_daemon" }
export interface EntrySummary { id: string; path: string; title: string; created_at: string; excerpt: string }
export interface JournalEntry extends EntrySummary { content: string }

export async function getHealth(): Promise<HealthResponse> {
  return invoke<HealthResponse>("health_check");
}

export const journalRpc = {
  list: () => invoke<EntrySummary[]>("list_entries"),
  create: (title: string, content = "") => invoke<JournalEntry>("create_entry", { title, content }),
  get: (path: string) => invoke<JournalEntry>("get_entry", { path }),
  /** `expectedContent` = what we last read/saved; the save is refused (CONFLICT) if the file changed since. `null` overwrites. */
  save: (path: string, content: string, expectedContent: string | null) => invoke<JournalEntry>("save_entry", { path, content, expectedContent }),
  rename: (path: string, title: string) => invoke<JournalEntry>("rename_entry", { path, title }),
  remove: (path: string) => invoke<void>("delete_entry", { path }),
  search: (query: string) => invoke<EntrySummary[]>("search_journal", { query }),
};

export const aiRpc = {
  keyword: (query: string) => invoke<{ results: KeywordHit[] }>("ai_search_keyword", { query }),
  hybrid: (query: string) => invoke<RetrievalDiagnostics>("ai_search_hybrid", { query }),
  chat: (query: string) => invoke<ChatResult>("ai_chat", { query }),
  /** Streams answer pieces to `onDelta`; resolves with the complete, citation-validated result. */
  chatStream: (query: string, onDelta: (text: string) => void, history: ChatTurn[] = []) => {
    const channel = new Channel<string>();
    channel.onmessage = onDelta;
    return invoke<ChatResult>("ai_chat_stream", { query, history, onDelta: channel });
  },
  retryEmbeddings: () => invoke<{ status: string; retried: number; completed: number }>("ai_retry_embeddings"),
};

export const settingsRpc = {
  get: () => invoke<SettingsView>("get_provider_settings"),
  save: (settings: ProviderSettings, keyChanges: KeyChange[]) => invoke<SettingsView>("save_provider_settings", { settings, keyChanges }),
  test: (parts?: ("chat" | "embedding")[]) => invoke<Partial<ProviderTestResult>>("test_provider", { parts }),
  models: (baseUrl: string, role: KeyRole, apiKey?: string) => invoke<{ models: string[] }>("list_provider_models", { baseUrl, role, apiKey: apiKey || null }),
};

/** An earlier message, sent with a question so follow-ups make sense. */
export interface ChatTurn { role: "user" | "assistant"; content: string }
export interface ChatSummary { path: string; title: string; updated_at: string }
/** Saved chats: Markdown files in the Chats folder (format in lib/chats.ts). */
export const chatsRpc = {
  list: () => invoke<ChatSummary[]>("list_chats"),
  get: (path: string) => invoke<string>("get_chat", { path }),
  create: (title: string, document: string) => invoke<ChatSummary>("create_chat", { title, document }),
  save: (path: string, document: string) => invoke<ChatSummary>("save_chat", { path, document }),
  remove: (path: string) => invoke<void>("delete_chat", { path }),
};
