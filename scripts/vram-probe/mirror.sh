#!/usr/bin/env bash
# Mirror one MLC model + its compiled wasm into ./site so the probe can serve
# them locally. WebLLM rewrites model URLs to <base>/resolve/main/<file>, so the
# layout has to match Hugging Face's.
#
#   ./mirror.sh SmolLM2-360M-Instruct-q4f32_1-MLC SmolLM2-360M-Instruct-q4f32_1_cs1k
set -euo pipefail
M="${1:?usage: mirror.sh <mlc-model-id> <wasm-stem>}"
W="${2:?usage: mirror.sh <mlc-model-id> <wasm-stem>}"
LIBS="https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base"
D="site/models/$M/resolve/main"
mkdir -p "$D" site/lib
curl -sS "https://huggingface.co/api/models/mlc-ai/$M/tree/main" \
  | python3 -c 'import json,sys
for f in json.load(sys.stdin):
    p = f["path"]
    if p not in (".gitattributes", "README.md"): print(p)' \
  | while read -r f; do
      [ -s "$D/$f" ] || curl -sS -L -o "$D/$f" "https://huggingface.co/mlc-ai/$M/resolve/main/$f"
    done
[ -s "site/lib/$W-webgpu.wasm" ] || curl -sS -L -o "site/lib/$W-webgpu.wasm" "$LIBS/$W-webgpu.wasm"
[ -s site/lib/webllm.js ] || curl -sS -o site/lib/webllm.js \
  "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm"
cp -f measure.html site/measure.html
cp -f progress.html site/progress.html
du -sh "site/models/$M"
