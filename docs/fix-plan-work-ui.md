# Fix plan — Work mode retrieval and the page UI

> **Status: acted on, differently.** P0 (the touch-screen crash) is fixed:
> every startup side effect now runs from one `boot()` at the end of the
> module, the form cannot fall back to a native submit, and
> `tests/desk-browser.mjs` runs on a touch screen and fails on any page error
> or reload — mutation-checked. P1–P4 were overtaken by a decision to drop
> document upload altogether: Work mode was replaced by **Desk**
> (`docs/desk.md`), and the page was redesigned (one-row header, load card,
> composer with the tools in it). The retrieval code lives on in
> `scripts/lib/retrieval.mjs` for `scripts/retrieval-bench.mjs`.

Review of `main` at `fff5d91`. Every finding below was reproduced in this
session: headless Chromium with the WebLLM stub the tests already use, the
planner run in node, and Qwen3-0.6B's real tokenizer. **No real phone and no
real model were used.** Where that matters, it is said.

---

## The short version

"RAG isn't working" is three separate failures stacked on top of each other:

1. **On any touch device the page's script dies at startup, so Send reloads
   the page.** This is not a retrieval bug, but it makes Work mode look like
   one, and it breaks Chat on phones too. Live since `7e3ffa1` (2026-09-22).
2. **There is no "ask a question" task.** Retrieval only runs as a fallback
   when a document is too long. The default task is "Rewrite it", and
   rewriting a long document returns a list of passages with no answer.
3. **The query box means different things for different tasks, and the
   planner treats every query as a search.** "Translate into French" on a
   long document searches for the word *French*, finds nothing, and refuses.

On top of that, the token estimator counts prose at **2x** its real cost, so
documents are declared "too long" at half the length they really are. And on a
phone the header and document tray take most of the screen, leaving a sliver
for the answer.

---

## Findings, most severe first

### F1 — Touch devices: the module throws at startup and every listener after line 1058 is missing

`web/browser.html` is one 1,300-line module that mixes top-level statements
with `const` declarations. Line 1058 calls `syncWork()` → `syncTask()` →
`fitPlaceholder()`. On a touch screen in Chat mode (the default mode),
`fitPlaceholder()` reads `PLACEHOLDER_SHORT`, which is declared with `const` at
line 1721. The read happens before that line has run, so it throws
`ReferenceError: Cannot access 'PLACEHOLDER_SHORT' before initialization`, and
**the rest of the module never runs**:

| Never runs on a phone | Consequence |
|---|---|
| `form` submit listener (l.1458) | Send submits the `<form>` natively. The page navigates to `browser.html?`, the model reloads from cache, and the message is gone |
| `const esc` (l.1107) | `showDoc()` throws on every paste. The tray says "Nothing loaded" while the Remove button appears, because the document *was* loaded |
| Enter-to-send, input autosize, Stop | Missing |
| Service-worker registration (l.1070) | Offline use silently gone on phones |

Reproduced with `isMobile/hasTouch` emulation: `navsAfterSend: 1`,
`calls: 0`. With a mouse the same page works (`navsAfterSend: 0`,
`calls: 1`). **Why the tests missed it:** every browser test runs with a fine
pointer, and none of them fails on `pageerror`. Sketch-mode phone runs worked
because `fitPlaceholder()` returns early in Sketch and Work mode. The crash
only happens when the page *starts* in Chat mode.

### F2 — Retrieval is not a feature anyone can choose

`docs/work-mode.md` says "ship the question box, not the summary button". The
page shipped 17 tasks and not one of them is "ask about this document".
Retrieval runs only inside `planWorkTurn` when the whole source does not fit.
In practice:

- **Short document + a question**: the whole text is sent and nothing is
  retrieved. That is fine, but the passages that answer the question are not
  highlighted, so the reader has the whole document to check against.
- **Long document + the default task (Rewrite) + no text typed**: this
  returns a contents list and generates nothing. On a real document, that is
  what the user sees first.
- **The closest thing to Q&A** is "Explain what it means", with the question
  typed in the composer, under the placeholder "What part is unclear?
  (optional)".

### F3 — The query is an instruction for most tasks, and the planner searches with it anyway

Measured with `docs/work-mode.md` as the document (2,559 words, 53 passages):

| Task | Typed | What happens | What should happen |
|---|---|---|---|
| Translate | `French` | **Refused**: "Nothing in this document mentions "french"" | Pick a section, then translate it |
| Shorten | `half the length` | Searches for *half* and *length*, then shortens 2–4 unrelated passages | Pick a section |
| Summarise | `summarise the document` | Searches for *summarise* and *document*, and returns passages *about summarising* | Treat it as having no focus, and show the contents list |
| Rewrite, Critique, Questions | (nothing) | Contents list, no generation | Pick a section |

