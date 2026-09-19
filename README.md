# sketchgpt

Local LLM setup for sketchgpt, running a small base model through
[Ollama](https://ollama.com).

## Quickstart

```bash
./scripts/setup-ollama.sh
```

That installs Ollama (and `zstd`, which its installer needs but does not pull
in), starts the server, downloads the pinned model into `models/ollama/`,
verifies the weights against their pinned digest, and runs a smoke test.

Then talk to the model:

```bash
export OLLAMA_MODELS="$PWD/models/ollama"
ollama run qwen3:0.6b
```

Or over HTTP:

```bash
curl http://127.0.0.1:11434/api/generate -d '{
  "model": "qwen3:0.6b",
  "prompt": "Describe a sketch of a cat in one sentence.",
  "stream": false,
  "think": false
}'
```

## The model

| | |
|---|---|
| Model | `qwen3:0.6b` |
| Parameters | 0.6 B |
| Quantization | Q4_K_M |
| Download | ~499 MiB |
| License | Apache 2.0 |

Chosen as the smallest model that still produces usable output — it runs on CPU
alone, so no GPU is required for local development. Exact digests are pinned in
[`models/model-pin.json`](models/model-pin.json) and verified on every setup
run, so all checkouts get byte-identical weights.

To swap models, pick another small tag (`gemma3:270m`, `llama3.2:1b`,
`smollm2:135m`), pull it, and update `models/model-pin.json` with the new
digests from
`models/ollama/manifests/registry.ollama.ai/library/<name>/<tag>`.

## Why the weights are not in git

`models/ollama/` is git-ignored. The weights are one ~498 MiB file, and GitHub
rejects any pushed file over 100 MiB, so they cannot be committed directly.
Git LFS could hold them, but a free account gets 1 GiB of storage and 1 GiB of
bandwidth per month — a single file this size would exhaust that within two
clones.

Re-downloading from Ollama's registry is faster than an LFS pull anyway, and
the digest pin gives the same reproducibility guarantee that committing the
bytes would. If you do want the weights versioned, `git lfs track
"models/ollama/blobs/*"` and drop the ignore rule — just budget the quota.

## Layout

```
models/model-pin.json     pinned model + digests (committed)
models/ollama/            Ollama model store — weights live here (ignored)
scripts/setup-ollama.sh   install, serve, pull, verify, smoke-test
```

## Notes

- The setup script is idempotent — rerun it any time; it skips work already done.
- The server writes to `models/ollama-serve.log` (ignored).
- Stop the server with `pkill -x ollama`.
- On a machine using systemd, the Ollama installer also registers a service
  that defaults to `~/.ollama`. The script always runs the server with
  `OLLAMA_MODELS` pointed at this repo, so the two stores stay separate.
