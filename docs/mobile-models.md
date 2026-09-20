# More models for phones — what is available, and how to add it

Research pass over WebLLM's shipped catalogue, done against primary sources:
the `prebuiltAppConfig` inside `@mlc-ai/web-llm@0.2.85`, each model's
`mlc-chat-config.json` on Hugging Face, and the Hugging Face file-size API.

The GPU-memory figures started as arithmetic and ended as **measurements**.
This sandbox has no GPU, but Chromium serves WebGPU through SwiftShader, which
is enough to load a model and count every byte it allocates. Three models were
measured across four context lengths, and the resulting formula predicted a
fourth before it was run.

What that does *not* cover: **no model was ever made to generate a token here**,
so every claim about whether a model is any good remains untested, and the
allocation figures are load-time floors. The plan at the end says which
questions still need a phone.

`@mlc-ai/web-llm@0.2.85` (2026-09-08) is the current npm release and
`web/browser.html` already pins it. Everything below is reachable without a
version bump.

---

## The three numbers that are not the same

`web/browser.html` uses one number — WebLLM's `vram_required_MB` — for three
different jobs. They are not interchangeable.

| Number | What it governs | Where it comes from |
|---|---|---|
| **Download** | mobile data, browser storage quota, first-load wait | sum of the repo's files, + ~5.6 MB for the compiled WebGPU shader library |
| **GPU allocation** | whether the tab gets killed | measured — see below |
| **`vram_required_MB`** | *nothing in WebLLM* | a hand-recorded figure in the prebuilt config |

That third row is the first finding. **`vram_required_MB` is never read by
WebLLM's code.** Grepping the 0.2.85 bundle for a property access on it returns
zero hits; it appears only as data inside the 163 prebuilt records. It is
advisory metadata for application authors — which is a legitimate use, and is
how this page uses it — but it is not what the runtime allocates, and on one
model it is out by 43%.

Download size and `vram_required_MB` diverge by up to 4×:

| Model (q4f16_1) | Download | `vram_required_MB` |
|---|---:|---:|
| SmolLM2-360M | 207 MB | 376 MB |
| Qwen2.5-0.5B | 290 MB | 945 MB |
| Qwen3-0.6B | 352 MB | 1403 MB |
| Qwen3.5-0.8B | 447 MB | 1629 MB |
| gemma3-1b-it | 602 MB | 711 MB |
| Llama-3.2-1B | 705 MB | 879 MB |

So the page's storage warning is wrong: it compares
`navigator.storage.estimate().quota` against `vram_required_MB`. For
Qwen3-0.6B that overstates the disk requirement by a gigabyte.

---

## What the runtime actually allocates — measured

This was expected to need a phone. It did not. **Chromium in this sandbox
serves WebGPU through SwiftShader with `--enable-unsafe-webgpu`** — no hardware
GPU, but a real adapter, a real device, and real buffer allocation. That
contradicts the standing assumption in `CLAUDE.md` that nothing was verifiable
in-session, and it is worth knowing: models *load*, so anything measurable at
load time is measurable here.

Method: patch `GPUDevice.prototype.createBuffer` to accumulate every requested
byte, wrap `destroy()` to subtract, then load each model from a local mirror
with `context_window_size` overridden through `CreateMLCEngine`'s third
argument. The harness is in `scripts/vram-probe/`.

SwiftShader exposes no `shader-f16`, so these runs are the **q4f32** builds.

| Model (q4f32_1) | ctx 4096 | 2048 | 1024 | 512 | `vram_required_MB` |
|---|---:|---:|---:|---:|---:|
| SmolLM2-360M | **574.4** | 406.6 | 322.7 | 280.8 | 580 |
| Qwen3-0.6B | **1341.8** | 872.0 | 637.2 | — | 1925 |
| Llama-3.2-1B | **1063.9** | 929.7 | 862.6 | — | 1129 |

Allocation is exactly linear in context length, and the slope is exactly the
KV cache arithmetic:

```
allocation = params + (2 × layers × kv_heads × head_dim × dtype_bytes) × ctx + overhead
```