`task.ask` already tells the page which role the text plays ("Into which
language?", "How short?"). The planner ignores that.

### F4 — The token estimator charges prose double

`estimateTokens()` in `web/sketch.mjs` counts every space and punctuation mark
as one token. That is roughly right for sketch commands, which are mostly
digits. For prose it is badly wrong:

| Text | Real tokens (Qwen3) | Estimated | Ratio |
|---|---|---|---|
| docs/work-mode.md | 3,755 | 7,501 | **2.00** |
| README.md | 6,417 | 12,573 | 1.96 |
| one 36-token sentence | 36 | 86 | 2.39 |

The consequences:

- At 4096 context, a document is "too long" above about 1,500 real tokens
  (roughly 1,100 words), when it would really fit up to about 3,000.
- At 1024 context, which is a phone's fallback rung, the whole-document
  threshold is about **220 words**.
- Output is starved. At 1024, "Explain" with retrieved passages sent 538 real
  tokens and set `max_tokens: 96`. The window really had about 420 tokens
  free.

A trial estimator that lets a single leading space ride with the word after it
measured **1.31–1.35x** across all six repo docs. On every paragraph it stayed
at or above 1.04x the real count, so it never reads low. That frees about 50%
more room without breaking the "never under" rule that
`scripts/token-budget.mjs` enforces for sketches.

### F5 — The tray and the planner disagree about what "fits"

`showDoc()` uses `words < CTX / 2`, while `planWorkTurn()` uses the estimator
plus the task prompt. At 4096 context a 1,800-word document gets no warning
from the tray, and then the planner sends it through retrieval anyway. The
tray also does not recompute when a different model changes `CTX`.

### F6 — Phone layout: the answer gets the least room on the screen

These are screenshots at 390x844, taken with Work mode forced so that F1 does
not get in the way:

- **Header wraps to three rows (~190 px).** The model picker is on a row of
  its own, and "Clear cache", a destructive developer control, gets a row too.
- **The document tray is ~350 px and never collapses.** After a paste, the
  full document stays in an editable textarea. The native file input and a
  lone "Remove" button each take a row.
- **About 200 px is left for the conversation.** An answer and its six open
  passages share a strip that shows about four lines.
- **The tray shows before the model is loaded**, which pushes the load card
  below the fold.
- **Controls for the same action are split:** the task picker sits at the top
  of the screen and the question box at the bottom, with the answer between
  them.
- **The Settings panel is chat-only** (preset, system prompt, "one message at
  a time"), but it is offered in every mode.
- **Passages print raw Markdown and hard line breaks** (`> **Q:**`,
  backticks, ragged 80-column wraps). "Verbatim" was meant to protect the
  words, not the source file's line wrapping.
- **Seventeen tasks in one native `<select>`,** grouped in a way the reader
  never sees on iOS, and the most useful task is missing (F2).

On desktop the layout holds together (see `desk-4-answer`). The problems are
density and ordering, not breakage.

### F7 — Smaller retrieval issues seen on a real document

- Markdown tables become passages whose text is pipes and bold markers. One
  table row was the top hit for "Can Qwen3-0.6B quote a passage?". The right
  row, but hard to read.
- The vocabulary gap is real: "file size **limit**" does not match the
  document's word "**cap**" (`missing: ["limit"]`). The right passage still
  ranked first on the other words. This is the embedder's job; see
  `docs/work-mode.md`. It is not in scope here.

---

## The plan

Ordered so that each step can ship alone, and so that the thing breaking every
phone ships first.

### P0 — Stop the phone crash (hotfix, ship on its own)

1. Move `PLACEHOLDER_FULL` and `PLACEHOLDER_SHORT`, and `esc`, above every
   top-level call. Or make them function-scoped. Then move **every top-level
   side effect** (`restore()`, `syncWork()`, `warmRough()`,
   `init()`, service-worker registration) into a single `boot()` at the end of
   the module, after all declarations. That removes this whole class of
   temporal-dead-zone bug, not just this instance.
2. Register the `submit` handler in the static HTML flow as early as possible,
   and have the form default to `onsubmit="return false"`. Then even a future
   startup throw cannot turn Send into a page reload.
3. **Tests:** every browser test fails on any `pageerror`. Run
   `work-browser`, `sketch-browser` and `failure` under touch emulation
   (`isMobile`, `hasTouch`) as well as desktop. Mutation-check it: put the
   `const` back below the call and watch the touch run fail.

### P1 — Make retrieval something you can ask for

4. **Add an `ask` task and make it the default in Work mode.** It is labelled
   "Ask about it", and the composer placeholder is "What do you want to find
   out?".
   - It always retrieves, even when the document fits whole. The page shows
     the top passages with the answer and says "whole document sent" when it
     was.
   - With a small model, or when there is no query, it generates nothing and
     shows the passages. That is the "the passage is the answer" rule from
     `docs/work-mode.md`, made the default experience.
5. **Give each task a query role:** `search` (ask, explain, summarise-with-focus),
   `instruction` (rewrite, shorten, expand, critique, reply…) or `param`
   (translate → a language). Only a `search` query is passed to
   `findPassages`.
6. **Long document + a non-search task → pick a section, not a refusal.** The
   contents list already exists. Make each entry tappable ("Use this
   section"), and run the task on that section as a whole source. Every
   answer is then checkable against text the reader chose.
7. **Meta-words are not a search.** Strip *summarise, summary, document,
   text, this, says, about, explain, mean* from queries. When nothing is left,
   treat the query as empty, so "summarise the document" gives the contents
   list rather than passages about summarising.
8. **One "does it fit" rule.** Export `fitsWhole(task, text, ctx)` from
   `work.mjs`, and use it in both the planner and the tray. Recompute when the
   model changes.

### P2 — Give the model the room it actually has

9. **Recalibrate `estimateTokens()` for prose.** Start from the trial rule in
   F4, then extend `scripts/token-budget.mjs` to assert "never under" on
   three sets: the repo's docs as prose fixtures, a non-English sample
   (translate needs it), and the existing sketch cases. Ship only if all
   three hold.
10. **Raise the output floor at 1024 context.** Cap retrieved passages at 3
    below 2048 context, and make `MIN_OUTPUT` about 192. An answer cut off
    after 96 tokens reads as "the model failed".

### P3 — Rebuild the layout around the answer

11. **Header on one row at 390 px.** The row holds the status dot, the title,
    a Chat / Sketch / Work segmented control and a `⋯` menu. The menu holds
    the model, settings and Clear cache. The model picker belongs on the load
    card, where it is chosen; after load it is locked anyway.
12. **The document tray collapses to a chip once a document is loaded:**
    `📄 lease.txt · 2,559 words · Change`. The paste box empties into the
    chip instead of holding the whole document. Before a document is loaded,
    the tray is one drop zone ("Paste text or choose a file") styled as a
    button, not the native file input.
13. **Task and question sit together, above the composer:** a row of the 5–6
    most useful tasks as chips (Ask, Summarise, Explain, Rewrite, Reply,
    More…), with the question box directly under them. Nothing Work-specific
    lives at the top of the screen.
14. **Show the Work tray only after the model loads,** or put the load card
    first. The first screen has one thing to do.
15. **Settings are per-mode.** The chat preset and system prompt show only in
    Chat, and in Work and Sketch the button is hidden. That is the existing
    rule "a control that does nothing here is worse than no control", which
    the Work tray already follows.
16. **Passages read as text:**
    - Join hard-wrapped lines inside a paragraph.
    - Render Markdown with the existing escape-first `renderMarkdown()`,
      which is safe and adds no content.
    - Highlight the matched query terms with `<mark>`, so the reader can see
      *why* a passage was picked.
    - Keep the words verbatim. Only the layout changes.
17. **Split tables by row groups,** keeping the header row with every group,
    so a table passage reads as a table.

Target: at 390x844, after an answer, **at least 60% of the viewport is the
conversation**. Today it is about 25%. Add that number as an assertion in the
touch run from P0.

### P4 — Verify against something real

18. **Retrieval bench on a real document.** Add `docs/work-mode.md` and
    `README.md` as fixtures to `scripts/retrieval-bench.mjs`, with 10
    questions each, written *before* running them. Today's numbers come from
    one synthetic policy and six queries.
19. **Answer quality from passages:** run the P1 prompts through Ollama
    (`qwen3:0.6b`, `qwen3:1.7b`) over those fixtures, as `sketch-bench.mjs`
    does for sketches. The quantisation differs from the browser's, so this
    measures composition, not what a visitor's device produces.
20. **One real phone run** once P0 and P3 are live. Record whether "map async
    was not successful" recurs in Work mode at the 4096 rung, which is still
    open in `CLAUDE.md`.

---

## What this plan does not fix

- **The graded refusal** ("this document does not cover that"). BM25 cannot
  produce it, as measured. That remains the embedder upgrade.
- **PDF, and headings the splitter misses.** These are still unsupported and
  unmeasured.
- **Whether a 0.6B model's answer from passages is any good.** P4 measures it;
  nothing here assumes it.
