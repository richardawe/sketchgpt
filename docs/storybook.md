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

## Open

- **Book mode is in the app** (`web/book.mjs`, the default mode), with the
  rules above in `fixPagePlan()` and a test per rule (`tests/book.test.mjs`).
  Phones use Qwen3-0.6B and draw from each page's words; no real GPU has
  written a book yet.
- The stories are simple and sometimes odd ("Pip the Perfectionist"). That is
  the visible kind of failure — a flat story, not a false one.
- Things the illustrations lack (cow is there; a llama is not) are left off.
