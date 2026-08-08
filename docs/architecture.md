# Architecture

Journaly is a local-first macOS application. Markdown files in `Journal/` are the future canonical data store; all SQLite and AI-derived data will be rebuildable from them. The frontend communicates only through typed Tauri commands. Rust owns filesystem and OS integration; its sidecar client communicates with Python via line-delimited JSON-RPC on stdio. Python owns future indexing and retrieval work.

Phase 0 implements only the health path and deliberately contains no journal indexing or AI network calls.
