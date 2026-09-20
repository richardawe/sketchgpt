# More models for phones — what is available, and how to add it

Research pass over WebLLM's shipped catalogue, done against primary sources:
the `prebuiltAppConfig` inside `@mlc-ai/web-llm@0.2.85`, each model's
`mlc-chat-config.json` on Hugging Face, and the Hugging Face file-size API.

**Nothing here was run on a GPU.** This sandbox has none, so every size and
architecture number below is read from a config or a file listing, and every
claim about *whether a model is any good* is explicitly marked as untested.
The point of the plan at the end is to turn these numbers into measurements on
real phones.

`@mlc-ai/web-llm@0.2.85` (2026-09-08) is the current npm release and
`web/browser.html` already pins it. Everything below is reachable without a
version bump.

---

## The three numbers that are not the same

`web/browser.html` uses one number — WebLLM's `vram_required_MB` — for three
different jobs. They are not interchangeable, and the gap between them is where
all the headroom is hiding.

| Number | What it governs | Where it comes from |
|---|---|---|
| **Download** | mobile data, browser storage quota, first-load wait | sum of the repo's files, + ~5.6 MB for the compiled WebGPU shader library |
| **GPU reservation** | whether the tab gets killed | `vram_required_MB` in the prebuilt config |
| **KV cache** | how much of the reservation scales with context length | arithmetic on the model's own config |

They diverge by up to **4×**:

| Model (q4f16_1) | Download | `vram_required_MB` | Ratio |
|---|---:|---:|---:|
| SmolLM2-360M | 207 MB | 376 MB | 1.8× |
| Qwen2.5-0.5B | 290 MB | 945 MB | 3.3× |
| Qwen3-0.6B | 352 MB | 1403 MB | **4.0×** |
| Qwen3.5-0.8B | 447 MB | 1629 MB | 3.6× |
| gemma3-1b-it | 602 MB | 711 MB | **1.2×** |
| Llama-3.2-1B | 705 MB | 879 MB | 1.2× |
| TinyLlama-1.1B | 621 MB | 697 MB | 1.1× |
| OLMo-2-1B | 845 MB | 1777 MB | 2.1× |
| Qwen3-1.7B | 984 MB | 2037 MB | 2.1× |

Two consequences, both actionable:

**The page's storage warning is wrong.** It compares `navigator.storage.estimate().quota`
against `vram_required_MB`. For Qwen3-0.6B that overstates the disk requirement
by 1 GB and will tell people they have too little space when they have four
times what they need.

**Qwen3-0.6B is excluded from phones for the wrong reason.** It downloads
352 MB — under the page's 900 MB mobile budget with room to spare — but
reserves 1403 MB and so never appears. The reservation, not the model, is what
does not fit.

### Where the reservation goes

KV cache bytes per token = `2 × layers × kv_heads × head_dim × 2` (f16).
Every figure below is arithmetic on values read from each model's
`mlc-chat-config.json`:

| Model | KiB/token | KV @4096 | @2048 | @1024 |
|---|---:|---:|---:|---:|
| Qwen2.5-0.5B | 12 | 50 MB | 25 MB | 13 MB |
| SmolLM2-135M | 22 | 94 MB | 47 MB | 24 MB |
| TinyLlama-1.1B | 22 | 92 MB | 46 MB | 23 MB |
| gemma3-1b-it | 26 | **28 MB** | 20 MB | 16 MB |
| Llama-3.2-1B | 32 | 134 MB | 67 MB | 34 MB |
| SmolLM2-360M | 40 | 168 MB | 84 MB | 42 MB |
| Qwen3.5-0.8B | 48 | 201 MB | 101 MB | 50 MB |
| Qwen3-0.6B / 1.7B | 112 | 470 MB | 235 MB | 117 MB |
| OLMo-2-1B | 128 | 537 MB | 268 MB | 134 MB |
| SmolLM2-1.7B | 192 | 805 MB | 403 MB | 201 MB |

**Attention shape beats parameter count.** SmolLM2-1.7B keeps 32 KV heads
(no grouping at all) and spends 805 MB on cache at 4096 tokens — more than its
966 MB of weights. Qwen2.5-0.5B has 2 KV heads at head_dim 64 and spends 50 MB.
Qwen3-0.6B, a *smaller* model, costs more than twice per token what the 1B
Llama does, because it carries 8 KV heads at head_dim 128 across 28 layers.

**Gemma 3 1B is the outlier, and the reason is structural.** Its config sets
`sliding_window_size: 512` with `sliding_window_pattern: 6` — five local layers
for every global one — so most of its cache is pinned at 512 tokens regardless
of context length. Its KV cost barely moves between 1024 and 4096 tokens. If a
long context on a phone is ever the requirement, this architecture is the
answer, not a smaller model.

Two honest caveats. The KV arithmetic explains the whole gap for SmolLM2-360M
(207 MB weights + 168 MB cache ≈ the stated 376 MB) but leaves roughly 900 MB
unexplained for both Qwen3-0.6B and Qwen3.5-0.8B. WebLLM publishes
`vram_required_MB` as a single figure and does not decompose it, so what that
residual is — and whether it shrinks with context — **is a measurement, not a
calculation**. And whether MLC's runtime implements Gemma 3's 5:1 hybrid cache
or applies the window uniformly changes the gemma3 number slightly; both
readings land between 14 and 28 MB, so the conclusion survives either way.

