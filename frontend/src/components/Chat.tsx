import { useState } from "react";
import { aiRpc } from "../lib/rpc";
import { describeFailure } from "../lib/errors";
import { splitAnswer } from "../lib/citations";
import type { ChatResult, RetrievalDiagnostics } from "../types/ai";
import { Citation } from "./Citation";

type Message = { role: "user"; text: string } | { role: "assistant"; result: ChatResult } | { role: "error"; text: string };
interface Props { onOpenEntry(path: string): void; onDiagnostics(d: RetrievalDiagnostics): void }

/** Non-streaming for now: `chat` is one JSON-RPC response (see docs/rag.md, "Streaming"). */
export function Chat({ onOpenEntry, onDiagnostics }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const query = input.trim(); if (!query || busy) return;
    setInput(""); setBusy(true); setMessages((m) => [...m, { role: "user", text: query }]);
    try {
      const result = await aiRpc.chat(query);
      onDiagnostics(result.diagnostics);
      setMessages((m) => [...m, { role: "assistant", result }]);
    } catch (error) { setMessages((m) => [...m, { role: "error", text: describeFailure(error) }]); }
    finally { setBusy(false); }
  };

  return <section className="chat">
    <div className="messages" aria-live="polite">
      {messages.length === 0 && <p className="empty">Ask about your journal. Answers cite the entries they come from.</p>}
      {messages.map((message, i) => {
        if (message.role === "user") return <p className="msg user" key={i}>{message.text}</p>;
        if (message.role === "error") return <p className="msg error" role="alert" key={i}>{message.text}</p>;
        const { result } = message; const valid = new Set(result.citations);
        return <p className="msg assistant" key={i}>{splitAnswer(result.answer, valid).map((part, j) => part.kind === "text" ? part.text : <Citation key={j} entryId={part.entryId} chunks={result.diagnostics.final_results} onOpen={onOpenEntry} />)}</p>;
      })}
      {busy && <p className="msg assistant pending">Thinking…</p>}
    </div>
    <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <input aria-label="Ask your journal" placeholder="What have I thought about…?" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
      <button disabled={busy || !input.trim()}>Ask</button>
    </form>
  </section>;
}
