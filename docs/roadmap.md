# Roadmap — a one-person AI lab, six months, in public

## Thesis

The research on small models exists and is good. It is also unusable by
builders: measured on GSM8K and HumanEval, published as PDFs, and silent on
whether *your* phone can run *your* task.

**Every project here is a page someone opens on their own device that answers a
question about their own situation.** No lab and no paper competes on that.

### What is and is not new

Checked, so the claims survive contact:

- **In-browser LLMs are not new.** [WebLLM](https://github.com/mlc-ai/web-llm)
  has shipped since May 2023 and runs its own demo at
  [chat.webllm.ai](https://chat.webllm.ai). Chrome ships Gemini Nano natively.
- **Speed benchmarks are not new** — plenty exist, scattered across blogs, plus
  [an arXiv paper on WebGPU dispatch overhead](https://arxiv.org/html/2604.02344v1).
- **Quantization effects are not new** —
  [on-device evaluations](https://arxiv.org/pdf/2505.15030),
  [quantization vs task difficulty and size](https://arxiv.org/html/2409.11055v5),
  [evaluating quantized LLMs](https://arxiv.org/pdf/2402.18158). The literature
  already says instruction-following is among the most damaged capabilities and
  that sub-1B models degrade hardest at 4-bit.

What is missing is the **translation**: none of it is runnable by a builder on
the device in their hand. That gap is the lab's territory.

---

---

## Where things actually stand

Reviewed against what is built, not against what was planned.

| Phase | Status | The honest version |
|---|---|---|
| 1 Foundation | **shipped** | Template, Pages deploy, device-aware model picking. Plus offline that now genuinely works — `web/sw.js`, checked by `tests/offline.mjs` with the network cut. |
| 2 Sketch mode | **shipped** | Reassigned: sketch mode *is* Phase 2. It is the thing people open, and it demonstrates on the visitor's own hardware what their device can do. The device-matrix half — **no visitor leaves a datapoint, there is no public matrix** — is still unwritten and is what remains of the original Phase 2. |
| 3 Work mode | **planned, researched, gated** | RAG with a purpose: read a document on your own device. The naive version does not survive measurement — see [`work-mode.md`](work-mode.md). Blocked on one untested question: can two WebLLM engines share a tab? |
| 4 Capability table | **advanced by accident** | Sketch mode produced eight new measured rows (see `CLAUDE.md` and `customising.md`) and, more usefully, **`scripts/sketch-bench.mjs` is a working practitioner eval harness**: real prompt, real models, judged by the real parser, on any Ollama tag. That is the Phase 4 machinery, built as a side effect. |
| 5 One vertical | **not started** | One input though: "field work without signal" is the row where offline is the requirement, and offline is now real rather than claimed. |
| 6 Body of work | **accumulating** | Four measurement tools now exist — `vram-probe/`, `token-budget.mjs`, `sketch-bench.mjs`, `record-demo.mjs`. Nobody has packaged them, but they are the shape Phase 6 describes. |

### Two things this review turned up

**The biggest unblock is not on the roadmap at all: Ollama runs on CPU in the
build sandbox.** Phase 4 was costed assuming capability work needed a GPU or a
round trip to a real phone. It does not — `qwen3:0.6b` answers in about a
second on four CPUs and `qwen3:1.7b` in two to seven. Iterating on a prompt no
longer takes a day and a borrowed handset. Phase 4 just got much cheaper than
its week 9–14 slot assumes, and could plausibly run alongside Phase 2 or 3.

**Sketch mode was not in this roadmap, and now it is Phase 2.** It was never
planned, it is the most developed part of the product, and it is the only thing
here anyone has actually wanted to open. "Here is what *your* phone drew" is a
datapoint and a share in one action, which is precisely the loop the original
Phase 2 needed and never had. The benchmark framing was the means; the sketch
is the thing people will do.

What that does *not* dissolve: nothing is collected. A visitor draws and
leaves, and the lab learns nothing. The device-compatibility matrix is still
the asset, and it is still unwritten — it is now a piece of Phase 2 rather than
the whole of it.

---

## Phase 1 — Foundation ✅ shipped

The template. Clone → your own browser-LLM page on GitHub Pages.

## Phase 2 — Sketch mode, and what your device can run *(shipped, half done)*

**Shipped.** Describe something, the page draws it, entirely on your device.
The measurement work lives underneath: the page reads the GPU adapter, filters
out models it cannot run, picks a context rung, and budgets from a measured
allocation formula rather than a published estimate that is out by 43%.

Why a drawing rather than a benchmark: a benchmark is a number you read once. A
sketch is a thing you make, and the difference between a phone's model and a
desktop's is visible in the picture rather than in a table. Same evidence,
survives contact with a timeline.

**Still missing, and it is the half that compounds:** nobody leaves a
datapoint. A visitor draws, sees what their hardware managed, and the lab
learns nothing. Every blog post reports one author's machine; nobody answers
*"what about mine?"* — and this page could, because it already computes the
answer for each visitor and then throws it away.

The model ladder this benchmarks is researched and costed in
[`mobile-models.md`](mobile-models.md) — which models WebLLM ships at phone
sizes, what each actually costs to download and to hold in GPU memory, and the
staged plan to add them. GPU cost is now a measured formula rather than
WebLLM's published estimate, which is out by 43% on one model;
`scripts/vram-probe/` reproduces it without a GPU.

**Asset:** a public device-compatibility matrix — iPhone 14 vs Pixel 8 vs M2
Air — that grows without further work.
**Content angle:** "tell me your phone, I'll tell you what it runs." The
engagement loop is built into the product.

## Phase 3 — Work mode *(weeks 4–8, planned)*

A third mode beside Chat and Sketch: open a document, find your way around it,
nothing uploaded. Full plan and the measurements behind it:
**[`work-mode.md`](work-mode.md)**.

The first genuinely *useful* thing rather than an impressive one. Privacy is
the whole product: tenancy agreements, clinic letters, contracts — the
documents nobody pastes into a cloud API, which are exactly the documents where
finding the right paragraph is worth something.

**The obvious version of this does not work, and that is the finding.**
`scripts/grounding-bench.mjs` measures it: Qwen3-0.6B invented answers to 3 of
5 questions its document did not address, and forcing it to quote the source
made it worse, not better — it cannot copy verbatim at all, so a quote check
throws away every correct answer too. Qwen3-1.7B quotes perfectly and *still*
attached "Yes, residents may claim compensation" to a real passage that says no
such thing. Quote verification catches invented sources; it does not catch
unsupported conclusions drawn from real ones.

So the design inverts: **the passage is the answer.** The model locates, the
page shows you the text, you read it. Being shown the wrong paragraph is
visible; being told the wrong thing is not. Layer 1 needs no chat model at all
— an embedder cannot hallucinate — and is the whole product if the rest never
ships.

Blocked on one untested question: whether two WebLLM engines can be resident in
one tab. On arithmetic it fits — `arctic-embed-s-b4` (239 MB reserve, 67 MB
download) plus SmolLM2-360M is ~615 MB against a 900 MB phone budget — and
WebLLM 0.2.85 does expose `embeddings` with no singleton guard. Nobody has run
it. See `mobile-models.md`, Stage 5.

## Phase 4 — The practitioner's capability table *(weeks 9–14, partly built early)*

The bridge from those PDFs to shipping: which tasks survive which sizes at which
quantization, in tasks people actually build, runnable in-browser so anyone can
reproduce it on their own hardware.

Eleven rows now exist (see `CLAUDE.md`), and the harness to produce more exists
too. The original three: obedience beating capability, valid not implying
correct, and 4-bit destroying instruction-following. Sketch mode added the rest,
including the one that generalises furthest — **naming is the easy half, placing
is the hard half**: a 0.6B names three objects correctly and then puts them all
in the same spot, and a 1.7B does exactly the same. Scale buys vocabulary and
coverage, not arithmetic.

`scripts/sketch-bench.mjs` runs a real prompt through real models and judges the
output with the page's own parser. Point it at any Ollama tag.

Not new science — cite the papers, and run the practitioner version. That
combination does not currently exist, and it is the thing to be known for.

## Phase 5 — One vertical, done properly *(weeks 15–20)*

Pick one domain where local-only is non-negotiable:

| Domain | Why local wins |
|---|---|
| Clinical / therapy notes | Regulation makes cloud a non-starter |
| Legal document review | Privilege and confidentiality |
| Field work without signal | Offline is the requirement, not a feature |
| Journalism | Source protection |

Chosen on Phase 2–4 evidence about what is actually feasible. The first phase
that could carry revenue.

## Phase 6 — The body of work *(weeks 21–26)*

Package the tooling — eval harness, device detection, model ladder — as
something others build on. By now the asset is not any single app; it is being
the person who measures this honestly.

---

## Do not build

- **Fine-tuning.** CPU-only makes it impractical; months spent for a result
  worse than good prompting.
- **Another chat UI.** Solved, including by this repo.
- **Agents.** Crowded, and hard to differentiate solo.
- **Anything claiming a novel delivery mechanism.** WebLLM owns that, and
  claiming otherwise costs more credibility than the claim buys.

## Positioning

> The research on small models is locked in PDFs. I build pages that let you
> test it on your own device in thirty seconds.

True, useful, and nobody is doing it. Publishing what did *not* work — the
deleted mood tagger, the crashed phone — reads as more credible than the demos.

## Risks

- **Phase 2 needs traffic.** No visitors, no matrix. If the launch lands flat,
  Phase 3 is the better opener because it is useful to one person alone.
- **Phase 5 turns on domain access, not code.** Start those conversations
  during Phase 3, not at week 15.
- **Six months solo is about three real projects, not six.** Phases 2–4
  compound; 5–6 are optional if the earlier ones find traction.
