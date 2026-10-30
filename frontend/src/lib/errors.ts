import type { AppFailure } from "../types/ai";

export function asFailure(error: unknown): AppFailure {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) return error as AppFailure;
  return { code: "UNKNOWN", message: error instanceof Error ? error.message : String(error), retryable: false };
}

/** Plain-language text for the codes the daemon can return. Unknown codes fall back to the server message. */
export function describeFailure(error: unknown): string {
  const failure = asFailure(error);
  switch (failure.code) {
    case "EMBEDDING_PROVIDER_UNAVAILABLE":
    case "LLM_PROVIDER_UNAVAILABLE": return "The AI provider is unreachable (offline or no API key set). Keyword search and editing still work.";
    case "VECTOR_INDEX_UNAVAILABLE": return "Semantic search is unavailable in this Python runtime; keyword search still works.";
    case "NO_CONTEXT_AVAILABLE": return "Nothing relevant is indexed yet for that question.";
    case "SIDECAR_UNAVAILABLE": return "The local AI service isn't running.";
    default: return failure.message;
  }
}
