#!/usr/bin/env bash
# Install Ollama and download the pinned base model into this repo.
#
# The model store lives at models/ollama/ (git-ignored — the weights are too
# large for GitHub). Digests are pinned in models/model-pin.json, so a fresh
# run reproduces byte-identical weights.
#
# Usage:
#   scripts/setup-ollama.sh            # install + serve + pull + verify
#   scripts/setup-ollama.sh --no-pull  # install + serve only

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export OLLAMA_MODELS="${OLLAMA_MODELS:-$REPO_ROOT/models/ollama}"
export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"

PIN_FILE="$REPO_ROOT/models/model-pin.json"
LOG_FILE="$REPO_ROOT/models/ollama-serve.log"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

read_pin() {
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$PIN_FILE" "$1"
}

[ -f "$PIN_FILE" ] || die "missing pin file: $PIN_FILE"
MODEL="$(read_pin model)"
WANT_DIGEST="$(read_pin model_layer_digest)"

# ---------------------------------------------------------------- install ---
if command -v ollama >/dev/null 2>&1; then
  log "ollama already installed (version $(ollama --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1))"
else
  # The official installer ships a .tar.zst and fails with an unhelpful error
  # if zstd is absent, so make sure it is there first.
  if ! command -v zstd >/dev/null 2>&1; then
    log "installing zstd (required to extract the ollama release)"
    if   command -v apt-get >/dev/null 2>&1; then sudo apt-get update -qq && sudo apt-get install -y zstd
    elif command -v dnf     >/dev/null 2>&1; then sudo dnf install -y zstd
    elif command -v pacman  >/dev/null 2>&1; then sudo pacman -S --noconfirm zstd
    elif command -v brew    >/dev/null 2>&1; then brew install zstd
    else die "install zstd manually, then re-run this script"
    fi
  fi
  log "installing ollama"
  curl -fsSL https://ollama.com/install.sh | sh
fi

# ------------------------------------------------------------------ serve ---
api() { curl -fsS --noproxy 127.0.0.1,localhost "http://$OLLAMA_HOST$1" "${@:2}"; }

if api /api/version >/dev/null 2>&1; then
  log "ollama server already running on $OLLAMA_HOST"
else
  log "starting ollama server (models -> $OLLAMA_MODELS, log -> $LOG_FILE)"
  mkdir -p "$OLLAMA_MODELS"
  nohup ollama serve >"$LOG_FILE" 2>&1 &
  for _ in $(seq 1 30); do
    api /api/version >/dev/null 2>&1 && break
    sleep 1
  done
  api /api/version >/dev/null 2>&1 || die "server did not come up; see $LOG_FILE"
fi
log "server version: $(api /api/version)"

if [ "${1:-}" = "--no-pull" ]; then
  log "done (--no-pull)"
  exit 0
fi

# ------------------------------------------------------------------- pull ---
log "pulling $MODEL into $OLLAMA_MODELS"
ollama pull "$MODEL"

# ----------------------------------------------------------------- verify ---
MANIFEST="$OLLAMA_MODELS/manifests/$(read_pin registry)/$(read_pin tag)"
if [ -f "$MANIFEST" ]; then
  GOT_DIGEST="$(python3 -c "
import json,sys
m=json.load(open(sys.argv[1]))
print(next(l['digest'] for l in m['layers']
           if l['mediaType']=='application/vnd.ollama.image.model'))" "$MANIFEST")"
  if [ "$GOT_DIGEST" = "$WANT_DIGEST" ]; then
    log "digest verified: $GOT_DIGEST"
  else
    warn "digest mismatch for $MODEL"
    warn "  expected: $WANT_DIGEST"
    warn "  got:      $GOT_DIGEST"
    warn "the upstream tag was re-published; update models/model-pin.json if intended"
  fi
else
  warn "manifest not found at $MANIFEST — skipping digest verification"
fi

# ------------------------------------------------------------ smoke test ---
log "running smoke test"
RESPONSE="$(api /api/generate -d "$(python3 -c "
import json,sys
print(json.dumps({'model': sys.argv[1],
                  'prompt': 'Reply with exactly: ok',
                  'stream': False, 'think': False,
                  'options': {'num_predict': 16}}))" "$MODEL")" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['response'].strip())")"
[ -n "$RESPONSE" ] || die "smoke test returned an empty response"
log "model replied: $RESPONSE"

log "ready. try:  OLLAMA_MODELS=$OLLAMA_MODELS ollama run $MODEL"