Every term is now pinned down. `params` comes from the `_metadata` blob
embedded in the compiled wasm, which lists every tensor's shape and dtype.
The KV dtype **follows the build suffix** — f32 in a `q4f32` build, f16 in a
`q4f16` one — which is why the measured slope for SmolLM2 is 80 KiB/token
against the 40 KiB/token its q4f16 build will use. `overhead` measured 12.6,
22.9 and 29.5 MB across the three models.

The formula was then used to **predict Llama-3.2-1B before measuring it**:
predicted 1054–1071 MB at 4096, 919–937 at 2048, 852–870 at 1024. Measured
1063.9, 929.7, 862.6. All three inside the band.

### So where does the gap go

Nowhere. It is not allocated.

The gap measures 583 MB on Qwen3-0.6B's q4f32 build (1925 published against
1342 measured). Here is what it is.

The wasm metadata also carries a `memory_usage` map — the planned workspace for
each VM function. For Qwen3-0.6B:

| VM function | workspace | bound by WebLLM? |
|---|---:|---|
| `batch_verify` | **706 MB** | **no** |
| `batch_prefill` | 162 MB | yes |
| `batch_decode` | 83 MB | yes |
| `prefill` | 45 MB | yes |
| everything else | <3 MB | yes |

`batch_verify` is the speculative-decoding entry point. The string
`batch_verify` **does not appear anywhere in WebLLM 0.2.85** — it is not in the
function-registry list the pipeline loads, so it is never looked up, never
called, and its workspace is never allocated. It is the single largest term in
MLC's compile-time estimate for the Qwen models, and it is dead weight in a
browser.

That is the whole discrepancy. Where a model has no oversized `batch_verify`
plan, the published figure is accurate: SmolLM2-360M is out by 1% and
Llama-3.2-1B by 6%. Qwen3-0.6B, whose `batch_verify` plan is 706 MB, is out by
43%.

### What this means for phones

Applying the validated formula to the **q4f16** builds — the ones a phone with
`shader-f16` actually gets — with the measured 23 MB overhead:

| Model (q4f16_1) | params | KV/token | @4096 | @2048 | @1024 | published |
|---|---:|---:|---:|---:|---:|---:|
| SmolLM2-360M | 204 MB | 40 KiB | 394 | 311 | **269** | 376 |
| Qwen2.5-0.5B | 278 MB | 12 KiB | 351 | 326 | **314** | 945 |
| Qwen3-0.6B | 335 MB | 112 KiB | 828 | 593 | **476** | 1403 |
| Qwen3.5-0.8B | 424 MB | 12 KiB | 497 | 472 | **460** | 1629 |
| gemma3-1b-it † | 563 MB | 26 KiB | 599 | 599 | **599** | 711 |
| Llama-3.2-1B | 695 MB | 32 KiB | 852 | 785 | **752** | 879 |

† gemma3 is flat across contexts because its KV cache is pinned to a 512-token
sliding window — and that same setting is why it cannot currently load at all.
See the gotchas below.

The question that opened this work — *does a 1024-token Qwen3-0.6B fit a
phone?* — has an answer: **it needs about 476 MB, comfortably inside the page's
630 MB safe budget, and about 828 MB even at the full 4096 context.** It was
excluded on a figure that was three times the truth.

`Qwen2.5-0.5B` and `Qwen3.5-0.8B` are cheaper still and barely move with
context, for different reasons: Qwen2.5-0.5B keeps only 2 KV heads at head_dim
64, while Qwen3.5-0.8B is a hybrid model where 18 of 24 layers have no KV cache
at all.

**One caveat, stated plainly.** These are load-time allocations. `batch_prefill`
and `batch_decode` are bound and will allocate their workspace on first
inference, and that did not happen here: **generation never completed under
SwiftShader**, at any prompt length, including a single token with a 25-minute
timeout. Loading works; running does not. So the numbers above are a floor, and
the ceiling is that floor plus the bound-function workspace — small for
SmolLM2 (42 MB) and Llama (92 MB), but 162 MB for Qwen3-0.6B and 410 MB for
Qwen3.5-0.8B, whose `batch_decode` plan is unusually large. Measuring the
steady state still needs real hardware.

