#!/usr/bin/env bash
# Build Journaly.app: a self-contained Mac app that runs without this source folder, Python, or a dev server.
#   1. Freeze the Python AI service (build_daemon.sh)
#   2. `tauri build`: compile the frontend (Vite) and the Rust app in release mode, and assemble Journaly.app
#   3. Copy the frozen service into Journaly.app/Contents/Resources/journaly-ai (ditto keeps its symlinks intact)
#   4. Re-sign the whole app ad hoc so macOS accepts the added code (signed for this Mac only, not notarized)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
scripts/build_daemon.sh
(cd src-tauri && "$ROOT/frontend/node_modules/.bin/tauri" build --bundles app)
APP="$ROOT/src-tauri/target/release/bundle/macos/Journaly.app"
rm -rf "$APP/Contents/Resources/journaly-ai"
ditto "$ROOT/build/daemon/journaly-ai" "$APP/Contents/Resources/journaly-ai"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "Built $APP"
