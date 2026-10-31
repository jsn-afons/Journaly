import { useState } from "react";
import type { RetrievalDiagnostics } from "../types/ai";
import type { SettingsView } from "../types/settings";
import { isLocalUrl } from "../lib/presets";
import { parseChat } from "../lib/chats";
import { chatsRpc } from "../lib/rpc";
import { describeFailure } from "../lib/errors";
import { Chat, type OpenChat } from "./Chat";
import { ChatHistory } from "./ChatHistory";
import { Icon } from "./Icon";
import { Inspector } from "./Inspector";

interface Props {
  provider: SettingsView | null; diagnostics: RetrievalDiagnostics | null;
  onClose(): void; onOpenSettings(): void; onOpenEntry(path: string): void; onDiagnostics(d: RetrievalDiagnostics): void;
}

/** Right-hand drawer: chat with the journal, plus the retrieval Inspector for debugging. */
export function AiPanel({ provider, diagnostics, onClose, onOpenSettings, onOpenEntry, onDiagnostics }: Props) {
  const [tab, setTab] = useState<"chat" | "history" | "inspector">("chat");
  const [open, setOpen] = useState<OpenChat | undefined>();
  const [chatKey, setChatKey] = useState(0); // a new key remounts Chat: a fresh or a different saved conversation
  const [savedCount, setSavedCount] = useState(0); // bumps when a chat is saved so History reloads
  const [historyError, setHistoryError] = useState("");
  const [currentPath, setCurrentPath] = useState<string | null>(null); // file of the chat on screen, once saved

  const startNew = () => { setOpen(undefined); setCurrentPath(null); setChatKey((k) => k + 1); setTab("chat"); };
  const openSaved = async (path: string) => {
    try { const document = await chatsRpc.get(path); setCurrentPath(path); setOpen({ path, chat: parseChat(document, path.split("/").pop()?.replace(/\.md$/i, "")) }); setChatKey((k) => k + 1); setTab("chat"); setHistoryError(""); }
    catch (error) { setHistoryError(describeFailure(error)); }
  };
  const configured = provider?.configured ?? false;
  const badge = !configured ? "Not set up" : isLocalUrl(provider!.chat_base_url) ? "Local" : "Hosted";
  return <aside className="ai-panel" aria-label="AI assistant">
    <header className="ai-header">
      <div className="ai-title"><span className={configured ? "dot live" : "dot"} aria-hidden="true" /><strong>Journal AI</strong><span className="badge">{badge}</span></div>
      <span className="ai-actions">
        <button className="icon-button" onClick={startNew} aria-label="New chat" title="New chat"><Icon name="plus" size={14} /></button>
        <button className="icon-button" onClick={onClose} aria-label="Close AI panel"><Icon name="close" /></button>
      </span>
    </header>
    <div className="segmented full" role="tablist">
      <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>Chat</button>
      <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}><Icon name="clock" size={12} /> History</button>
      <button role="tab" aria-selected={tab === "inspector"} className={tab === "inspector" ? "on" : ""} onClick={() => setTab("inspector")}><Icon name="chart" size={12} /> Inspector</button>
    </div>
    {/* Chat stays mounted while the Inspector is shown so the conversation isn't lost. */}
    <div className={tab === "chat" ? "ai-body" : "ai-body hidden"}><Chat key={chatKey} saved={open} onSaved={(path) => { setCurrentPath(path); setSavedCount((n) => n + 1); }} configured={configured} model={provider?.chat_model} onOpenSettings={onOpenSettings} onOpenEntry={onOpenEntry} onDiagnostics={onDiagnostics} /></div>
    {tab === "history" && <div className="ai-body">
      {historyError && <p className="notice warn" role="alert">{historyError}</p>}
      <ChatHistory currentPath={currentPath} refresh={savedCount} onOpen={(path) => void openSaved(path)} onNew={startNew} onDeleted={(path) => { if (currentPath === path) startNew(); }} />
    </div>}
    {tab === "inspector" && <div className="ai-body"><Inspector diagnostics={diagnostics} /></div>}
  </aside>;
}