## The candidates

Everything WebLLM ships at ≤1.8 GB reservation, minus duplicates and the
obviously obsolete. **No accuracy claim is made about any of these** — the only
models this project has actually measured are the ones already in
`docs/customising.md`.

### Tier A — fits the current 900 MB phone budget as shipped

| Model | Download | Reserve | Licence | Note |
|---|---:|---:|---|---|
| `SmolLM2-360M-Instruct-q4f16_1` | 207 MB | 376 MB | Apache-2.0 | shipped; the measured baseline |
| `SmolLM2-135M-Instruct-q0f16` | 273 MB | 360 MB | Apache-2.0 | **not quantized** — see below |
| `SmolLM2-360M-Instruct-q4f32_1` | 207 MB | 580 MB | Apache-2.0 | shipped; no-fp16 fallback; **measured 574 MB** |
| `gemma3-1b-it-q4f16_1` | 602 MB | 711 MB | **Gemma licence** | shipped, **and cannot load** — see gotchas |

**SmolLM2-135M-q0f16 is the most interesting model in this whole list**, and
not because it is good. It is the only sub-400 MB entry in WebLLM's catalogue
that is **not 4-bit** — `q0f16` means the weights are unquantized f16. This
project's central finding is that 4-bit wrecks instruction-following and that
sub-1B degrades hardest. A 135M model at full f16 against a 360M model at 4-bit,
on the same tasks, at nearly the same reservation, is a direct test of
capability-versus-damage that as far as I can find nobody has published. It may
well lose. That is still a result.

Also worth recording: `q4f32_1` and `q4f16_1` of SmolLM2-360M download
**byte-identical shards** (207 MB each). The suffix changes activation
precision, not weight storage. Falling back to fp32 on a device without
`shader-f16` costs GPU memory (376 → 580 MB), not bandwidth.

### Tier B — fits a phone only with a reduced context window

| Model | Download | Reserve @ shipped ctx | Licence | Note |
|---|---:|---:|---|---|
| `Qwen2.5-0.5B-Instruct-q4f16_1` | 290 MB | 945 MB | Apache-2.0 | cheapest cache in the list (12 KiB/token) |
| `Qwen3-0.6B-q4f16_1` | 352 MB | 1403 MB | Apache-2.0 | matches the pinned Ollama model; really needs ~476 MB at 1024 ctx |
| `Qwen3.5-0.8B-q4f16_1` | 447 MB | 1629 MB | Apache-2.0 | **new**; hybrid attention — only 6 of 24 layers hold a KV cache |
| `Llama-3.2-1B-Instruct-q4f16_1` | 705 MB | 879 MB | Llama 3.2 Community | shipped; measured at 4/10 on journal sentiment, better at extraction |
| `OLMo-2-0425-1B-Instruct-q4f16_1` | 845 MB | 1777 MB | Apache-2.0 | **new**; fully open model — data and training code published |
| `TinyLlama-1.1B-Chat-v1.0-q4f16_1` | 621 MB | 697 MB | Apache-2.0 | 2023-vintage; included only as a floor to measure against |

**Tier B is now misnamed.** On the measured formula, `Qwen2.5-0.5B` needs about
314 MB at 1024 tokens and `Qwen3.5-0.8B` about 460 MB — both are Tier A models
hiding behind an inflated published figure, and `Qwen3-0.6B` clears the budget
even at full context. The tiering in this document is kept as WebLLM's catalogue
presents it; Stage 2 should re-tier on the measured numbers.

### Tier C — flagship phone or desktop

`SmolLM2-1.7B-Instruct-q4f16_1` (966 MB / 1774 MB),
`Qwen2.5-1.5B-Instruct-q4f16_1` (880 MB / 1630 MB),
`Qwen3-1.7B-q4f16_1` (984 MB / 2037 MB, already shipped),
`Qwen3.5-2B-q4f16_1` (1083 MB / 2245 MB),
`gemma-2-2b-it-q4f16_1` (1895 MB reservation).

