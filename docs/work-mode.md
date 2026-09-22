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
download and 239 MB of GPU reserve. An embedder cannot hallucinate **because it
cannot speak** — asked to write prose it answers `"snowflake-arctic-embed:s"
does not support chat`. It has no decoder. It returns existing text or nothing.

Measured (`scripts/retrieval-bench.mjs`, one policy document, six queries):
**4 of 4 answerable queries put the right sentence in the top 3, three of them
first.** And the scores separate cleanly — answerable queries landed at
0.642–0.798, queries the document does not cover topped out at 0.574. A
threshold near 0.61 lets the page say *"this document does not cover that"*.

That last part matters more than the hit rate. **It is the refusal the chat
models could not produce**, and it comes from a number rather than a model's
judgement. Qwen3-0.6B invented an answer to 3 of 5 absent questions; the
embedder simply scores low and the page declines. Small sample — treat the
threshold as a direction, not a constant.

This layer is **the whole product if the other two never ship**.

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
- **Write** a summary of a whole document. There is no passage to check an
  invented summary against, so the failure is silent by construction. This is
  the one shape to refuse outright — see the note below, because "summarise"
  splits in two and only one half is forbidden.

---

### Can it summarise? Two different questions

Worth separating, because the obvious answer is wrong in an interesting way.

**Writing a summary** needs a decoder. The embedder has none, and a small chat
model writing one is the forbidden shape above: nothing to check it against.

**Selecting a summary** needs no generation at all. Extractive summarisation
picks sentences the document already contains — centrality scoring over the
same embeddings, with MMR for diversity. Every word is verbatim and clickable
back to its place. It is safe by construction.

It is also, measured, **not very good**. On the test document it chose the bank
holiday note, the quarterly performance figures and the communal cleaning rota
— and dropped every single response time, which is the only reason anyone
opens a repairs policy. Centrality rewards sentences that sound like the
average of the document, so the specific, number-carrying ones read as outliers
and get cut.

The failure is at least the visible kind: you read it and think *that is not
the important bit*. Nobody is misled. But it is not worth shipping on its own,
and it points at the real conclusion — **the useful version of "summarise" is
query-anchored**. "Summarise this document" is the weakest possible query,
which is why it is the hardest to serve. "What does this say about notice
periods" retrieves the right sentence first every time. Ship the question box,
not the summary button.

If a summary is wanted anyway, the honest form is a **contents list**: the
top passage per section heading, labelled as *where things are* rather than
*what it says*.

## Open questions, in the order they block things

1. **Can two WebLLM engines be resident in one tab?** Phase 3's real gate, and
   still untested (`mobile-models.md`, Stage 5). WebLLM 0.2.85 does expose
   `embeddings` on the engine and has no singleton guard, so it is plausible;
   nobody has run it. On arithmetic 239 MB + 376 MB = 615 MB against a 900 MB
   phone budget. **Test this before writing any UI.**
2. **Does retrieval hold up on a real document?** First numbers are in
   (`retrieval-bench.mjs`, 4/4 top-3), but on one short synthetic policy with
   six queries. The things that will break it are length, headings, tables and
   a document whose vocabulary does not match the question's. Run it over
   something real before trusting the 0.61 threshold.
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
