# Fresh data for small models — a plan

The models this page ships are between seventeen and twenty-four months old and
cannot be retrained: the lab's machine is CPU-only and fine-tuning is on the
roadmap's *do not build* list. So there is exactly one lever left for making
them smarter, and it is **what goes into the context window**.

This document is the plan for pulling that lever. It is deliberately as much
about measuring the damage as about adding the data, because on this project's
own evidence a 4-bit sub-1B model handed a long prompt and a question with a
correct answer is the **worst-case shape**: confident, well-formed, wrong.

---

## How stale, exactly

Upload dates from the Hugging Face model API, checked 2026-09-20. Weights
cannot contain anything after the date they were uploaded, and in practice the
training data ends some months earlier than that.

| Model on the page | Uploaded | Age today |
|---|---|---:|
| Qwen2.5-0.5B-Instruct | 2024-09-16 | 24 months |
| Llama-3.2-1B-Instruct | 2024-09-18 | 24 months |
| SmolLM2-360M-Instruct | 2024-10-31 | 23 months |
| Qwen3-0.6B | 2025-04-27 | 17 months |
| OLMo-2-0425-1B-Instruct | 2025-04-29 | 17 months |

There is a smaller and more embarrassing gap underneath that one: **the page
never tells the model what day it is.** Ask any of them for today's date and
the answer comes from training data. That costs one line to fix and is Stage 0
below.

---

## What "smarter" can and cannot mean here

Three different complaints get filed under "the model is dumb", and only one of
them is fixable with data:

| Complaint | Fixable with fresh data? |
|---|---|
| "It doesn't know about X" — staleness, missing facts | **Yes.** This is retrieval's whole job. |
| "It doesn't know about *me*" — my notes, my documents | **Yes**, and this is the private version, which is the better product. |
| "It reasons badly / can't follow a format" | **No.** That is quantization and parameter count. Retrieval makes the prompt *longer*, which this project has already measured as the direction that hurts. |

Retrieval therefore buys coverage, not capability. Keeping that distinction
visible in the UI is part of the design, not a caveat at the bottom of a post.

---

## The four walls

### 1. CORS decides the source list, not usefulness

A static GitHub Pages page can only fetch a third-party URL if that server
sends `Access-Control-Allow-Origin`. Nothing else is reachable from the
browser, no matter how good the data is. Measured today with
`Origin: https://richardawe.github.io`:

| Source | ACAO header | Usable |
|---|---|---|
| `en.wikipedia.org/api/rest_v1/…` | echoes origin | ✅ |
| `en.wikipedia.org/w/api.php?…&origin=*` | echoes origin | ✅ |
| `api.open-meteo.com` (weather) | `*` | ✅ |
| `hn.algolia.com/api/v1` (Hacker News) | echoes origin | ✅ |
| `api.frankfurter.dev` (FX rates) | `*` | ✅ |
| `api.github.com` | `*` | ✅ |
| `export.arxiv.org/api/query` | **none** | ❌ needs a proxy |
| `r.jina.ai` (read-any-page proxy) | echoes origin | ❌ **rejected** — see privacy |

That is the honest shape of "live web access from a static page": a short
allowlist of well-behaved APIs, not the web. A general search tool would need a
proxy the lab hosts, which costs money, an ops surface, and the privacy claim
that is the entire product. **The allowlist is the design, not a limitation to
route around.**

### 2. Context is GPU memory, and it is priced per token

Retrieved text is not free. `web/browser.html` already budgets
`params + kvPerTok × ctx + overhead + workspace`, so the marginal cost of a
retrieved passage is a number the page already knows. Per **1,000 tokens** of
prompt (~750 words):

| Model (q4f16) | Cost of 1,000 tokens | Max context on a 900 MB phone |
|---|---:|---:|
| Qwen2.5-0.5B | **12 MB** | 4096 |
| Qwen3.5-0.8B | 12 MB | *(workspace keeps it off phones)* |
| SmolLM2-135M (f16) | 23 MB | 4096 |
| gemma3-1b | 27 MB | *(misses the budget by 44 MB)* |
| Llama-3.2-1B | 33 MB | *(desktop)* |
| SmolLM2-360M | 41 MB | 4096 |
| **Qwen3-0.6B** | **115 MB** | **1024** |
| OLMo-2-1B | 131 MB | *(desktop)* |
| SmolLM2-1.7B | 197 MB | *(desktop)* |

The conclusion is not subtle and is new: **the best phone model for retrieval is
not the newest or the largest, it is the one with the cheapest attention.**
Going from a 1024 to a 4096 context costs 38 MB on Qwen2.5-0.5B and 352 MB on
Qwen3-0.6B. Qwen2.5-0.5B is 24 months stale and downloads 290 MB, and it is the
right default for a page whose job is to read a passage it was just handed.

Turning that into a working budget, reserving ~512 tokens for the system
prompt, the question and the answer:

| Device / model | Tokens for retrieved text | Roughly |
|---|---:|---|
| Phone, Qwen2.5-0.5B or SmolLM2-360M @ 4096 | ~3,580 | six paragraphs of a long article |
| Phone, Qwen3-0.6B @ 1024 | ~512 | one lead section, and nothing else |
| Desktop, any tier-2 model @ 4096 | ~3,580 | same — the ceiling is the rung, not the GPU |

So a phone can hold one document, not a library. That is a real constraint on
what Stage 4's corpus can look like, and it is knowable today without a device.

### 3. Prefill time is the gate nobody has measured

Filling 3,500 tokens of context costs a prefill pass before the first token
appears. **No model has ever generated a token in this sandbox** — SwiftShader
could not complete one in 25 minutes — so the page's throughput on real
hardware is unknown in both directions, and a retrieval feature that adds
thirty seconds of silence to every question is dead regardless of how good the
answer is.

This is a go/no-go gate, not a tuning detail, and it is cheap to settle:
`scripts/vram-probe/` already takes `&gen=1` on a real device. The number to
publish is **prefill tokens/sec against prompt length**, on the phone that
already ran Qwen3-0.6B. Worth checking in the same pass: each MLC config
carries a `prefill_chunk_size`, and whether long prompts are chunked or
processed whole changes both the timing and the peak allocation.

### 4. Grounded question-answering is a correct-answer task

This project's own rule, from `CLAUDE.md`:

> Tasks with a correct answer fail **silently** — confident, well-formed,
> wrong. Only ship tasks without one at this size.

"Answer this question from this passage" has a correct answer. By the existing
rule it should not ship. There is one argument for why it might be the
exception — extraction is copying, not reasoning, and copying is the thing
small models did best in `docs/customising.md` — but that is a hypothesis, and
the mood tagger was a hypothesis too, shipped, wrong, and deleted.

**So the measurement comes before the feature**, and the feature ships only if
the measurement supports it. That is Stage 3, and it is the gate on Stage 4.

---

## The design idea that makes it shippable: answer with the receipt

The failure mode above is *silent*. The fix is not a better model, it is a UI
that cannot fail silently:

- The retrieved passage is shown **next to the answer**, not hidden behind a
  disclosure triangle.
- The source and its timestamp are named — `en.wikipedia.org, fetched 14:02`.
- When the model's answer is not supported by the passage, the reader can see
  that in one glance, because the passage is right there.

That converts a silent wrong answer into a visible wrong answer, which is
exactly the line the project already uses to decide what may ship. It also
makes the honest version of the product clear: **the page is a reader, not an
oracle.** On a 360M model the retrieved passage is often more valuable than the
sentence the model wrote about it, and the layout should admit that.

---

## The ladder

Each stage ships on its own and has a gate. Stages 0–2 need no new model and no
new download.

### Stage 0 — tell the model the date and the device *(hours)*

Prepend to the system prompt, when the user opts in: today's date, the
timezone, and nothing else. No network, no fetch, no privacy question — this is
data the page already has.

Measure first (**M0**): ask each shipped model for today's date and a handful
of post-cutoff facts, before and after. Publish the before-and-after; "the
model thinks it is 2024" is a good post and costs one line to fix.

**Gate:** none. Ship it.

### Stage 1 — bring your own text *(days)*

A paste box and a file drop. The text is chunked, the chunks are scored against
the question with **lexical retrieval in plain JavaScript** (BM25 or simple
term overlap), and the top chunks go in the prompt with the receipt layout
above.

The important choice here is doing this **without embeddings first**. Embeddings
cost 239 MB of GPU reservation and an untested second engine in the tab
(`mobile-models.md`, Stage 5); BM25 over one pasted document costs zero MB and
zero download. For a single document the difference in retrieval quality is
small; for a corpus it is not — which is what Stage 4 is for.

This is Roadmap Phase 3 at its cheapest, it is fully private, and it works
offline.

**Gate:** Stage 3's measurement decides whether the answer pane leads with the
model's sentence or with the retrieved passage.

### Stage 2 — the allowlist *(days)*

The verified CORS-clean sources above, each as an explicit, named, opt-in
lookup — not an autonomous tool-calling loop, which sub-1B models cannot drive
(and which the roadmap rules out). The user picks the source or the page offers
it for an obviously matching question; the request is shown before it is made.

Start with Wikipedia (`/api/rest_v1/page/summary`, ~100 words, one HTTP round
trip, no key) because it is the highest-value and the lowest-risk. Weather and
FX are good demos of "the model literally cannot know this", and cheap.

**Gate:** the privacy rule below, enforced in the UI, not in a footnote.

### Stage 3 — measure what grounding does at 4-bit *(the real work)*

The experiment this whole plan turns on, run on the models in the phone tier
plus one desktop model as a control:

- **M1 — does a passage fix staleness?** Post-cutoff questions, with and
  without the retrieved passage. Expected: yes, dramatically.
- **M2 — does a passage survive the prompt length?** The same question with
  the answer buried at position 1 vs position 10 of the context. Expected:
  degradation, and the point at which it starts is the usable retrieval depth.
