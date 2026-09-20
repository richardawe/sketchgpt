# sketchgpt — continuation brief

Read this first. It is the state of the project, the things that cost time to
learn, and the conventions that hold here.

**What this is:** the first shipped project of a one-person AI lab, built in
public on X. The lab's thesis is at the bottom.

---

## Live now

| | |
|---|---|
| Site | https://richardawe.github.io/sketchgpt/ |
| Repo | https://github.com/richardawe/sketchgpt (public, template enabled) |
| Default branch | `main` — deploys automatically on any push touching `web/` |

```
web/browser.html          in-browser inference (WebGPU via WebLLM) — the public page
web/index.html            local chat against Ollama — development only
scripts/setup-pages.sh    push, enable Pages, deploy, print URL (needs the user's gh)
scripts/setup-ollama.sh   install Ollama, pull the pinned model, verify, smoke-test
scripts/serve-web.sh      serve web/ on localhost
models/model-pin.json     exact layer digests for reproducible weights
docs/customising.md       what small models can and cannot do, with measurements
docs/mobile-models.md     the phone-suitable models WebLLM ships, and the plan to add them
docs/roadmap.md           the six-month plan
```

---

## Measured findings — do not re-derive these

All from real runs in-session. `smollm2:360m` in Ollama is **F16**; the browser
serves **4-bit**, and that gap explains most surprises.

| Finding | Detail |
|---|---|
| **Obedience beats capability** | Journal-entry sentiment: SmolLM2-360M **10/10**, Llama-3.2-1B **4/10**. The 1B lost by answering "good", "downward", "anxious" when asked for one of two words. |
| **Valid ≠ correct** | A grammar constraint (`root ::= "positive" \| "negative"`) guarantees well-formed output, not right output. At 4-bit the logits carry little signal, so it returns the same label every time. The mood tagger shipped, said "positive" to everything, and was deleted. |
| **4-bit wrecks instruction-following** | The academic literature agrees; sub-1B degrades hardest. Free generation breaks; this is why open chat read as gibberish on the phone. |
| **Task shape decides safety** | Tasks with a correct answer (classify, extract, route) fail **silently** — confident, well-formed, wrong. Tasks without one (describe, riff, open questions) degrade to merely **mediocre**, which is visible. Only ship the second kind at this size. |
| **Small models need a seed** | Given concrete input they produce usable lines. Asked to generate from nothing, or to follow a multi-part format, they waffle or echo the input back. |
| **Download size is not GPU size** | They diverge up to 4×. Qwen3-0.6B downloads **352 MB** and reserves **1403 MB**; gemma3-1b downloads 602 MB and reserves 711. The page's storage-quota check compares quota against the *reservation*, which is the wrong number. |
| **Attention shape beats parameter count** | KV cache per token: Qwen2.5-0.5B 12 KiB, Qwen3-0.6B 112 KiB, SmolLM2-1.7B 192 KiB. Gemma 3 1B's sliding window (512, pattern 6) pins its cache at ~28 MB whatever the context. Full table in `docs/mobile-models.md`. |
| **fp32 builds are a free fallback** | `SmolLM2-360M-q4f32_1` and `-q4f16_1` download **byte-identical** shards. The suffix changes activation precision, not weight storage — fp32 costs GPU memory (376 → 580 MB), not bandwidth. |
| **Desktop changes everything** | Qwen3-1.7B (2037 MB) produced a genuine multi-chapter book outline. The ceiling above belongs to 360M-class models on phones, not to the page. |

### Browser gotchas already fixed

- `navigator.gpu` can exist while `requestAdapter()` returns **null** (headless,
  GPU-less VMs, blocklisted drivers). Check for an adapter, not the API.
- Exceeding device memory **kills the tab** — no catchable error. Prevention is
  the only defence: budget with headroom, never ship a default near the limit.
- `q4f16` builds need the `shader-f16` adapter feature. Without it they are
  guaranteed to fail, so filter them out.
- Qwen3 chat templates **prefill the opening `<think>` tag**, so the stream
  carries only the closing `</think>`. Parsing for an opening tag dumps the
  whole monologue into the answer.
