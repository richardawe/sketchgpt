# Storybook — a short story written by the model, illustrated by the page

The use case: Qwen3-1.7B writes a six-page picture-book story; each page is
planned as a scene list (scene mode) and drawn by the page from Twemoji
illustrations. `scripts/storybook.mjs` writes, `scripts/storybook-render.mjs`
lays out a cover, the pages and a printable standalone HTML file.

All runs: Qwen3-1.7B on Ollama on CPU. About 25 s per book — 12–20 s for the
story, ~2 s a page. Not yet run in a browser.

## What a story exposes that a single sketch does not

Measured across three books (a dog at the beach, a dragon afraid of the dark,
a kitten scared of the rain). Each is fixed on the page, not in the prompt:

| Failure | Example | Page fix |
|---|---|---|
| Example leak on vague pages | "he followed the sound, hopping over stones" came back as the prompt's harbour example, verbatim — 5 of 18 pages | drop example things the page text never mentions; if little is left, read picture names straight from the page's own words ("sun", "sea", "sand") |
| A name read as a thing | a dog called **Ducky** drawn as a duck; "Sir Tink" drawn as a word | drop entries that are part of a character's name |
| A pronoun drawn as a stand-in | "He jumped into the water" on a dog's page came back as a **boy** | drop people the text never mentions when the hero is not a person |
| The hero goes missing | page 2 said "he", not "Max", and Max was not drawn | the main character is on every page, once, as the same picture |
| Duplicated hero | "dog x2" on the last page | the cast is drawn exactly once |
| Things with no picture | "tail", "smile", "digging" | left off the art — the text is right under it |

And three the illustrations needed:

- **A girl was a baby's face** (👶). Girl, boy and child are now standing figures drawn child-sized.
- **"The sun dipped below the horizon" got a midday sky.** Sunset, dusk and evening give a warm sky with the sun low; evening had been read as night.
- **Heroes were small and big things were too big.** "big" / "small" in an entry scale it; big stops at 30 units so a big dragon does not swallow the castle; everything stays inside the frame; the wobble steadies as a picture grows, so a big dragon is not scribbled.

## A story that makes sense: the page's shape, not a second pass

The owner's report from the live page: the stories "are not that coherent".
The obvious fix is a second pass: have the model read its draft and fix it. It
was measured before being built (`scripts/story-pass-bench.mjs`, Qwen3-0.6B on
Ollama, 4 ideas × 2 stories per approach, each scored 0–3 for whether it makes
sense, blind to which approach wrote it):

| Approach | Calls | Score /24 | Made sense | Broken |
|---|---|---|---|---|
| One pass (what shipped) | 1 | 5 | 0 of 8 | 3 |
| Write, then "rewrite it so it makes sense" | 2 | 6 | 0 of 8 | 2 |
| Same shape as advice in the system prompt | 1 | 8 | 1 of 8 | 1 |
| Plan six beats, then write from the plan | 2 | 11 | 4 of 8 | 1 |
| **One line per page saying what it is for** | **1** | **15** | **7 of 8** | **0** |

"Broken" is the same three pages twice, page *titles* instead of text ("The
Cat's Adventure"), or the hero missing. A 0.6B model cannot see what is wrong
with its own story, so a revision keeps every problem. What it can do is fill
in a structure it is handed: meet the hero at home; what they want; they try
and fail; a friend or an idea helps; they try again and it works; an ending
that solves the problem. That is the same rule as the rest of this project:
**the page owns the structure the way it owns continuity.** It costs ~80
prompt tokens and no second call (~210 in + ~250 out, well inside a phone's
1024), and it has to be one line per page: the same shape as general advice
scored 8 and leaked "Each page is short and simple" into the story.

The cost: in 7 of 8 shaped stories the model copied the shape into the text
("Who the hero is and where they live. Lila lives in a small garden.") or
called the hero "the hero". Once, in a spot check, it gave each label a page of
its own, with the hero's name in it ("Who Lila Is and Where They Live").
`unshape()` takes these back out: a leading label is dropped, a page that is
only a label is dropped (the book then says it is short), and "the hero" becomes
the hero's name. A real sentence survives: "A friend helps." is too short to be
a label, and "Pip tries again and it works." has a name in it and is not Title
Case. Names also lose the "(girl)" the model sometimes puts in them.

Caveats: the scores are one person's reading of 8 stories per approach, so
treat them as a direction; the runs are GGUF on CPU, not the browser's build;
and the desktop's Qwen3-1.7B was only spot-checked — one shaped story per idea,
4 of 4 coherent with no labels copied (~205 in + ~300 out). The shape fixes
structure, not sense: on the 0.6B a sea turtle still "helps the dog see the ocean".

## Open

- **Book mode is in the app** (`web/book.mjs`, the default mode), with the
  rules above in `fixPagePlan()` and a test per rule (`tests/book.test.mjs`).
  Phones use Qwen3-0.6B and draw from each page's words; no real GPU has
  written a book yet.
- The stories are simple and sometimes odd ("Pip the Perfectionist"). That is
  the visible kind of failure — a flat story, not a false one.
- Things the illustrations lack (cow is there; a llama is not) are left off.
