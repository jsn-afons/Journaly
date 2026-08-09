#!/usr/bin/env bash
set -euo pipefail

runtime_python="${JOURNALY_BUILD_PYTHON:-/opt/homebrew/opt/python@3.12/bin/python3.12}"
runtime_dir="${JOURNALY_RUNTIME_DIR:-ai_daemon/.runtime/arm64}"

if [[ ! -x "$runtime_python" ]]; then
  echo "Controlled runtime requires Homebrew Python 3.12 at $runtime_python." >&2
  echo "Install it with: brew install python@3.12" >&2
  exit 1
fi

machine="$($runtime_python -c 'import platform; print(platform.machine())')"
if [[ "$machine" != "arm64" ]]; then
  echo "This Phase A runtime targets arm64; got $machine." >&2
  exit 1
fi

"$runtime_python" -m venv "$runtime_dir"
"$runtime_dir/bin/python" -m pip install --upgrade pip
"$runtime_dir/bin/python" -m pip install -e ai_daemon
"$runtime_dir/bin/python" scripts/validate_runtime.py