### Tier D — embeddings, for Phase 3

| Model | Download | Reserve |
|---|---:|---:|
| `snowflake-arctic-embed-s-q0f32-MLC-b4` | 67 MB | 239 MB |
| `snowflake-arctic-embed-m-q0f32-MLC-b4` | 219 MB | 539 MB |

The `-b4` and `-b32` suffixes are batch sizes; `-b4` reserves a quarter of what
`-b32` does and is the phone-appropriate one.

This answers a question the roadmap raises and nobody has published a number
for: **can a phone hold an embedding model and a chat model at once?**
On arithmetic, yes — `arctic-embed-s-b4` (239 MB) plus SmolLM2-360M (376 MB) is
615 MB against a 900 MB budget, for 274 MB of download. Whether both engines
can be resident simultaneously in one tab is a WebLLM runtime question this
research did not settle, and is the first thing Stage 5 has to test.

### Deliberately excluded

- **`Qwen2.5-Math`, `Qwen2.5-Coder`, `phi-1_5`, `phi-2`, `stablelm-2-zephyr`,
  `RedPajama-3B`** — either narrow-domain or superseded; they would pad the
  dropdown without teaching anything.
- **Anything not in `mlc-ai`'s Hugging Face org.** LFM2, Gemma 3 270M and the
  other 2025–26 mobile-first releases have no MLC conversion and no compiled
  WebGPU shader library, and WebLLM needs both. Adding one means running the
  MLC compiler and hosting the artefacts — a project, not a config change, and
  out of scope here.

---

## Gotchas found in this pass

**`gemma3-1b-it-q4f16_1-MLC` cannot load at all.** WebLLM merges the model's
`mlc-chat-config.json` with `ModelRecord.overrides` and then the caller's
`chatOpts` by plain object spread. Gemma 3's config sets
`sliding_window_size: 512`; the prebuilt record overrides
`context_window_size: 4096` and leaves the sliding window alone. The pipeline
constructor throws `WindowSizeConfigurationError` when both are positive —
"Only one of context_window_size and sliding_window_size can be positive."
**Confirmed by running it**, not just by reading the code: loading gemma3
through WebLLM 0.2.85 raises

```
WindowSizeConfigurationError: Only one of context_window_size and
sliding_window_size can be positive. Got: context_window_size: 4096,
sliding_window_size: 512
```

Passing `{ sliding_window_size: -1 }` clears that error; the load then fails on
the f16 shader, which is this sandbox's limitation rather than the model's — a
control run of SmolLM2-360M-q4f16, the page's own default, fails identically
here. The seven Mistral records in the prebuilt config avoid the window
conflict by explicitly overriding `sliding_window_size: -1`; gemma3's does
not.

**This model is in the shipped dropdown of `web/browser.html`.** Anyone who
selects it gets a failed load. The fix is one line of `chatOpts` —
`{ sliding_window_size: -1 }` — which is exactly the Stage 1 mechanism, and it
is a reason to bring Stage 1 forward rather than a reason to wait.

**Correction: `max_history_size` is not a chat-history limit.** An earlier draft
of this document read Qwen3.5's `max_history_size: 1` as "only the last turn
survives". That is wrong. In the 0.2.85 bundle `maxHistorySize` is referenced in
exactly four places, and the only one that consumes it passes it to
`create_rnn_state`. It sizes recurrent state, not conversation history.

The reason it is set on Qwen3.5 and nothing else is visible in the compiled
metadata: **Qwen3.5 is a hybrid attention model.** Its `kv_state_kind` is
`"hybrid"`, its KV-cache block covers only **6 of 24 layers**, and the remaining
18 are linear-attention layers carrying `conv1d`, `in_proj`, `A_log` and
`dt_bias` tensors. WebLLM's own comment says it: "Hybrid/recurrent models can
over-allocate RNN state if we use context window directly." Multi-turn chat is
unaffected.

That hybrid structure is also why Qwen3.5-0.8B costs only 12 KiB/token of KV
cache despite being the largest model in Tier B — five sixths of its layers
have no KV cache at all.

