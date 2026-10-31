import { useState } from "react";
import { aiRpc } from "../lib/rpc";
import { asFailure, describeFailure } from "../lib/errors";
import { splitAnswer } from "../lib/citations";
import type { ChatResult, RetrievalDiagnostics } from "../types/ai";
import { Citation } from "./Citation";

type Message = { role: "user"; text: string } | { role: "streaming"; text: string } | { role: "assistant"; result: ChatResult } | { role: "error"; text: string; settingsHelp: boolean };
interface Props { configured: boolean; onOpenSettings(): void; onOpenEntry(path: string): void; onDiagnostics(d: RetrievalDiagnostics): void }

// Raw ids are unreadable mid-stream; they become clickable chips once the complete answer is validated.
const hideCitationIds = (text: string) => text.replace(/\[(?:entry:\s*)?[0-9a-fA-F-]{36}\]/g, "[source]");

const HELPED_BY_SETTINGS = new Set(["EMBEDDING_PROVIDER_UNAVAILABLE", "LLM_PROVIDER_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "SIDECAR_UNAVAILABLE"]);

/** Answers stream in as plain text; when complete they are replaced by the validated result with citation chips. */
export function Chat({ configured, onOpenSettings, onOpenEntry, onDiagnostics }: Props) {
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

  return <section className="chat">
    <div className="messages" aria-live="polite">
      {messages.length === 0 && <div className="empty-chat"><p>Ask about your journal. Answers cite the entries they come from.</p>{!configured && <p>No AI provider is set up yet. <button onClick={onOpenSettings}>Choose a provider</button></p>}</div>}
      {messages.map((message, i) => {
        if (message.role === "user") return <p className="msg user" key={i}>{message.text}</p>;
        if (message.role === "streaming") return <p className={message.text ? "msg assistant streaming" : "msg assistant pending"} key={i} aria-busy="true">{message.text ? hideCitationIds(message.text) : "Searching your journal…"}<span className="cursor" aria-hidden="true">▍</span></p>;
        if (message.role === "error") return <p className="msg error" role="alert" key={i}>{message.text} {message.settingsHelp && <button onClick={onOpenSettings}>Open AI settings</button>}</p>;
        const { result } = message; const valid = new Set(result.citations);
        return <p className="msg assistant" key={i}>{splitAnswer(result.answer, valid).map((part, j) => part.kind === "text" ? part.text : <Citation key={j} entryId={part.entryId} chunks={result.diagnostics.final_results} onOpen={onOpenEntry} />)}</p>;
      })}
    </div>
    <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <input aria-label="Ask your journal" placeholder="What have I thought about…?" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
      <button disabled={busy || !input.trim()}>Ask</button>
    </form>
  </section>;
}
