import { useState } from "react";
import type { RetrievalDiagnostics } from "../types/ai";
import type { SettingsView } from "../types/settings";
import { isLocalUrl } from "../lib/presets";
import { Chat } from "./Chat";
import { Icon } from "./Icon";
import { Inspector } from "./Inspector";

interface Props {
  provider: SettingsView | null; diagnostics: RetrievalDiagnostics | null;
  onClose(): void; onOpenSettings(): void; onOpenEntry(path: string): void; onDiagnostics(d: RetrievalDiagnostics): void;
}

/** Right-hand drawer: chat with the journal, plus the retrieval Inspector for debugging. */
export function AiPanel({ provider, diagnostics, onClose, onOpenSettings, onOpenEntry, onDiagnostics }: Props) {
  const [tab, setTab] = useState<"chat" | "inspector">("chat");
  const configured = provider?.configured ?? false;
  const badge = !configured ? "Not set up" : isLocalUrl(provider!.chat_base_url) ? "Local" : "Hosted";
  return <aside className="ai-panel" aria-label="AI assistant">
    <header className="ai-header">
      <div className="ai-title"><span className={configured ? "dot live" : "dot"} aria-hidden="true" /><strong>Journal AI</strong><span className="badge">{badge}</span></div>
      <button className="icon-button" onClick={onClose} aria-label="Close AI panel"><Icon name="close" /></button>
    </header>
    <div className="segmented full" role="tablist">
      <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>Chat</button>
      <button role="tab" aria-selected={tab === "inspector"} className={tab === "inspector" ? "on" : ""} onClick={() => setTab("inspector")}><Icon name="chart" size={12} /> Inspector</button>
    </div>
    {/* Chat stays mounted while the Inspector is shown so the conversation isn't lost. */}
    <div className={tab === "chat" ? "ai-body" : "ai-body hidden"}><Chat configured={configured} model={provider?.chat_model} onOpenSettings={onOpenSettings} onOpenEntry={onOpenEntry} onDiagnostics={onDiagnostics} /></div>
    {tab === "inspector" && <div className="ai-body"><Inspector diagnostics={diagnostics} /></div>}
  </aside>;
}
