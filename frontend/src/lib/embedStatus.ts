/** Mirrors src-tauri/src/embedder.rs::EmbedStatus. */
export interface EmbedStatus {
  state: "starting" | "working" | "up_to_date" | "waiting" | "unavailable";
  pending_entries: number | null; last_error: string | null; next_retry_seconds: number | null;
}

export type Tone = "ok" | "busy" | "warn";

const minutes = (seconds: number) => seconds < 60 ? "under a minute" : `${Math.round(seconds / 60)} min`;

/** One short line for the sidebar, plus an optional detail for the tooltip. */
export function describeEmbedStatus(status: EmbedStatus): { text: string; detail?: string; tone: Tone } {
  switch (status.state) {
    case "starting": return { text: "Semantic search: starting…", tone: "busy" };
    case "working": return { text: status.pending_entries ? `Semantic search: indexing ${status.pending_entries} ${status.pending_entries === 1 ? "entry" : "entries"}…` : "Semantic search: indexing…", tone: "busy" };
    case "up_to_date": return { text: "Semantic search: up to date", tone: "ok" };
    case "waiting": return { text: `Semantic search paused — retrying in ${minutes(status.next_retry_seconds ?? 0)}`, detail: status.last_error ?? undefined, tone: "warn" };
    case "unavailable": return { text: "Semantic search unavailable (keyword search still works)", detail: status.last_error ?? undefined, tone: "warn" };
  }
}
