# Making the model do other things

There is a ladder here, cheapest first. **Most people reach for the top rung
first and waste a weekend.** Work upward and stop as soon as something works.

The single most important fact: **Ollama cannot train models.** It is an
inference runtime — it runs weights, it does not update them. Every rung below
that involves real training happens in other tools, and the result is then
imported back into Ollama.

---

## Rung 1 — System prompt (no training)

Change the instructions, not the weights. Instant, free, reversible.

Use the **Settings** panel in the web UI to experiment live. When you find
wording that works, bake it into a named model:

```bash
ollama create sketchgpt -f models/modelfiles/sketchgpt.Modelfile
ollama run sketchgpt
```

See [`models/modelfiles/sketchgpt.Modelfile`](../models/modelfiles/sketchgpt.Modelfile).
Editing and rebuilding takes about a second, and the new model **shares the
base weights** — it costs a few KB on disk, not another 500 MB.

Surprisingly far-reaching. Persona, tone, output format, refusal behaviour and
task framing are all reachable from here.

## Rung 2 — Few-shot examples

Still no training. Put 3–10 worked examples in the system prompt or seed the
message history with fake prior turns. This is the most reliable way to lock
in an **output format** the model keeps getting wrong.

Watch the context budget: `qwen3:0.6b` has a small window, and examples eat it.

## Rung 3 — Retrieval (RAG)

**If you want the model to know facts — your notes, your docs, your codebase —
this is the rung, not fine-tuning.** Fine-tuning teaches *behaviour*; it is a
poor and expensive way to teach *facts*, and it makes them hard to update.

Shape: embed your documents, retrieve the relevant chunks at query time, paste
them into the prompt. Ollama serves embeddings too:

```bash
ollama pull nomic-embed-text
curl http://127.0.0.1:11434/api/embed \
  -d '{"model":"nomic-embed-text","input":"some text to embed"}'
```

Store vectors in sqlite-vec, Chroma or LanceDB. No GPU needed.

## Rung 4 — Fine-tuning (LoRA)

Real training: you update weights. Reach for this when you need a *behaviour*
that prompting cannot produce — a consistent style, a domain's idiom, a
structured output the base model keeps breaking.

**What you need**