- **M3 — the distractor test.** Give the model a *plausible but wrong* passage,
  as a real retrieval miss would. Does it follow the passage, ignore it, or
  blend the two? **This is the finding worth publishing**: if a retrieval miss
  makes a 360M model worse than no retrieval at all, then browser RAG at this
  size needs a confidence floor before it needs a better index.
- **M4 — prefill throughput vs prompt length**, from Wall 3.

Tasks and scoring reuse `docs/customising.md` so the results join the existing
table rather than starting a new one.

**Gate:** M3 decides Stage 4. If grounded answers are reliable, build the
corpus. If they are not, the honest product is a *search-and-show* page where
the model writes one sentence over a passage the reader can check — smaller,
still useful, and a better post.

### Stage 4 — a persistent local corpus *(weeks, gated)*

Only once Stage 3 says grounding works: `arctic-embed-s-b4` (239 MB, 67 MB
download) plus a chat model, chunks and vectors in IndexedDB, re-usable across
sessions. This is where `mobile-models.md` Stage 5 gets settled — **can two
WebLLM engines be resident in one tab?** — and where the 615 MB combined
reservation meets a real mid-range Android.

Note the interaction with Wall 2: an embedder plus Qwen2.5-0.5B at 4096 is
239 + 469 = 708 MB, over the 630 MB safe line for a 900 MB phone but under the
budget itself. The context rung is the knob that makes it fit, and the page
already knows how to choose one.

### Stage 5 — publish the row

Fold the result into the practitioner's capability table (Roadmap Phase 4) as
its own row: *retrieval-augmented generation, by model size and quantization,
on a phone*. Nobody has published that with numbers from a device the reader
owns.

---

## The privacy line

The page's claim is that nothing leaves the device. Stage 2 breaks that claim
the moment it fetches a URL, because **the query is in the URL**. Wikipedia
learns what you searched for; the FX API learns nothing much; a read-any-page
proxy like `r.jina.ai` learns the whole document, which is why it is rejected
here however convenient it is.

The rule, and it is not negotiable:

1. Local sources (Stage 0, Stage 1, Stage 4) are the default and are marked
   **on-device**.
2. Any network lookup is opt-in per question, shows the exact URL before the
   request, and is labelled in the transcript afterwards.
3. The user's document text is **never** sent anywhere — only the question, and
   only to an allowlisted API.
4. No proxy the lab hosts. It would make everything reachable and make the
   privacy claim untrue in the same move.

---

## Do not build

- **An agent loop.** Tool-calling reliability at sub-1B is near zero, and the
  roadmap already rules agents out. The user picks the source; the model reads
  the result.
- **A hosted proxy or a search API key.** See above — and a key in a static
  page is a key given away.
- **Scraping arbitrary pages.** CORS blocks it, HTML parsing is a project of
  its own, and it is the least reliable input for the most fragile consumer.
- **Fine-tuning on fresh data.** Still CPU-only, still out.
- **Pre-baked "knowledge packs" shipped with the page.** They go stale exactly
  like weights do, and they are a download on a device that is already counting
  megabytes.

---

## A contradiction to settle before Stage 1

`web/browser.html` currently does two things that cannot both be right:

- `chatOptsFor()` passes `sliding_window_size: -1` for gemma3, so the model
  loads with its sliding window **disabled**.
- `kvTokensFor()` budgets gemma3's KV cache as `min(ctx, 512)`, i.e. as if the
  window were **still in force**.

If disabling the window makes WebLLM allocate the full context, the page
under-budgets gemma3-1b at 4096 by roughly 95 MB — and an under-budget is the
one error with no catchable failure, because the tab is killed. It does not
affect phones today (gemma3 misses that budget anyway), but retrieval makes
context budgeting load-bearing everywhere, and `scripts/vram-probe/` can settle
it without a GPU in one run: gemma3 at 1024 vs 4096, with the override applied.

---

## What was and was not tested

**Checked while writing this**, in this sandbox:

- The CORS table — real requests with a `richardawe.github.io` origin, reading
  the response headers. Wikipedia rate-limited the sandbox (HTTP 429) but sent
  the ACAO header with it, which is the thing being tested.
- The staleness table — Hugging Face model API upload dates.
- Every memory figure — computed from the `MODELS` table already in
  `web/browser.html`, i.e. from the measured formula, not from
  `vram_required_MB`.

**Not tested, and load-bearing:**

- **No model has answered a single question with a passage in context**, here
  or anywhere in this project. Every expectation in Stage 3 is a hypothesis.
- **Prefill throughput at any prompt length**, on any real device.
- **Whether an embedder and a chat model can be resident in one tab.**
- **Whether BM25 over pasted text retrieves well enough** to be worth shipping
  without embeddings.
- Sources on the allowlist were checked for CORS, not for rate limits under
  real traffic. Wikipedia's 429 in this sandbox is a hint that a popular page
  would need its own user-agent policy and caching.