---

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
| `SmolLM2-360M-Instruct-q4f32_1` | 207 MB | 580 MB | Apache-2.0 | shipped; no-fp16 fallback |
| `gemma3-1b-it-q4f16_1` | 602 MB | 711 MB | **Gemma licence** | shipped; clears the budget but not the 0.7 headroom |

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
| `Qwen3-0.6B-q4f16_1` | 352 MB | 1403 MB | Apache-2.0 | matches the pinned Ollama model; desktop-only today |
| `Qwen3.5-0.8B-q4f16_1` | 447 MB | 1629 MB | Apache-2.0 | **new**; see the warnings below |
| `Llama-3.2-1B-Instruct-q4f16_1` | 705 MB | 879 MB | Llama 3.2 Community | shipped; measured at 4/10 on journal sentiment, better at extraction |
| `OLMo-2-0425-1B-Instruct-q4f16_1` | 845 MB | 1777 MB | Apache-2.0 | **new**; fully open model — data and training code published |
| `TinyLlama-1.1B-Chat-v1.0-q4f16_1` | 621 MB | 697 MB | Apache-2.0 | 2023-vintage; included only as a floor to measure against |

`Qwen2.5-0.5B` is the strongest Tier B candidate on arithmetic alone: 290 MB
down, and at 1024 tokens its cache is 13 MB. Whatever the unexplained residual
turns out to be, this is the model most likely to drop under a phone budget.

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

## New gotchas found in this pass

Four things that will cost time if the page grows a model list without them.

**Qwen3.5 forgets everything but your last message.** Every Qwen3.5 build in
the prebuilt config carries `overrides.max_history_size: 1`. Nine models, no
exceptions, and no other family in the catalogue sets it. Drop one into the
dropdown and multi-turn chat silently stops working — which is exactly the
shape of failure this project keeps getting caught by. Either surface it in the
UI or leave the family out.

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

The unlock. `CreateMLCEngine(id, engineConfig, chatOpts)` takes a third
argument; `ChatOptions extends Partial<ChatConfig>`, which includes
`context_window_size`. The page currently passes nothing, so every model loads
at its `overrides.context_window_size` of 4096.

1. Give each entry a `ctxLadder`, e.g. `[4096, 2048, 1024]`.
2. On mobile, pick the largest rung whose **weights + computed KV + measured
   residual** clears the budget with the existing 0.7 headroom.
3. Show the chosen context in the UI. A reduced window that is invisible is the
   stuck-preset bug again: the page looks broken while behaving as configured.
4. Keep the existing refusal path. A wrong guess here kills the tab with no
   catchable error, so the ladder must only ever move *downward* from what the
   current code already allows.

**This stage cannot ship on arithmetic.** The ~900 MB residual on the Qwen
models is unexplained, so whether a 1024-token Qwen3-0.6B fits a phone is
unknown until Stage 3 measures it. Build the mechanism here; leave the mobile
budget untouched until there are numbers.

### Stage 2 — add the models, tiered

Restructure `MODELS` from a flat array into tiers with per-model metadata:
download size, KV cost per token, licence, and a `warn` string for things like
Qwen3.5's `max_history_size: 1`. Group the dropdown by tier so the ladder is
legible rather than implied by ordering.

Order of addition, cheapest risk first:

1. `SmolLM2-135M-q0f16` — Tier A, fits today, and it is the f16-versus-4-bit
   experiment.
2. `Qwen2.5-0.5B-q4f16_1` — best Tier B odds on arithmetic.
3. `OLMo-2-1B-q4f16_1` — desktop initially; fully-open weights make it the
   honest comparison point.
4. `SmolLM2-1.7B` and `Qwen2.5-1.5B` — desktop tier.
5. `Qwen3.5-0.8B` — **last**, and only with the history warning visible.

Add the fp32 sibling wherever one exists, now that it is known to cost no extra
download.

### Stage 3 — measure the residual on real hardware

This is roadmap Phase 2 with a concrete first question.

WebLLM's `usage.extra` already reports `prefill_tokens_per_s`,
`decode_tokens_per_s`, `time_to_first_token_s` and `e2e_latency_s` on every
completion, so the harness is mostly plumbing.

For each model × context rung, on each real device: does it load, what does
`performance.measureUserAgentSpecificMemory()` say where available, what is the
decode rate, and at what point does the tab die. The output is the mapping from
`vram_required_MB` at 4096 to actual cost at 1024 — the number that makes
Stage 1's budget arithmetic real instead of provisional.

Every previous bug in this project was found by the user on real hardware, not
by testing here. Emulation will not substitute for a phone. The device matrix
is the deliverable.

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

## What was not tested

No GPU exists in the environment this was researched in. Concretely:

- **No model below was loaded, and none was run.** Every quality claim is
  marked untested for that reason.
- **The KV arithmetic is unverified against a real allocation.** It is correct
  arithmetic on published config values; whether MLC allocates exactly that is
  a separate question.
- **The ~900 MB residual on the Qwen models is unexplained.** Do not build a
  mobile budget on a guess about it.
- **Download sizes are Hugging Face file listings**, not observed transfers.
  They exclude the ~5.6 MB shader library and any compression on the wire.
- **Whether two WebLLM engines can be resident in one tab is unknown.**
