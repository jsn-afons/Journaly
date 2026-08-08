# Development

Prerequisites: Node.js 20+, Rust stable with the Tauri macOS prerequisites, and Python 3.12 with `pydantic` installed. Use a Python 3.12 interpreter for the app with `JOURNALY_PYTHON=/path/to/python3.12` when it is not the default.

Install frontend dependencies with `npm --prefix frontend install`, then launch with `npm --prefix frontend run tauri`. Run daemon tests with `npm run test:python`.
