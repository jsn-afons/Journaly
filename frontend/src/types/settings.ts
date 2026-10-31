/** Mirrors src-tauri/src/settings.rs. Keys are never part of this shape. */
export interface ProviderSettings {
  chat_base_url: string; chat_model: string;
  embedding_base_url: string; embedding_model: string; embedding_dimensions: number;
}
export interface SettingsView extends ProviderSettings { has_chat_key: boolean; has_embedding_key: boolean; configured: boolean }
export type KeyRole = "chat" | "embedding";
export interface KeyChange { role: KeyRole; action: "set" | "clear"; value?: string }

export interface EndpointTest { ok: boolean; seconds: number; error?: string; model: string }
export interface EmbeddingTest extends EndpointTest { configured_dimensions: number; detected_dimensions: number | null }
export interface ProviderTestResult { chat: EndpointTest; embedding: EmbeddingTest }
