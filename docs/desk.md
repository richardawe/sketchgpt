# Desk — what was measured, and why it has two tools

Desk replaced Work mode (`docs/fix-plan-work-ui.md` is the review that retired
it). The brief was a productivity tool with no document upload, and the
constraint was this project's oldest finding: at 0.6B, only ship tasks whose
failure is **visible**.

Everything below is Qwen3 on Ollama on CPU (GGUF Q4_K_M), not the MLC q4f16
build a browser serves, so it measures what the prompts get out of a model of
that size, not the exact bytes a visitor sees. `scripts/desk-bench.mjs` reruns
the shipped prompts and applies the page's checks.

## Five tools were built; three were cut

| Tool | Qwen3-0.6B | Qwen3-1.7B | Kept? |
|---|---|---|---|
| Break it down | generic but usable steps, 3/3 | good steps (once 15 of them, before the prompt capped it at 3–7) | cut for focus |
| **Brain dump** | usable list; wrote `- - Buy milk` (bullet in a bullet) and duplicated an item | clean list | **yes** |
| **Say it better** | see below | 6 of 8 kept meaning; both misses wrote the "friendlier" version from the recipient's side | **yes** |
| Draft a reply | turned "no, I have a family thing" into "I **don't** have a family thing"; once echoed the message back | good | cut |
| Rehearse | did not play the named person; once played an assistant | in role, but said the prompt's own words ("easy practice is not practice") out loud | cut |

Draft-a-reply failed the way this project refuses to ship: confidently, in a
message the person would send. Rehearse was merely weak — but weak on both
sizes. Break it down worked and went for focus: two things done well beat five
on a menu.

## Say it better: three prompts, and why the page checks the result

| Prompt | Qwen3-0.6B, 4 messages × 2 runs |
|---|---|
| Plain instruction | "won't be ready Friday" → "**will be** ready Friday", twice. Two rewrites returned only the preamble "Sure! Here's a firmer version of your message:" and nothing else. |
| + one worked example | negations kept — but a "friendlier" rewrite of an unrelated message **gained the example's content**: "I can't make the meeting tomorrow — my car broke down." |
| Shipped: no example, "write as them, and if they say something will NOT happen, so must you" | final run: every negation and number kept |

A worked example teaches its content, not just its shape — the same lesson as
the two cats in sketch mode, in a place where it is far worse. So the shipped
prompt has no example, and the page checks what it mechanically can
(`checkRewrite` in `web/desk.mjs`):

- a negation in the original that is absent from the rewrite → **Check before sending**
- a number in the original that is absent from the rewrite → named
- a reply that is only a preamble → stripped, and reported as a failure rather
  than shown as a blank

**What the checks do not catch**, from the final run: Qwen3-0.6B rewrote "You
never reply to my emails. I need the invoice by 5pm." as "I haven't replied to
your emails yet" — the recipient's side, with a negation, so the check passes.
Qwen3-1.7B returned the same message unchanged, which at least is visible. The
composer says "Small model — check the result before you use it" on this tool
while a sub-1B model is loaded.

## Brain dump: the page lists what went missing

Both sizes dropped "dentist" from a seven-item dump, in more than one run.
`leftOut` splits the dump on commas, lines, semicolons and "and", and any part
whose content words appear on no item is shown as a one-tap chip. It also
lists feelings the prompt told the model to leave out ("worried about
Monday") — deliberately: the page cannot tell a dropped task from a dropped
worry, and the person can, instantly.

## Which model a phone gets — and the bug that decided it

A phone user reported that "after a few chats" Brain dump came back as prose.
Desk had been benched on Qwen3 only, and a phone was loading **SmolLM2-360M**.
Same prompts, 4-bit builds, 3 dumps × 4 runs each:

| Model | Brain dump came back as a list | Say it better |
|---|---|---|
| SmolLM2-360M (old phone default) | **8 / 12** — prose, input echoed back, one loop of "dont forget to buy milk" | invented content ("a full-month payment on the 15th", "a revised report by [date]"); one rewrite looped 60+ times |
| **Qwen2.5-0.5B** (new phone default) | 12 / 12 | 3 of 4 kept meaning; the fourth refused ("I can't assist with that") — visible |
| Qwen3-0.6B | 12 / 12 | see above |
| **Qwen3-1.7B** (new desktop default where it fits at ≥2048) | 12 / 12, fewest items dropped | see above |

Forcing JSON output (`{"items": [...]}`) was tried and rejected: every model
returned valid JSON, but the Qwen models dropped two to three times as many
items, and SmolLM2 once returned the prompt's own example, `["first task",
"second task"]`.

What shipped instead, in the page: a list the model writes as prose is split
into items (`listFromProse`) and captioned as such; duplicate items are merged;
a repetition loop is cut (`collapseRepeats`) and captioned; and Brain dump's
output is capped at 320 tokens, which a dozen short lines never need.

Qwen2.5-0.5B also draws best of the phone-sized models in `sketch-bench.mjs`:
10 of 10 requested things, against 8 for Qwen3-0.6B and 7 for SmolLM2-360M.

## The model downloads by itself

At the owner's request, the page now picks the model for the device and starts
the download without a button press. The card names the model and its size
while it downloads, "Choose a different model" (`?manual=1`) is one tap away,
and a browser that has asked to save data (`navigator.connection.saveData`)
still gets asked first. This reverses an earlier rule — "silently pulling
hundreds of MB on someone's mobile data is not ours to do" — and the Save-Data
exception is what is left of it. iOS Safari does not expose `saveData`, so on
an iPhone the download always starts.

## The privacy meter

The header's shield counts every request the page makes after the model has
loaded, from the browser's own Resource Timing record, and the menu lists them.
Desk and Chat make none. `tests/desk-browser.mjs` checks it reads 0 after real
turns, and that it is a counter rather than a label by making one request and
watching it change. What it cannot see: requests from other tabs, extensions,
or the browser itself.

## Open

- **No phone has run Desk.** Touch emulation in Chromium is tested; iOS Safari
  is not. The startup crash this replaced was touch-only, and was invisible to
  every mouse-driven test.
- The final-run numbers are 6 cases per model. Treat them as a direction.
- A desktop now gets Qwen3-1.7B (~1 GB download, ~1.6 GB of GPU memory at
  4096) wherever it fits at a 2048 context or more. Untested on a real
  low-memory laptop; the budget comes from the measured allocation formula.
