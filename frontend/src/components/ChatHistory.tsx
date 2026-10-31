import { useEffect, useState } from "react";
import { chatsRpc, type ChatSummary } from "../lib/rpc";
import { describeFailure } from "../lib/errors";
import { Icon } from "./Icon";

interface Props { currentPath: string | null; refresh: number; onOpen(path: string): void; onNew(): void; onDeleted(path: string): void }

function when(iso: string): string {
  const date = new Date(iso); const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** Saved chats, newest first. Deleting asks for a second click instead of a popup (the app window has no confirm dialogs). */
export function ChatHistory({ currentPath, refresh, onOpen, onNew, onDeleted }: Props) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = () => chatsRpc.list().then((list) => { setChats(list); setError(""); }).catch((e) => setError(describeFailure(e)));
  useEffect(() => { void load(); }, [refresh]);

  const remove = async (path: string) => {
    try { await chatsRpc.remove(path); setConfirming(null); onDeleted(path); await load(); } catch (e) { setError(describeFailure(e)); }
  };

  return <section className="chat-history" aria-label="Saved chats">
    <button className="new-chat" onClick={onNew}><Icon name="plus" size={13} /> New chat</button>
    {error && <p className="notice warn" role="alert">{error}</p>}
    {chats === null && !error && <p className="history-empty">Loading…</p>}
    {chats?.length === 0 && <p className="history-empty">No saved chats yet. Each conversation is saved here after the first answer.</p>}
    <ul>
      {chats?.map((chat) => <li key={chat.path} className={chat.path === currentPath ? "current" : ""}>
        <button className="history-open" onClick={() => onOpen(chat.path)} title={chat.path}>
          <span className="truncate">{chat.title}</span><small>{when(chat.updated_at)}</small>
        </button>
        {confirming === chat.path
          ? <span className="history-confirm"><button className="danger-text" onClick={() => void remove(chat.path)}>Delete</button><button onClick={() => setConfirming(null)}>Keep</button></span>
          : <button className="icon-button" aria-label={`Delete chat: ${chat.title}`} onClick={() => setConfirming(chat.path)}><Icon name="trash" size={13} /></button>}
      </li>)}
    </ul>
  </section>;
}
