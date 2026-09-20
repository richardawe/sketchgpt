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

## Phase 1 — Foundation ✅ shipped

The template. Clone → your own browser-LLM page on GitHub Pages.

## Phase 2 — "What can my device run?" *(weeks 1–3)*

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

## Phase 3 — Browser RAG *(weeks 4–8)*

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

The staged plan is in [`fresh-data.md`](fresh-data.md), which widens Phase 3
from "your documents" to "anything the weights cannot know" — the date, a
pasted document, and a short allowlist of CORS-clean APIs — and puts the
measurement that decides whether any of it may ship ahead of the feature.

## Phase 4 — The practitioner's capability table *(weeks 9–14)*

The bridge from those PDFs to shipping: which tasks survive which sizes at which
quantization, in tasks people actually build, runnable in-browser so anyone can
reproduce it on their own hardware.

Three rows already exist (see `CLAUDE.md`): obedience beating capability, valid
not implying correct, and 4-bit destroying instruction-following.

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
