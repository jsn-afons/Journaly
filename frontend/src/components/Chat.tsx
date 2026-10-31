import { useRef, useState } from "react";
import { aiRpc, chatsRpc, type ChatTurn } from "../lib/rpc";
import { serializeChat, sourcesFor, type StoredChat, type StoredMessage, titleFor } from "../lib/chats";
import { asFailure, describeFailure } from "../lib/errors";
import { splitAnswer } from "../lib/citations";
import type { ChatResult, RetrievalDiagnostics } from "../types/ai";
import { Citation } from "./Citation";
import { Icon } from "./Icon";

export type Message = { role: "user"; text: string; at: string } | { role: "streaming"; text: string } | { role: "assistant"; result: ChatResult; at: string } | { role: "error"; text: string; settingsHelp: boolean };
/** A saved chat to continue; omitted for a new one. */
export interface OpenChat { path: string; chat: StoredChat }
interface Props { configured: boolean; model?: string; saved?: OpenChat; onSaved?(path: string): void; onOpenSettings(): void; onOpenEntry(path: string): void; onDiagnostics(d: RetrievalDiagnostics): void }

const emptyDiagnostics = (query: string, final_results: RetrievalDiagnostics["final_results"]): RetrievalDiagnostics =>
  ({ query, fts_results: [], vector_results: [], vector_error: null, rrf_results: [], temporal_scores: [], final_results, latencies: {} });

/** Saved messages → what the chat shows. Sources stand in for the retrieved chunks so citation chips still open. */
function fromStored(messages: StoredMessage[]): Message[] {
  return messages.map((m) => m.role === "user" ? m
    : { role: "assistant", at: m.at, result: { answer: m.answer, citations: m.citations, diagnostics: emptyDiagnostics("", m.sources.map((s) => ({ ...s, rrf_score: 0, temporal_score: 0, recurrence_count: 0 }))) } });
}

/** Earlier turns sent with a new question (the daemon keeps only the last few, within a size budget). */
export function historyFor(messages: Message[]): ChatTurn[] {
  return messages.flatMap((m): ChatTurn[] => m.role === "user" ? [{ role: "user", content: m.text }] : m.role === "assistant" ? [{ role: "assistant", content: m.result.answer }] : []);
}

/** What gets saved: questions and completed answers (not errors or half-streamed text). */
function toStored(messages: Message[]): StoredMessage[] {
  return messages.flatMap((m): StoredMessage[] => m.role === "user" ? [m]
    : m.role === "assistant" ? [{ role: "assistant", at: m.at, answer: m.result.answer, citations: m.result.citations, sources: sourcesFor(m.result.diagnostics.final_results, m.result.citations) }] : []);
}

// Raw ids are unreadable mid-stream; they become clickable chips once the complete answer is validated.
const hideCitationIds = (text: string) => text.replace(/\[(?:entry:\s*)?[0-9a-fA-F-]{36}\]/g, "[source]");

const HELPED_BY_SETTINGS = new Set(["EMBEDDING_PROVIDER_UNAVAILABLE", "LLM_PROVIDER_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "SIDECAR_UNAVAILABLE"]);

/** Answers stream in as plain text; when complete they are replaced by the validated result with citation chips. */
export function Chat({ configured, model, saved, onSaved, onOpenSettings, onOpenEntry, onDiagnostics }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => saved ? fromStored(saved.chat.messages) : []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Where this chat is saved; null until the first answer arrives.
  const file = useRef<{ path: string | null; title: string; created_at: string } | null>(saved ? { path: saved.path, title: saved.chat.title, created_at: saved.chat.created_at } : null);

  /** Write the whole conversation to its Markdown file (creating it after the first answer). Failure never breaks the chat. */
  const persist = async (all: Message[]) => {
    const stored = toStored(all); const first = stored.find((m) => m.role === "user");
    if (!first) return;
    const meta = file.current ?? { path: null, title: titleFor(first.role === "user" ? first.text : ""), created_at: first.at };
    const document = serializeChat({ title: meta.title, created_at: meta.created_at, updated_at: new Date().toISOString(), messages: stored });
    try {
      const summary = meta.path ? await chatsRpc.save(meta.path, document) : await chatsRpc.create(meta.title, document);
      file.current = { ...meta, path: summary.path }; setSaveError(""); onSaved?.(summary.path);
    } catch (error) { setSaveError(`This chat couldn’t be saved: ${describeFailure(error)}`); }
  };

  const send = async () => {
    const query = input.trim(); if (!query || busy) return;
    const question: Message = { role: "user", text: query, at: new Date().toISOString() };
    const before = messages; // busy blocks a second send, so this is the current conversation
    setInput(""); setBusy(true); setMessages((m) => [...m, question]);
    setMessages((m) => [...m, { role: "streaming", text: "" }]);
    const replaceLast = (next: Message[]) => setMessages((m) => [...m.slice(0, -1), ...next]);
    try {
      const result = await aiRpc.chatStream(query, (piece) => setMessages((m) => {
        const last = m[m.length - 1];
        return last?.role === "streaming" ? [...m.slice(0, -1), { role: "streaming", text: last.text + piece }] : m;
      }), historyFor(before));
      onDiagnostics(result.diagnostics);
      const answer: Message = { role: "assistant", result, at: new Date().toISOString() };
      replaceLast([answer]);
      void persist([...before, question, answer]);
    } catch (error) { replaceLast([{ role: "error", text: describeFailure(error), settingsHelp: HELPED_BY_SETTINGS.has(asFailure(error).code) }]); }
    finally { setBusy(false); }
  };

  const assistant = (key: number, className: string, body: React.ReactNode, busyRow = false) =>
    <div className="msg-row" key={key}><span className="avatar" aria-hidden="true">AI</span><div className={`bubble ${className}`} aria-busy={busyRow || undefined}>{body}</div></div>;

  return <section className="chat">
    <div className="messages" aria-live="polite">
      {messages.length === 0 && assistant(-1, "", <>
        <p>Ask me anything about your journal — I answer from your own entries and link the ones I used.</p>
        {!configured && <p>No AI provider is set up yet. <button className="link" onClick={onOpenSettings}>Choose a provider</button></p>}
      </>)}
      {messages.map((message, i) => {
        if (message.role === "user") return <div className="msg-row user" key={i}><div className="bubble user">{message.text}</div></div>;
        if (message.role === "streaming") return assistant(i, message.text ? "streaming" : "pending", <>{message.text ? hideCitationIds(message.text) : "Searching your journal…"}<span className="cursor" aria-hidden="true">▍</span></>, true);
        if (message.role === "error") return <div className="msg-row" key={i} role="alert"><span className="avatar error" aria-hidden="true">!</span><div className="bubble error">{message.text} {message.settingsHelp && <button className="link" onClick={onOpenSettings}>Open AI settings</button>}</div></div>;
        const { result } = message; const valid = new Set(result.citations);
        return assistant(i, "", splitAnswer(result.answer, valid).map((part, j) => part.kind === "text" ? part.text : <Citation key={j} entryId={part.entryId} chunks={result.diagnostics.final_results} onOpen={onOpenEntry} />));
      })}
    </div>
    {saveError && <p className="notice warn chat-save-error" role="alert">{saveError}</p>}
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea aria-label="Ask your journal" rows={2} placeholder="Ask about your entries, patterns, or how your thinking changed…" value={input} disabled={busy}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <button className="send" aria-label="Send" disabled={busy || !input.trim()}><Icon name="send" size={13} /></button>
    </form>
    <p className="composer-note">{configured && model ? `Answering with ${model}` : "Enter to send · Shift+Enter for a new line"}</p>
  </section>;
}
