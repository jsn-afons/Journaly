#!/usr/bin/env bash
# Freeze the Python AI service into a self-contained folder (build/daemon/journaly-ai/) with its own Python
# interpreter and libraries, so the installed app doesn't need Python on the Mac. Uses ai_daemon/.venv-build
# (Homebrew Python 3.12, whose SQLite can load the sqlite-vec extension).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PY="$ROOT/ai_daemon/.venv-build/bin/python"
if [ ! -x "$PY" ]; then
  /opt/homebrew/opt/python@3.12/bin/python3.12 -m venv ai_daemon/.venv-build
  "$PY" -m pip install -q "httpx>=0.27,<1" "pydantic>=2.9,<3" "sqlite-vec==0.1.9" "pyinstaller>=6,<7"
fi
"$PY" -m PyInstaller --noconfirm --clean --onedir --name journaly-ai \
  --distpath "$ROOT/build/daemon" --workpath "$ROOT/build/pyinstaller" --specpath "$ROOT/build/pyinstaller" \
  --paths "$ROOT" \
  --collect-all sqlite_vec \
  --add-data "$ROOT/ai_daemon/retrieval/system_prompt.md:ai_daemon/retrieval" \
  --exclude-module ai_daemon.tests \
  "$ROOT/scripts/daemon_entry.py"
echo "Built $ROOT/build/daemon/journaly-ai/journaly-ai"
