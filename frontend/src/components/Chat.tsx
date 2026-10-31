import { useState } from "react";
import { aiRpc } from "../lib/rpc";
import { asFailure, describeFailure } from "../lib/errors";
import { splitAnswer } from "../lib/citations";
import type { ChatResult, RetrievalDiagnostics } from "../types/ai";
import { Citation } from "./Citation";
import { Icon } from "./Icon";

type Message = { role: "user"; text: string } | { role: "streaming"; text: string } | { role: "assistant"; result: ChatResult } | { role: "error"; text: string; settingsHelp: boolean };
interface Props { configured: boolean; model?: string; onOpenSettings(): void; onOpenEntry(path: string): void; onDiagnostics(d: RetrievalDiagnostics): void }

// Raw ids are unreadable mid-stream; they become clickable chips once the complete answer is validated.
const hideCitationIds = (text: string) => text.replace(/\[(?:entry:\s*)?[0-9a-fA-F-]{36}\]/g, "[source]");

const HELPED_BY_SETTINGS = new Set(["EMBEDDING_PROVIDER_UNAVAILABLE", "LLM_PROVIDER_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "SIDECAR_UNAVAILABLE"]);

/** Answers stream in as plain text; when complete they are replaced by the validated result with citation chips. */
export function Chat({ configured, model, onOpenSettings, onOpenEntry, onDiagnostics }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const query = input.trim(); if (!query || busy) return;
    setInput(""); setBusy(true); setMessages((m) => [...m, { role: "user", text: query }]);
    setMessages((m) => [...m, { role: "streaming", text: "" }]);
    const replaceLast = (next: Message[]) => setMessages((m) => [...m.slice(0, -1), ...next]);
    try {
      const result = await aiRpc.chatStream(query, (piece) => setMessages((m) => {
        const last = m[m.length - 1];
        return last?.role === "streaming" ? [...m.slice(0, -1), { role: "streaming", text: last.text + piece }] : m;
      }));
      onDiagnostics(result.diagnostics);
      replaceLast([{ role: "assistant", result }]);
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
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea aria-label="Ask your journal" rows={2} placeholder="Ask about your entries, patterns, or how your thinking changed…" value={input} disabled={busy}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <button className="send" aria-label="Send" disabled={busy || !input.trim()}><Icon name="send" size={13} /></button>
    </form>
    <p className="composer-note">{configured && model ? `Answering with ${model}` : "Enter to send · Shift+Enter for a new line"}</p>
  </section>;
}
