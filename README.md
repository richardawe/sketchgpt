# sketchgpt

A chat page that runs a language model **in the browser** — no server, no API
key, no install for whoever opens it. Weights download once from a CDN into
browser storage; every visit after that loads from cache and works offline.

Also includes a local [Ollama](https://ollama.com) setup for development.

> **Built on [WebLLM](https://github.com/mlc-ai/web-llm)** (MLC), which does the
> actual in-browser inference. In-browser LLMs are an established category —
> WebLLM has shipped since 2023 and runs its own demo at
> [chat.webllm.ai](https://chat.webllm.ai). This repo is a deployable
> starting point with device-aware model selection, not a new technique.

## Use this as a template

```bash
gh repo create my-chat --public --template <you>/sketchgpt --clone
cd my-chat
./scripts/setup-pages.sh
```

That pushes the repo, enables Pages, triggers the deploy and prints your URL.
It uses **your** `gh` credentials, because a workflow's `GITHUB_TOKEN` cannot
create a Pages site — it fails with *"Resource not accessible by integration"*.

Already have a repo? Run `./scripts/setup-pages.sh` inside it, or
`./scripts/setup-pages.sh my-chat` to create one first.

Then open the URL. The first visit asks before downloading the weights;
after that the page loads them from cache and drops you straight into chat.

### What visitors get

| Device | Model chosen | Download |
|---|---|---|
| Desktop | Qwen3-0.6B | ~500 MB |
| Phone / tablet | SmolLM2-360M | ~376 MB |

The page reads the GPU adapter and available memory, filters out models the
device cannot run, and picks one with headroom to spare. Anything larger is
labelled and needs a confirmation, because exceeding the limit kills the tab
rather than raising an error. Bigger models are one dropdown away — Qwen3-1.7B
is the sweet spot on a desktop.

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

### Two ways to run it

| | `web/index.html` (Ollama) | `web/browser.html` (in-browser) |
|---|---|---|
| Runs on | Ollama, via localhost | WebGPU, inside the tab |
| Needs installing | Yes | No |
| Hostable on GitHub Pages | No | **Yes** |
| Works for other people | Only if they install Ollama | Anyone with a WebGPU browser |
| Model storage | `models/ollama/` on disk | Browser cache, persisted |
| Speed | Faster | Slower, but no setup |

### Why the Ollama page can't go on GitHub Pages

Your model runs at `http://127.0.0.1:11434` on *your* machine. A Pages site is
public HTTPS, so calling it is a public-to-private request. Chrome's Private
Network Access rules require the local server to opt in with an
`Access-Control-Allow-Private-Network` header, and Ollama does not send one —
verified against Ollama 0.34.2:

```
# from https://<user>.github.io, with the origin explicitly allowed:
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://<user>.github.io
# ... and no Access-Control-Allow-Private-Network header
```

The CORS half passes, the private-network half does not. Serving from
`http://localhost` avoids it entirely — both ends are local, so no
private-network check applies.

### How the in-browser page sidesteps all of it

`web/browser.html` removes the local server from the picture: it downloads the
weights into browser storage and runs inference in the tab via WebGPU. There is
no `127.0.0.1` call, so there is nothing for the private-network rules to block.
**This one can be hosted on GitHub Pages**, and it works for any visitor without
them installing anything.

The weights do *not* come from Pages — they stream from the Hugging Face CDN
that [WebLLM](https://github.com/mlc-ai/web-llm) publishes precompiled models
to. Pages only serves the ~15 KB of HTML. That matters, because Pages caps
files at 100 MB and sites at ~1 GB, so the weights could never live there.

```bash
python3 -m http.server 8080 --directory web   # then open /browser.html
```

### Publishing it

`.github/workflows/pages.yml` deploys the site on every push that touches
`web/`. It assembles `browser.html` as the site's `index.html` (the page that
works for a visitor) and ships the Ollama page as `ollama.html`.

**Pages has to be switched on once by hand first:**

> Settings → Pages → Source: **GitHub Actions**

The workflow cannot do this for you. Creating a Pages site requires
repo-administration rights and the workflow's `GITHUB_TOKEN` does not have
them — `actions/configure-pages` fails with *"Create Pages site failed. Error:
Resource not accessible by integration"*. Once the source is set, that step
reads the existing config and every later push deploys on its own.

The site then lands at `https://<user>.github.io/sketchgpt/`. Pages serves over
HTTPS, which WebGPU requires anyway.

**Requirements and caveats**

- **WebGPU with a real GPU adapter.** Chrome/Edge 113+, Safari 18+, recent
  Firefox. The page resolves an actual adapter before offering to load, because
  `navigator.gpu` can exist on GPU-less VMs where no adapter is obtainable.
- **First load downloads the weights** — a few hundred MB, shown as a progress
  bar. After that it loads from cache in seconds and works fully offline.
- **Storage quota.** The page calls `navigator.storage.persist()` to ask the
  browser not to evict the weights, and warns when the quota looks too small to
  hold them. Quotas vary by device and free disk.
- **Slower than Ollama**, and capped at a 4096-token context.

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
web/index.html            streaming chat UI, talks to local Ollama
web/browser.html          runs the model in-browser via WebGPU (Pages-ready)
docs/customising.md       how to change what the model does
```

## Notes

- The setup script is idempotent — rerun it any time; it skips work already done.
- The server writes to `models/ollama-serve.log` (ignored).
- Stop the server with `pkill -x ollama`.
- On a machine using systemd, the Ollama installer also registers a service
  that defaults to `~/.ollama`. The script always runs the server with
  `OLLAMA_MODELS` pointed at this repo, so the two stores stay separate.