**Qwen3.5 is a vision model upstream and a text model here.** `Qwen/Qwen3.5-0.8B`
is tagged `image-text-to-text` with a chat template that handles images and
video. WebLLM's converted records carry no vision `model_config`, so the builds
are text-only. Do not repeat the upstream description.

**Qwen3.5 reasons.** Its chat template supports `enable_thinking`, same as
Qwen3. The existing `<think>`-tag handling in `browser.html` should cover it,
but the prefilled-opening-tag behaviour already documented in `CLAUDE.md` needs
re-checking per family rather than assumed.

**`required_features` cannot be trusted as the fp16 filter.** Only 29 of the
163 prebuilt records declare it; 54 models with `f16` in their id do not —
including `gemma3-1b-it-q4f16_1`, `Qwen3-0.6B-q4f16_1` and every Qwen3.5 build.
The page's `/q4f16|q0f16/` regex is the *more* correct filter and should stay.
It does need widening to `/q4f16|q0f16|q4bf16|q0bf16/` before any bf16 build is
added, and it should union with `required_features` rather than replace it, so
a future non-fp16 requirement is not missed.

---

## The plan

Ordered so each stage ships something true on its own, and so the correctness
fixes land before the feature. Stages 0–2 are code; 3–5 are measurement, which
is the part this project is actually for.

### Stage 0 — separate the three numbers *(no new models)*

A bug fix, shippable alone.

1. Add a `DOWNLOAD_MB` field per entry in `MODELS`, from the table above.
   WebLLM does not publish download size, so it has to be recorded by hand;
   note the Hugging Face API call that produced each figure so it can be
   re-derived.
2. Point the `navigator.storage.estimate()` check at `DOWNLOAD_MB`, not
   `vram_required_MB`.
3. Split the meta panel into **"Download: N MB"** and **"GPU memory: ~N MB"**.
   Right now it says "Memory needed" and shows the reservation, which is the
   number a visitor is least able to act on.
4. Widen the fp16 regex to include `bf16`, and union it with
   `required_features` instead of relying on either alone.

*Verifiable here:* the arithmetic and the filter logic. *Not verifiable here:*
nothing — this stage needs no GPU.

### Stage 1 — the context-window ladder

No longer blocked, and now the highest-value stage. `CreateMLCEngine(id,
engineConfig, chatOpts)` takes a third argument; `ChatOptions extends
Partial<ChatConfig>`, which includes `context_window_size` and
`sliding_window_size`. The page currently passes nothing.

1. Give each entry a `ctxLadder`, e.g. `[4096, 2048, 1024]`, and budget with
   the measured formula — `params + kvPerToken × ctx + 23 MB` — rather than
   `vram_required_MB`. Both `params` and `kvPerToken` are fixed per model and
   can be recorded in the table alongside download size.
2. On mobile, pick the largest rung that clears the budget with the existing
   0.7 headroom.
3. Pass `{ sliding_window_size: -1 }` for `gemma3-1b-it`, which fixes a model
   that cannot currently load at all.
4. Show the chosen context in the UI. A reduced window that is invisible is the
   stuck-preset bug again: the page looks broken while behaving as configured.
5. Keep the existing refusal path. A wrong guess still kills the tab with no
   catchable error.

Budget against the **ceiling**, not the measured floor: add the largest
bound-function workspace from the model's wasm metadata (42 MB for SmolLM2,
92 MB for Llama-3.2-1B, 162 MB for Qwen3-0.6B, 410 MB for Qwen3.5-0.8B) until
Stage 3 measures the steady state on hardware. That is still far below
`vram_required_MB` for every Qwen model.

### Stage 2 — add the models, tiered

Restructure `MODELS` from a flat array into tiers with per-model metadata:
download size, KV cost per token, licence, and a `warn` string where one is
genuinely needed. Group the dropdown by tier so the ladder is legible rather
than implied by ordering.

Order of addition, cheapest risk first:

