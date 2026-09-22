# sketchgpt

A chat page that runs a language model **in the browser** — no server, no API
key, no install for whoever opens it. Weights download once from a CDN into
browser storage; every visit after that loads from cache, and a service worker
keeps the page itself available with no connection at all.

Also includes a local [Ollama](https://ollama.com) setup for development.

> **Built on [WebLLM](https://github.com/mlc-ai/web-llm)** (MLC), which does the
> actual in-browser inference. In-browser LLMs are an established category —
> WebLLM has shipped since 2023 and runs its own demo at
> [chat.webllm.ai](https://chat.webllm.ai). This repo is a deployable
> starting point with device-aware model selection, not a new technique.

## Use this as a template

```bash
gh repo create my-chat --public --template richardawe/sketchgpt --clone
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

### Simple sketches

In the browser page, choose **Sketch** in the header, load a model, and describe
what to draw, for example “a house beside a tree”. The same text model produces
drawing commands; the page validates them and renders an SVG locally.
**Download SVG** saves an editable file. No image model, no extra download.

The model writes lines of text inside a JSON envelope:

```json
{"t":"A house beside a tree","c":["house 25 55 40","tree 78 50 34","sun 15 15 14","line 2 88 98 88"]}
```

`house 25 55 40` is a **stamp** — a noun, a position and a size on a 0–100
grid. The page owns the shape; the model only has to name the thing and say
where it goes. There are 133 stamps with 84 aliases, and any noun outside that
vocabulary falls back to a text label rather than disappearing. `line`, `box`,
`circle`, `curve` and `label` are there for everything a noun cannot cover.

#### Why it is shaped that way

Qwen's tokenizer gives every digit its own token, and the space before it
another, so `" 160"` costs four tokens. **Coordinates are what a drawing
costs — not syntax.** Measured on one scene with Qwen3-0.6B's own tokenizer
(`node scripts/token-budget.mjs`):

| Encoding | Tokens | Commands | Per command |
|---|---|---|---|
| JSON objects on a 0–400 grid | 235 | 10 | 23.5 |
| Command lines on a 0–100 grid | 134 | 10 | 13.4 |
| The same scene as stamps | **66** | 5 | 13.2 |

A stamped drawing costs **3.6× less** than the JSON it replaced, and looks
better: a real tree instead of two line segments. Shortening `rectangle` to
`r` was measured too, and saved nothing — the tool name is a rounding error
next to the numbers.

The prompt is **planned, not accumulated**. Only the previous drawing and the
instruction that produced it are carried, so the prompt is the same size on
turn ten as on turn two — measured flat at 391 tokens at every context rung.
`max_tokens` is set from the room actually left, never past it, because
generation that reaches the context edge stops silently mid-drawing. The
command budget is derived from that room.

Two rendering touches cost no model tokens at all, because they are applied to
geometry the model already sent: [rough.js](https://roughjs.com) draws every
shape with a hand-drawn line, and the stamps are [Lucide](https://lucide.dev)
icons. Rough.js is vendored in `web/rough.mjs` rather than fetched from a CDN,
because this page claims to work offline once the weights are cached and a CDN
import would quietly cost every offline sketch its line. The page renders clean
SVG if the module fails to load; `?rough=0` turns it off.

#### Colour, on models that can afford it

A colour is one word at the end of a command:

```
house 25 55 40 red
```

One token, where `#c0392b` is seven — and the page owns the actual values, so
the model never has to know a hex code and cannot invent an unreadable one.
The palette is `red orange yellow green blue purple pink brown grey black`.

Colour costs about 30 prompt tokens to teach, which a 1024-token phone cannot
spare, so it is offered only at a context of 2048 or more — desktop models get
it, phones stay monochrome and pay nothing for it. The parser accepts colour
from any model regardless; only the teaching is rationed.

The page also **places** what the model could only name. A small model will
happily return three correct nouns at the same coordinates; when stamps have
collapsed into each other the page separates them, keeping the order they were
listed in. A deliberate overlap — a sun behind a cloud — is left alone, and
primitives are never moved, because a line is geometry the model may mean
exactly.

**Show commands** under any drawing reveals the exact lines the model sent —
not the page's tidied version — and says how many stamps it had to move apart.
A sketch that fails shows the raw model output the same way. On a phone that is
the difference between a bug report and a guess.

Those commands are **editable**. Change `house 30 60 30` to `house 30 60 60`,
press **Redraw**, and the house doubles; add `red` on the end and it changes
colour. It is the cheapest way to fix something the model got slightly wrong,
and the clearest way to show a child that a picture is a handful of shapes at
a handful of positions. An edit is parsed with the auto-spacing switched off,
because that exists to correct a model that cannot place things — a person who
types two coordinates means them. An edit also replaces the stored drawing, so
a following "make it bigger" builds on what you drew.

The chat system prompt in Settings is **not** sent in sketch mode — it is
written for prose, and a leftover "answer concisely in plain English" silently
fought the drawing instructions. Ask for a style in the request instead.

Output cut off mid-JSON still renders the commands that arrived, captioned as
unfinished. A few unreadable commands are dropped and counted; mostly-bad
output says so instead of rendering a confident fragment.

Chat and sketch histories are separate. The mode is saved across reloads;
drawings and history are not. This is in `web/browser.html`, `web/sketch.mjs`
and `web/stamps.mjs`; the Ollama page is unchanged.

#### Not yet measured

There is no GPU in the environment this was built in, and SwiftShader loads
models but cannot generate, so every number above is a token count or a render
from a mock.

Three real runs so far, all Qwen3-0.6B on a phone, each one correcting the
prompt rather than the code:

1. **A single circle** for "a house beside a tree" — nothing dropped or
   misparsed, the model simply emitted almost nothing. Fixed by giving the
   prompt a worked example.
2. **Two houses** for "a house". It had copied the example's shape — two
   objects and a ground line — rather than its rule. Fixed, supposedly, by
   adding a second example of a different length.
3. **Two cats** for "a cat", so that did not take. Every shape the model had
   been shown held at least two commands, the empty template on the prompt's
   first line included. It now sees a one-command example and an explicit
   rule. The same request also once printed the *word* "cat" twice instead of
   drawing it, by reaching for `label`; that tool is now described as being
   for words written on the picture, never for naming something drawable.
4. **Three correct nouns, all in the same spot.** `house 50 50 30 /
   tree-deciduous 50 52 30 / car 50 54 30` — it named the objects perfectly
   and stacked them into a blob, having anchored on an example's coordinates
   and added 2 each time. That one is fixed in the page, not the prompt:
   `spreadStamps()` separates stamps that have collapsed, keeps the order they
   were listed in, and leaves a deliberate overlap alone. It was verified
   against that exact output in a test, with no round trip needed.

Duplication took three prompt iterations and a trip to a real phone each;
layout took one code change tested in seconds. The rule that keeps paying:
**if the page can compute it, the prompt should not ask for it.** Prompt
tokens are not free either — 197 to 391 across those rounds took a
1024-context phone from 437 output tokens to 299.

#### Does a bigger model draw better?

Yes for composition, no for placement. Same prompt, same parser, six requests,
run on CPU through Ollama (`node scripts/sketch-bench.mjs qwen3:0.6b qwen3:1.7b`):

| Model | Parsed | Commands | Distinct nouns | Requested things drawn | Drawings piled up |
|---|---|---|---|---|---|
| Qwen3-0.6B | 6/6 | 14 | 13 | 8/10 | 2 of 6 |
| Qwen3-1.7B | 6/6 | **62** | **19** | **9/10** | 2 of 6 |

The 0.6B is mostly *retrieving*. Asked to "draw a birthday party" it returned
`cat, sun, bird, bird, sailboat` — both of the prompt's worked examples
regurgitated verbatim. Asked for "a boat on the sea with two birds" it drew one
boat. The 1.7B invents a scene for the same requests and actually uses the
40-command desktop budget.

**Neither places any better.** Both piled stamps on top of each other in exactly
two of six drawings, which is why `spreadStamps()` runs at every size. Scale
buys vocabulary and coverage; it does not buy arithmetic.

Colour follows the same split: the 1.7B handles "a yellow sun over a blue sea"
correctly, while the 0.6B wrote `label 40 50 blue` — printing the word instead
of colouring anything. Neither model ever emitted an invalid colour, and
neither added colour that was not asked for.

The caveat on all of the above: Ollama serves GGUF Q4_K_M and the browser
serves MLC q4f16, so these are composition numbers, not the exact bytes a
visitor's device produces.

Nothing above 1.7B has been tried, and no model outside the Qwen3 family. The
desktop default is still Qwen3-0.6B — moving it to 1.7B would trade a ~500 MB
download for ~2 GB, which is a product decision rather than a silent one.

#### Checks

```bash
node --test tests/sketch.test.mjs     # format, stamps, clamping, budget
node tests/sketch-browser.mjs         # needs Playwright + Chromium
node tests/offline.mjs                # loads the page with the network cut
node scripts/token-budget.mjs         # real tokenizer; needs @lenml/tokenizers
node scripts/sketch-bench.mjs qwen3:1.7b   # real models; needs Ollama
node scripts/build-stamps.mjs         # regenerates web/stamps.mjs from Lucide
```

Set `PLAYWRIGHT_MODULE` to Playwright's `index.mjs` if it is not installed
locally. The browser checks drive a mock model and cover stamp rendering, SVG
export, mobile width, the flat prompt over seven turns, truncated output,
invalid output, cancellation and the saved mode. `SKETCH_ROUGH=0` runs them
against the clean-SVG fallback instead.

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
scripts/build-stamps.mjs  regenerates web/stamps.mjs from Lucide
scripts/token-budget.mjs  measures sketch cost against Qwen3's tokenizer
scripts/sketch-bench.mjs  runs the real prompt through real models on CPU
scripts/record-demo.mjs   records an mp4/gif of sketch mode for posting
web/index.html            streaming chat UI, talks to local Ollama
web/browser.html          runs the model in-browser via WebGPU (Pages-ready)
web/sketch.mjs            sketch format, context budget, SVG rendering
web/stamps.mjs            generated icon geometry (do not edit by hand)
web/rough.mjs             vendored rough.js 4.6.6 (MIT), the hand-drawn line
web/sw.js                 service worker — keeps the page itself usable offline
docs/customising.md       how to change what the model does
```

## Built on

- **[WebLLM](https://github.com/mlc-ai/web-llm)** (Apache 2.0) — the in-browser
  inference this page is a front end for.
- **[Lucide](https://lucide.dev)** (ISC) — the icon geometry behind sketch
  stamps, vendored as path data in `web/stamps.mjs`.
- **[rough.js](https://roughjs.com)** (MIT) — the hand-drawn line, vendored
  verbatim in `web/rough.mjs` so sketches keep it offline.
- **[KaTeX](https://katex.org)** (MIT) — maths in chat answers, loaded from a
  CDN on demand.

## Notes

- The setup script is idempotent — rerun it any time; it skips work already done.
- The server writes to `models/ollama-serve.log` (ignored).
- Stop the server with `pkill -x ollama`.
- On a machine using systemd, the Ollama installer also registers a service
  that defaults to `~/.ollama`. The script always runs the server with
  `OLLAMA_MODELS` pointed at this repo, so the two stores stay separate.
