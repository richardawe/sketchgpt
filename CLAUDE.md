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
scripts/vram-probe/       measure what a model really allocates (no GPU needed)
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
| **`vram_required_MB` is advisory, and sometimes wrong** | **Nothing in WebLLM reads it** — zero property accesses in 0.2.85. Measured load-time allocation: SmolLM2-360M 574 MB vs 580 published (1% out), Llama-3.2-1B 1064 vs 1129 (6%), **Qwen3-0.6B 1342 vs 1925 (43%)**. The gap is MLC's planned workspace for `batch_verify` (706 MB on Qwen3-0.6B), a speculative-decoding function whose name appears nowhere in WebLLM. It is never bound and never allocated. |
| **Allocation is a formula, and it is linear in context** | `params + (2 × layers × kv_heads × head_dim × dtype_bytes) × ctx + ~23 MB`. KV dtype follows the build suffix — f32 in `q4f32`, f16 in `q4f16`. Verified by measurement on three models × four context lengths, then used to predict Llama-3.2-1B to within 1% before measuring. `params` and the KV geometry come from the `_metadata` blob inside the compiled wasm. |
| **Qwen3-0.6B fits a phone** | ~476 MB at 1024 context, ~828 MB at 4096 (q4f16, predicted from the measured formula). It was excluded by a published figure three times the truth. Download is only 352 MB. |
| **Attention shape beats parameter count** | KV per token at f16: Qwen2.5-0.5B 12 KiB, Qwen3-0.6B 112 KiB, SmolLM2-1.7B 192 KiB. Gemma 3's sliding window pins its cache at 512 tokens whatever the context. Qwen3.5 is **hybrid** — `kv_state_kind: "hybrid"`, only 6 of its 24 layers hold a KV cache, the other 18 are linear-attention. Full table in `docs/mobile-models.md`. |
| **fp32 builds are a free fallback** | `SmolLM2-360M-q4f32_1` and `-q4f16_1` download **byte-identical** shards. The suffix changes activation precision, not weight storage — fp32 costs GPU memory (376 published f16 vs 574 measured f32), not bandwidth. It also doubles KV dtype. |
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
- **`gemma3-1b-it-q4f16_1-MLC` cannot load.** Its config sets
  `sliding_window_size: 512`, the prebuilt record overrides
  `context_window_size: 4096`, and WebLLM throws `WindowSizeConfigurationError`
  when both are positive. It is in this page's dropdown today. Fix: pass
  `{ sliding_window_size: -1 }` in `chatOpts`. The seven Mistral records avoid
  this by overriding it themselves; gemma3's does not.
- **`max_history_size` is RNN state, not chat history.** It is consumed in
  exactly one place — `create_rnn_state`. Qwen3.5 sets it to 1 because it is a
  hybrid attention model, not because it forgets your conversation. (An earlier
  draft of `docs/mobile-models.md` got this wrong.)
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

**Machine:** no GPU here — but that is not the same as no WebGPU. Chromium with
`--enable-unsafe-webgpu` serves a real adapter through SwiftShader, and models
**load** under it, which is enough to measure allocation and to catch a model
that cannot load at all (see `scripts/vram-probe/`). What SwiftShader cannot do
is **generate**: a single token did not complete in 25 minutes at any prompt
length. So quality and throughput claims still come from Ollama on CPU or from
the user's own device. The user's machine is also CPU-only, which rules out
practical fine-tuning.

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
  costs, licences and a five-stage plan are in `docs/mobile-models.md`. Stages
  0–2 are all doable here now that allocation is measured; only Stage 3 onward
  (throughput, quality, the device ceiling) needs a real phone.
- **`gemma3-1b-it` is in the shipped dropdown and cannot load.** One line of
  `chatOpts` fixes it; it is the reason to do Stage 1 first.
- **Steady-state allocation is still unmeasured.** The figures are load-time
  floors: `batch_prefill` and `batch_decode` allocate on first inference, which
  SwiftShader could not reach. Budget against floor + that workspace (42 MB
  SmolLM2, 92 MB Llama-3.2-1B, 162 MB Qwen3-0.6B, 410 MB Qwen3.5-0.8B) until a
  real device says otherwise.
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