1. `SmolLM2-135M-q0f16` — Tier A, fits today, and it is the f16-versus-4-bit
   experiment.
2. `Qwen2.5-0.5B-q4f16_1` — best Tier B odds on arithmetic.
3. `OLMo-2-1B-q4f16_1` — desktop initially; fully-open weights make it the
   honest comparison point.
4. `SmolLM2-1.7B` and `Qwen2.5-1.5B` — desktop tier.
5. `Qwen3.5-0.8B` — **last**. It is cheap on paper (460 MB at 1024 context) but
   its `batch_decode` workspace is 410 MB, by far the largest of any candidate,
   and that allocates on first inference. Do not put it on phones until Stage 3
   has measured the steady state.

Add the fp32 sibling wherever one exists, now that it is known to cost no extra
download.

### Stage 3 — measure the steady state on real hardware

The residual is resolved; what is left needs a device that can actually run a
forward pass. Two questions:

1. **How much does the first inference add?** `batch_prefill` and
   `batch_decode` allocate their workspace on first use, and that never
   happened here. Re-run `scripts/vram-probe/` on a real GPU, generate, and
   record the delta. If it is small, the phone budget can be raised
   substantially.
2. **Where does each device actually fall over?** The published figure is not
   the ceiling and neither is the measured floor; the tab-killing threshold is
   a property of the device.

WebLLM's `usage.extra` already reports `prefill_tokens_per_s`,
`decode_tokens_per_s`, `time_to_first_token_s` and `e2e_latency_s` on every
completion, so the tokens/sec half of roadmap Phase 2 is plumbing on top of the
same harness.

Every previous bug in this project was found by the user on real hardware.
SwiftShader extends what is checkable in-session — it caught a model that
cannot load — but it cannot generate a token, so it does not replace a phone.

### Stage 4 — the capability question

Roadmap Phase 4, scoped to one comparison worth publishing: **SmolLM2-135M at
f16 against SmolLM2-360M at 4-bit**, on the tasks already measured in
`docs/customising.md` — journal sentiment, binary review sentiment, date
extraction, three-way sentiment.

The existing table gives a baseline to compare against, and the finding it
tests is this project's own. Publish the result either way; a 135M model
beating a 360M one because it was not quantized is a better post than a
dropdown with six new entries.

### Stage 5 — embeddings on the same device

Roadmap Phase 3's feasibility gate. Load `arctic-embed-s-b4` and SmolLM2-360M
in one tab and find out whether both engines can be resident at once, then
whether 615 MB of combined reservation survives on a mid-range Android. If it
does, browser RAG on a phone is real and this is the number to publish. If it
does not, that is the more useful post.

---

## What was and was not tested

**Measured here**, on Chromium 141 + SwiftShader, WebLLM 0.2.85, by counting
`GPUDevice.createBuffer` bytes:

- Load-time GPU allocation for SmolLM2-360M, Qwen3-0.6B and Llama-3.2-1B
  (q4f32 builds), across contexts 4096 / 2048 / 1024 / 512.
- That `context_window_size` passed through `chatOpts` changes the allocation,
  linearly and by exactly the KV arithmetic.
- That `gemma3-1b-it-q4f16_1-MLC` hits `WindowSizeConfigurationError` — traced
  through the merge code and simulated against the real config files, not
  executed.

**Not tested, and needing real hardware:**

- **No model generated a single token.** Generation never completed under
  SwiftShader at any prompt length, so throughput is unmeasured and every claim
  about output quality remains untested.
- **Steady-state allocation.** The figures are load-time floors; bound-function
  workspace is not included. Budget against the ceiling until Stage 3.
- **q4f16 allocation.** SwiftShader exposes no `shader-f16`, so the f16 numbers
  are predictions from a formula validated on q4f32 builds — accurate to within
  2% where a published figure exists to check against, but predictions.
- **The device ceiling.** Where a given phone kills the tab is a property of
  the phone.
- **Download sizes are Hugging Face file listings**, not observed transfers.
  They exclude the ~5.6 MB shader library and any compression on the wire.
- **Whether two WebLLM engines can be resident in one tab.**