| | |
|---|---|
| Data | ~500–5,000 example pairs. Quality over quantity. This is the hard part, and it is most of the work. |
| Hardware | An NVIDIA GPU, or an Apple Silicon Mac via MLX. At 0.6B a LoRA is genuinely small — often minutes on a consumer GPU, and free-tier Colab is enough. |
| Tools | [Unsloth](https://github.com/unslothai/unsloth) (fastest on NVIDIA), [axolotl](https://github.com/axolotl-ai-cloud/axolotl) (config-driven), or [MLX-LM](https://github.com/ml-explore/mlx-examples) (Apple Silicon). |

**Why 0.6B is a good place to learn:** the whole loop fits in modest memory, so
you iterate in minutes instead of hours. The lessons transfer upward.

**The loop**

1. Build a dataset — usually JSONL of `{"messages": [...]}` conversations.
2. Train a LoRA adapter against the *original* Qwen3-0.6B weights from
   Hugging Face (`Qwen/Qwen3-0.6B`), not the GGUF in `models/ollama/`.
3. Merge the adapter into the base weights.
4. Convert to GGUF with `llama.cpp`'s `convert_hf_to_gguf.py`, then quantise.
5. Import into Ollama and use it exactly like any other model:

```bash
# models/modelfiles/tuned.Modelfile
FROM ./my-finetuned-model.Q4_K_M.gguf
SYSTEM """Your system prompt."""
```

```bash
ollama create sketchgpt-tuned -f models/modelfiles/tuned.Modelfile
```

Ollama can also load a GGUF adapter directly, skipping the merge:

```
FROM qwen3:0.6b
ADAPTER ./my-lora.gguf
```

**Expectation setting.** A 0.6B model has a low ceiling. Fine-tuning sharpens
what it can already almost do; it will not give it knowledge or reasoning it
never had. If the base model cannot *nearly* do the task with a good prompt,
fine-tuning at this size will usually disappoint — move to a larger base
(`qwen3:4b`, `llama3.1:8b`) before you try to train your way out of it.

---

## Choosing a rung

| You want… | Rung |
|---|---|
| A persona, tone, or task framing | 1 — system prompt |
| A reliable output format | 2 — few-shot, then 4 if it still drifts |
| It to know your documents or data | 3 — RAG |
| A style or idiom prompting can't reach | 4 — LoRA |
| It to be smarter in general | None — use a bigger base model |


---

## What a 360M model on a phone is actually for

Measured against `smollm2:360m`, the size the in-browser page defaults to on
mobile. Every number below is a real run, not an estimate.

| Task | SmolLM2-360M | Llama-3.2-1B |
|---|---|---|
| **Sentiment on journal entries (positive/negative)** | **10/10** | 4/10 |
| Binary sentiment on short reviews | **10/10** | — |
| Three-way sentiment (+ neutral) | 5/8 | — |
| Extract dates from a sentence | invented 4 extra dates | 3/3 |
| Three keywords from a caption | echoed the input | correct |
| Route to billing/technical/sales | wrong | correct |
| Spam vs normal | chance | answered "normal" to everything |
| Urgent vs later | 2/8 | 4/8 |

Two things fall out of this.

**It is a classifier, not a conversationalist.** The one task it is genuinely
reliable at is sorting short text into *two* clearly-opposed, conventional
labels. Positive/negative is heavily represented in training data; invented
label pairs like urgent/later are not, and it fails them. Adding a third class
makes it collapse to whichever label it likes best. Few-shot examples did not
rescue the custom schemes.

**Bigger is not automatically better.** Llama-3.2-1B scored 4/10 on journal
sentiment against SmolLM2-360M's 10/10 — not because it understands less, but
because it ignores the output format and answers "good", "downward" or
"anxious" when asked for one of two words. When the whole job is emitting one
of two tokens, obedience beats capability. Use the 1B for extraction and
routing, where it is clearly ahead.

### On a desktop, go bigger

Qwen3-1.7B (2037 MB) via the in-browser page produces genuinely usable long-form
work on desktop — outlines, drafts, structured documents. The ceiling described
below is a property of 360M-class models on phones, not of the page.

Reasoning models like Qwen3 think before answering. The page hides that by
default (`extra_body.enable_thinking = false`); tick **show reasoning** to see
it in a collapsed block instead.

### What these models are for

Tested in the browser, the mood tagger **did not work**: a 4-bit SmolLM2-360M
answered "positive" to everything. The grammar constraint did its job — the
output was always a valid label — but a valid label is not a correct one. When
the weights are damaged enough that the logits carry little signal, constrained
decoding just picks whichever allowed token edges ahead, every time.

That is the trap worth remembering:

**Tasks with a correct answer fail silently.** Classification, extraction and
routing return confident, well-formed, wrong results. You cannot tell by
looking. At 360M and 4-bit, do not use them for this.

**Tasks with no correct answer degrade gracefully.** Description, riffing on a
concrete input, open questions — a weak model gives you something mediocre,
and mediocre is visible and harmless. Given a seed, even the 360M model
produced usable lines ("a water droplet on a white piece of paper"; "what if
cities could change colours at night?"). Asked to generate from nothing or to
follow a multi-part format, it waffled or echoed the input back.

So the presets in the page make no accuracy claims. **Concise** shortens
replies, which helps because small models ramble; it cannot be wrong, only
unhelpful. Everything else is a free-text system prompt you can experiment
with, knowing the failure mode above.

If you need a task done *correctly*, use a bigger model. Qwen3-1.7B on a
desktop handles real generative work — outlines, drafts, structured documents.
The ceiling described here belongs to 360M-class models on phones.
