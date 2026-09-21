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
- **`gemma3-1b-it-q4f16_1-MLC` could not load** — its config sets
  `sliding_window_size: 512`, the prebuilt record overrides
  `context_window_size: 4096`, and WebLLM throws `WindowSizeConfigurationError`
  when both are positive. Fixed by `chatOptsFor()` passing
  `sliding_window_size: -1`. The seven Mistral records clear it themselves;
  gemma3's does not, so check this for any new model with a sliding window.
- **`max_history_size` is RNN state, not chat history.** It is consumed in
  exactly one place — `create_rnn_state`. Qwen3.5 sets it to 1 because it is a
  hybrid attention model, not because it forgets your conversation. (An earlier
  draft of `docs/mobile-models.md` got this wrong.)
- **`required_features` is not a reliable fp16 filter.** Only 29 of 163 prebuilt
  records declare it; 54 models with `f16` in the id do not, including
  `gemma3-1b-it-q4f16_1` and every Qwen3.5 build. The page's regex is the more
  correct filter — keep it.
- **Models emit Markdown and LaTeX whether or not you ask.** A plain-text pane
  shows raw `**bold**` and `\frac{}{}` and reads as broken. `renderMarkdown()`
  handles both; KaTeX loads lazily from the CDN only when a message contains
  maths, and falls back to source text if it cannot be fetched.
- **`$…$` cannot be detected by a whitespace rule.** Models routinely pad the
  delimiters — `$ \frac{a}{b} $` — so requiring non-space inside them silently
  drops real formulas. `isFormula()` judges the *content* instead: LaTeX markup,
  or short plain algebra containing an operator. That keeps "$5 and $10" as
  prices.
- **`white-space: pre-wrap` doubles the line breaks** once a message is rendered
  as Markdown, because the markup already carries them. The `.rich` class
  switches it off; plain text and user messages keep it.
- **`height: 100vh` puts the composer below the fold on a phone.** On mobile
  `vh` is the viewport with the URL bar *hidden*, so the footer only appeared
  after dragging the page. `100dvh` (with `vh` as fallback) tracks the visible
  area. `interactive-widget=resizes-content` in the viewport meta keeps it above
  the on-screen keyboard.
- **`rows="1"` clips a placeholder that wraps.** The composer's
  "Enter to send, Shift+Enter for newline" hint needed two lines at every phone
  width and was cut in half. Measure the fit **while the element is visible** —
  a `display:none` element reports `scrollHeight` 0, so a startup check always
  says it fits.
- **"Cannot fetch <url>" is a STORAGE error, not a network one.** WebLLM's
  `fetchWithCache` raises it when `cache.add()` resolves but the entry is not
  in the cache afterwards. It usually names `mlc-chat-config.json`, a 2 KB
  file, which makes it read like a dead URL — the URL is fine. Causes: a full
  or capped store, private browsing, or a browser that silently evicts.
  `pickCacheBackend()` probes the Cache API at startup and falls back to
  WebLLM's `cacheBackend: "indexeddb"`; a failed load also offers a one-tap
  retry on the other backend. The two backends cannot see each other's
  weights, so switching means downloading again — never do it silently.
- **A failed load must not destroy the card.** `fail()` replaces `#wrap`, which
  removed the model picker and the load button and left a reload as the only
  way forward. Load failures use `failSoft()` instead, which appends the error
  and keeps the controls.
- **iOS zooms the page when a focused form control is under 16px.** `font:
  inherit` on the composer resolved to the body's 15px, so tapping it magnified
  everything and clipped the header and the answer text on the right. It looks
  exactly like horizontal overflow and is not — nothing is overflowing, the page
  is magnified. `@media (pointer: coarse) { … font-size: 16px }` stops it.
  **Chromium does not auto-zoom, so emulation will never catch this.**
- **`$v$` is the commonest inline formula and has no operator to detect.** A
  content rule built around operators drops single symbols. `isFormula()` also
  accepts a lone short identifier, letter-first so "$5" stays a price.
- **Small models drop closing braces.** `\frac{\Delta t}{\sqrt{1 - v^2/c^2)}`
  came out of a real answer. `balanceBraces()` closes what is open and retries;
  only then does it fall back to source text. Do **not** use KaTeX's
  `throwOnError: false` — its red error styling blames the page for what the
  model got wrong.
- **A bare `###` is how a truncated answer ends.** It is not a heading and not
  prose; the renderer drops empty headings rather than printing them.
