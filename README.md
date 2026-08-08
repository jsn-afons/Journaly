# Journaly

A local-first macOS Markdown journal. Markdown files will remain the canonical source of truth; search, embeddings, and AI metadata are derived and rebuildable.

## Current status

Phase 0 foundation is implemented: a React/Vite shell calls a Tauri command which starts a Python JSON-RPC sidecar and requests its health status. Journal management, indexing, and AI retrieval are intentionally pending later phases.

## Development

See [development documentation](docs/development.md). The project requires Node.js, Rust stable/Tauri prerequisites, and Python 3.12.
