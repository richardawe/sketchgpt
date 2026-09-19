#!/usr/bin/env bash
# Serve the sketchgpt chat UI on localhost.
#
# The UI must be SERVED, not opened as a file:// page — Ollama rejects
# file:// requests (they carry a null Origin). Any http://localhost:PORT
# origin is allowed by Ollama's defaults, so no extra config is needed.
#
# Usage: scripts/serve-web.sh [port]   (default 8080)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8080}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

if ! curl -fsS --noproxy 127.0.0.1,localhost "http://127.0.0.1:11434/api/version" >/dev/null 2>&1; then
  log "ollama is not running — starting it"
  "$REPO_ROOT/scripts/setup-ollama.sh" --no-pull
fi

log "serving $REPO_ROOT/web on http://localhost:$PORT"
log "open:  http://localhost:$PORT"
log "stop:  Ctrl-C"
exec python3 -m http.server "$PORT" --directory "$REPO_ROOT/web" --bind 127.0.0.1