- **"Stuck on start to get params" is a reporting bug, not a load bug.**
  `Start to fetch params` is the *first* callback WebLLM ever emits — the
  config, the ~6 MB wasm runtime and the tokenizer all fetch in silence before
  it — and the next one only arrives when a whole ~33 MB shard has landed, four
  in parallel, so the first lands about a quarter of the way in. Measured with
  `scripts/vram-probe/progress.html`: 0.8 s over localhost, 10.3 s throttled to
  30 Mbit/s, minutes on a phone, all of it showing one unchanged line at 0%.
  `navigator.storage.estimate()` is **no finer** — it steps one whole shard at a
  time in lockstep with the callback, because the Cache API backend downloads
  inside `cache.add()` where nothing can watch the stream. So the page does not
  fake a percentage it cannot have: an indeterminate bar until the first part
  lands, parts-finished and a running clock in the status, storage polled only
  as a liveness signal, and a notice after 45 s of silence that says which hosts
  it is waiting on. There is also a **Cancel** button now: `CreateMLCEngine`
  hides the engine until it resolves, so the page constructs `MLCEngine`
  directly and calls `unload()`, which aborts the reload. Cancel arrives as a
  `TypeError` out of `cache.add()`, not the `AbortError` WebLLM handles, so a
  flag and not the error decides whether it was deliberate.
- **WebLLM counts 0→100% three separate times** — fetch, upload to GPU, compile
  shaders — so a bar wired straight to `progress` rewinds twice. They are mapped
  onto one monotone scale, with different spans for a warm load, which skips the
  fetch pass entirely.
- **`cache.add()` reports a 404 and a full store identically.** Both come back
  as `TypeError: Failed to execute 'add' on 'Cache': Request failed`, with no
  URL and no status — the Cache API swallows them. The page used to call every
  one of these a storage problem, which is wrong whenever a host is blocked.
  `reachTest()` now pings the two hosts on failure and says which one answered.
  Note the probe must apply WebLLM's own `resolve/main/` rewrite: probing the
  bare repo URL gets Hugging Face's 404 page and reports the host as unreachable
  on *every* failure.
- **A truncated shard fails at decode, not at fetch**, with
  `Tensor-cache record range [0, N) exceeds shard size M`. That is the signature
  of an interrupted download, and the remedy is Clear cache, not a retry — a
  retry resumes onto the bad data.
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
- **Stages 0–2 of `docs/mobile-models.md` are done and live.** The page budgets
  from the measured formula, passes `chatOpts`, picks a context rung per device,
  and offers 15 models in three tiers. **Stages 3–5 remain** — steady-state
  measurement, the 135M-f16-vs-360M-4-bit comparison, and embedding
  co-residency.
- **Stage 3 is now partly unblocked.** Qwen3-0.6B has loaded *and generated* on
  the user's phone, so the measured formula has its first fp16 confirmation.
  `scripts/vram-probe/` takes `&gen=1` to capture the first-inference workspace
  on real hardware; that was impossible under SwiftShader.
- **Four phone-capable models where there was one.** At a 900 MB budget:
  SmolLM2-135M-q0f16, SmolLM2-360M-q4f16 and **Qwen2.5-0.5B-q4f16 all at a full
  4096 context**, Qwen3-0.6B at 1024. Qwen2.5-0.5B is the surprise — 296 MB
  download against a published 945 MB that excluded it outright.
- **`gemma3-1b` misses a 900 MB phone budget by 44 MB**, flat at every context
  rung because its sliding window caps the cache. Worth re-checking once the
  steady state is measured — the margin is inside the error bar.
- **Steady-state allocation is still unmeasured.** The figures are load-time
  floors: `batch_prefill` and `batch_decode` allocate on first inference, which
  SwiftShader could not reach. Budget against floor + that workspace (42 MB
  SmolLM2, 92 MB Llama-3.2-1B, 162 MB Qwen3-0.6B, 410 MB Qwen3.5-0.8B) until a
  real device says otherwise.
- **RAG never started.** No GPU needed, so it is the realistic next capability.
- **Two X threads are drafted** but unposted (in session history): a
  measurement-led one and a user-benefit one covering device detection,
  privacy, formula rendering and storage control.

---

## The lab's thesis

> The research on small models is locked in PDFs, measured on GSM8K, and says
> nothing about whether *your* device can run *your* task. Every project here is
> a page someone opens on their own device that answers a question about their
> own situation.

Not "I invented browser AI." The differentiator is honest measurement and
distribution, not novelty. See `docs/roadmap.md`.