- Browser storage quota can be smaller than the model; the download then dies
  partway. Compare quota against the requirement before starting.
- Every **Qwen3.5** build in WebLLM sets `overrides.max_history_size: 1` — only
  the last turn survives. No other family does. Ship one without surfacing that
  and multi-turn chat breaks silently.
- **`required_features` is not a reliable fp16 filter.** Only 29 of 163 prebuilt
  records declare it; 54 models with `f16` in the id do not, including
  `gemma3-1b-it-q4f16_1` and every Qwen3.5 build. The page's regex is the more
  correct filter — keep it.
- A `file://` page sends a null origin and Ollama rejects it — the local page
  must be served.
- A constrained preset that persists across reloads must be **visible**, or the
  next session looks broken while behaving exactly as configured.

---

## Environment walls hit (all real, all cost time)

**GitHub, from this sandbox:** pushing commits works. These do not, and need a
human click:

1. A workflow's `GITHUB_TOKEN` **cannot create** a Pages site —
   *"Resource not accessible by integration"*. Hence `setup-pages.sh` runs
   locally with the user's own credentials.
2. The `github-pages` environment pins its allowed deploy branch at creation
   and **does not follow** a later default-branch change. Deleting the
   environment makes GitHub recreate it against the current default.
3. `PATCH /repos/...` (description, template flag, default branch) →
   *"Repository settings writes are not permitted through this proxy."*
4. Deleting a remote ref → blocked over git **and** over the API.

**Machine:** no GPU here, so **inference was never verifiable in-session** —
every model claim came from Ollama on CPU or from the user's own device. The
user's own machine is also CPU-only, which rules out practical fine-tuning.

---

## How to work here

- **Test before shipping, and say what was not tested.** Nearly every bug in
  this project was found by the user, not by testing: the phone crash, the
  gibberish, the stuck preset, the leaked reasoning, the always-positive
  classifier. Emulation did not substitute for real hardware. Name the gap.
- **Verify claims before making them.** "Nobody has this" was wrong twice —
  in-browser LLMs have shipped since 2023 (WebLLM runs chat.webllm.ai), and
  quantization effects on small models are well covered in the literature.
  Search first.
- **Credit WebLLM.** It does the actual inference. Saying so first removes the
  "this already exists" reply as a gotcha.
- **Prefer deleting a feature to shipping a confidently wrong one.** The mood
  tagger deletion is more credible than the app.
- Playwright: use `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` with
  `--no-sandbox`; never run `playwright install`. The proxy CA blocks loading
  live HTTPS pages in Chromium — fetch with curl and serve locally instead.

---

## Open threads

- **`setup-pages.sh` has never run end to end.** Guards, branch rewrite and the
  missing-`gh` path are verified; a real `gh repo create` is not. First real run
  is the test.
- **Old branch `claude/ollama-base-model-setup-hg1iuk` still exists remotely.**
  Strictly behind `main`, nothing unique on it. Needs a manual delete.
- **Repo topics not set** — `llm webgpu local-llm browser github-pages webllm`.
- **Six new phone-class models are researched but unintegrated.** Sizes, KV
  costs, licences and a five-stage plan are in `docs/mobile-models.md`. Stage 0
  is a pure bug fix and needs no GPU; Stage 1 onward needs a real phone.
- **The ~900 MB residual in Qwen `vram_required_MB` is unexplained.** Weights
  plus KV account for the whole figure on SmolLM2 and for only a third of it
  on Qwen3-0.6B and Qwen3.5-0.8B. Nothing should budget against a guess at it.
- **RAG never started.** No GPU needed, so it is the realistic next capability.
- **A launch thread for X is drafted** but unposted (in session history).

---

## The lab's thesis

> The research on small models is locked in PDFs, measured on GSM8K, and says
> nothing about whether *your* device can run *your* task. Every project here is
> a page someone opens on their own device that answers a question about their
> own situation.

Not "I invented browser AI." The differentiator is honest measurement and
distribution, not novelty. See `docs/roadmap.md`.
