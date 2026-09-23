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
- The desktop default is still Qwen3-0.6B. On these numbers Desk is clearly
  better on Qwen3-1.7B (~2 GB download instead of ~500 MB) — the user's call.
