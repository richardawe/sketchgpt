# Work mode — reading a document on your own device

A third mode beside Chat and Sketch: you open a document, and the page helps
you find your way around it. Nothing is uploaded. Roadmap Phase 3.

This document exists because the obvious version of the idea — "a small model
reads your document and answers questions about it, without hallucinating" —
**does not survive measurement**, and it is worth being precise about how it
fails before building anything.

---

## What was measured

`scripts/grounding-bench.mjs`, Ollama on CPU. One short policy document. Five
questions it answers, five it does not. Inventing an answer to one of the
second five is the failure being counted.

| Model | Mode | Answered | Correctly refused | **Invented** | Caught by quote check | Correct answers the check would bin |
|---|---|---|---|---|---|---|
| Qwen3-0.6B | free | 5/5 | 2/5 | **3/5** | — | — |
| Qwen3-0.6B | quote | 5/5 | 1/5 | **4/5** | 4/4 | **5/5** |
| Qwen3-1.7B | free | 5/5 | 4/5 | **1/5** | — | — |
| Qwen3-1.7B | quote | 5/5 | 3/5 | **2/5** | 0/2 | 0/5 |

Both sizes answered every answerable question. That is not the interesting
column. Every one of these models invented answers to questions the document
does not address, and **quoting did not fix it.**

### Qwen3-0.6B cannot quote at all

Asked to copy the supporting sentence, it returned the literal string `"..."`
— the ellipsis from the prompt's own template. Every time. So a verbatim check
rejects 100% of its output, correct answers included, and without the check it
confidently produced:

> **Q:** Can residents claim compensation for a late repair?
> **A:** "Yes, residents can claim compensation for a late repair."

The document says nothing of the kind. **Qwen3-0.6B is unusable for reading a
document.** Not "needs a better prompt" — the phone default cannot do this job.

### Qwen3-1.7B quotes perfectly and still misleads

It copied verbatim every time and refused the unanswerable questions three
times out of five. But:

> **Q:** Can residents claim compensation for a late repair?
> **quote** (genuinely in the document): *"Costs. Repairs arising from fair wear
> and tear are free. Damage caused by a resident or their visitors is
> recharged at cost…"*
> **A:** "Yes, residents may claim compensation for a late repair."

A real passage, correctly copied, attached to a conclusion the passage does not
support. **The quote check passes it.** A reader skimming sees a citation and a
confident yes.

### The finding

Quote verification catches **fabricated sources**. It does not catch
**unsupported conclusions drawn from real sources** — and the second is the
more dangerous failure, because it arrives wearing a citation.

This is the project's existing rule, sharpened: *tasks with a correct answer
fail silently*. "What does this document say about X" has a correct answer.

---

## What to build instead

**The passage is the answer.** The model's job is to *locate*, never to
*conclude*. The page shows you the paragraph and you read it yourself.

That inverts the failure mode, which is the whole point. Being shown the wrong
paragraph is **visible** — you read it and it is about something else. Being
told the wrong thing confidently is **silent**. The project only ships the
first kind at this size.

It is also the same move that made Sketch mode work. There, the model names an
object and the page owns the shape. Here, the model points at a passage and the
page owns the text. If the page can be the thing that is right, the model
should not be asked to be.

### Three layers, and only the first is load-bearing

**Layer 1 — Find (no LLM at all).** Embed the document's paragraphs, embed the
question, show the closest passages. `snowflake-arctic-embed-s-b4` is 67 MB to
download and 239 MB of GPU reserve. An embedder cannot hallucinate: it returns
existing text or nothing. This layer alone delivers "find me the bit about
notice periods" on a device that could never run a usable chat model, and it is
**the whole product if the other two never ship**.

**Layer 2 — Ask (LLM, off by default below 1.7B).** Same retrieval, but a model
writes a sentence over the retrieved passage, always displayed *under* the
passage, never instead of it. Gated on model size the way colour is gated on
context: the measurement above says the 0.6B must not be offered this. Every
answer carries the passage it came from, because that is the only thing the
reader can check.

**Layer 3 — Picture it (Sketch, reused).** Select a passage, get a diagram of
the concept. This is the one generative feature that is *safe* here, and for a
reason worth stating: a sketch of a concept has no correct answer, so it
degrades to mediocre rather than to wrong — exactly the task shape the project
already established is safe at this size. It costs nothing new: the sketch
prompt, parser and renderer already exist.

### What the page must never do

- Show a generated answer without the passage beside it.
- Offer Layer 2 on a model that cannot quote. The bench is the gate.
- Summarise a whole document. There is no passage to check a summary against,
  so the failure is silent by construction — the one shape to refuse outright.

---

## Open questions, in the order they block things

1. **Can two WebLLM engines be resident in one tab?** Phase 3's real gate, and
   still untested (`mobile-models.md`, Stage 5). WebLLM 0.2.85 does expose
   `embeddings` on the engine and has no singleton guard, so it is plausible;
   nobody has run it. On arithmetic 239 MB + 376 MB = 615 MB against a 900 MB
   phone budget. **Test this before writing any UI.**
2. **Does retrieval alone actually find the right paragraph?** Unmeasured.
   Extend `grounding-bench.mjs` to score retrieval hit-rate rather than answer
   correctness — the same harness, a different column.
3. **Where does the text come from?** A `.txt` and paste box is an afternoon.
   PDF means pdf.js and a much larger surface. Start with paste.
4. **How long a document?** Retrieval keeps the *prompt* small, but the
   embedding pass is linear in document length and the page has a measured
   token budget it must not blow (`token-budget.mjs`).

## Why this is the right Phase 3

Privacy is not a feature here, it is the only reason to accept a small model.
Nobody pastes a tenancy agreement, a clinic letter or a contract into a cloud
API — and those are exactly the documents where finding the right paragraph is
worth something. A page that never uploads is not a weaker version of a cloud
tool; for that material it is the only version that can be used at all.

It also feeds Phase 5 directly: legal review, clinical notes and field work all
appear in the roadmap's vertical table, and all three are document-reading with
a confidentiality constraint.
