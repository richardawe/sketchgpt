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
| 2 Device benchmark | **half built, not started** | The page already detects the adapter, filters models it cannot run, picks a context rung and budgets from the measured formula. What does not exist is the part that makes it Phase 2: **no visitor leaves a datapoint, and there is no public matrix.** That is the whole asset, and none of it is written. |
| 3 Browser RAG | **not started** | Unchanged. Still the first genuinely useful thing, still needs no GPU. |
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

**Sketch mode is not in this roadmap.** It is now the most developed part of
the product and it was never planned. It has paid for itself in Phase 4
evidence, and it is the most shareable thing the lab has made — but it is not a
page that answers a question about the visitor's own situation, which is the
thesis. Two honest options, and it is a decision rather than a detail:

1. **Claim it.** Make sketch mode the Phase 2 engagement hook — "here is what
   *your* phone drew" is a datapoint and a share in one action, which is
   exactly the loop Phase 2 needs and currently lacks.
2. **Call it a detour** that bought a capability harness and a demo reel, and
   go back to Phase 2 as written.

Doing neither — carrying on adding to it because it is enjoyable — is the
failure mode worth naming out loud.

---

## Phase 1 — Foundation ✅ shipped

The template. Clone → your own browser-LLM page on GitHub Pages.

## Phase 2 — "What can my device run?" *(weeks 1–3, not started)*

A page that benchmarks the visitor's actual hardware: which models load,
tokens/sec, memory ceiling, where it falls over.

Every blog post reports one author's machine. Nobody answers *"what about
mine?"* This does, in thirty seconds, and each visitor leaves a datapoint.

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

## Phase 3 — Browser RAG *(weeks 4–8, not started)*

Chat with your own documents, entirely on-device. Embeddings are cheap and need
**no GPU**, which matters because the lab's machine is CPU-only.

The first genuinely *useful* thing rather than an impressive one. Privacy is
the whole product: notes, records, journals — anything you would not paste into
a cloud API. Phase 2's data says which devices can hold an index and a model at
once, which nobody else knows.

On arithmetic the answer is promising: `snowflake-arctic-embed-s-b4` reserves
239 MB and downloads 67 MB, so an embedder plus SmolLM2-360M is ~615 MB against
a 900 MB phone budget. Whether two WebLLM engines can be resident in one tab is
untested — see `mobile-models.md`, Stage 5.

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
