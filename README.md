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

## Chat UI

```bash
./scripts/serve-web.sh          # then open http://localhost:8080
```

A dependency-free chat page (`web/index.html`) with streaming replies, a model
picker, and a live system-prompt box for experimenting with the model's
behaviour.

It must be **served**, not opened by double-clicking the file. A `file://` page
sends a null origin and Ollama rejects it — `serve-web.sh` handles this, and
also starts Ollama if it is not already running.

### Can this run on GitHub Pages?

You can host the page there, but **it will not reliably reach your model**, and
it would only ever work for someone running Ollama on their own machine.

The model runs at `http://127.0.0.1:11434` on *your* computer. A Pages site is
public HTTPS, so a request from it to your local Ollama is a public-to-private
call. Chrome's Private Network Access rules require the local server to opt in
with an `Access-Control-Allow-Private-Network` header, and Ollama does not send
one — verified against Ollama 0.34.2:

```
# from https://<user>.github.io, with the origin explicitly allowed:
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://<user>.github.io
# ... and no Access-Control-Allow-Private-Network header
```

So the CORS half passes but the private-network half does not. Browser
behaviour here is inconsistent and tightening over time — not something to
build on.

Serving from `http://localhost` avoids the problem entirely: both ends are
local, so no private-network check applies. Ollama allows any `localhost` or
`127.0.0.1` origin by default, which is why `serve-web.sh` needs no config.

**If you do want it on the public web**, the shape that actually works is a
small server-side proxy — a host with a GPU running Ollama behind an
authenticated API, with the static page calling that instead of `127.0.0.1`.
Note that this exposes your model to the internet, so put auth and rate
limiting in front of it.

## Making it do other things

See [`docs/customising.md`](docs/customising.md). Short version: Ollama runs
models, it cannot train them. Start with a system prompt — for most tasks that
is enough — and only climb toward RAG or a LoRA fine-tune when it genuinely
is not.

```bash
ollama create sketchgpt -f models/modelfiles/sketchgpt.Modelfile
ollama run sketchgpt
```

A custom model built this way shares the base weights, so it costs kilobytes,
not another 500 MB.

## Layout

```
models/model-pin.json     pinned model + digests (committed)
models/modelfiles/        custom models built on the base (committed)
models/ollama/            Ollama model store — weights live here (ignored)
scripts/setup-ollama.sh   install, serve, pull, verify, smoke-test
scripts/serve-web.sh      serve the chat UI on localhost
web/index.html            dependency-free streaming chat UI
docs/customising.md       how to change what the model does
```

## Notes

- The setup script is idempotent — rerun it any time; it skips work already done.
- The server writes to `models/ollama-serve.log` (ignored).
- Stop the server with `pkill -x ollama`.
- On a machine using systemd, the Ollama installer also registers a service
  that defaults to `~/.ollama`. The script always runs the server with
  `OLLAMA_MODELS` pointed at this repo, so the two stores stay separate.
