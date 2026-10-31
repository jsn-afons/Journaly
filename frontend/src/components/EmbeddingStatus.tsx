import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { describeEmbedStatus, type EmbedStatus } from "../lib/embedStatus";

const POLL_MS = 5000;

/** Sidebar line showing whether new writing has been made searchable by meaning yet. */
export function EmbeddingStatus() {
  const [status, setStatus] = useState<EmbedStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => invoke<EmbedStatus>("embedding_status").then((s) => { if (alive) setStatus(s); }).catch(() => undefined);
    void poll(); const timer = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!status) return null;
  const { text, detail, tone } = describeEmbedStatus(status);
  return <p className={`embed-status ${tone}`} title={detail} aria-live="polite">{text}{detail && <small>{detail}</small>}</p>;
}
