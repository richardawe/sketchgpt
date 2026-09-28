# Book without the model — a plan

**Status: all six stages are built and tested (stages 1–2 live and confirmed on the owner's phone; 3–6 run only in emulation so far). The model-helper buttons are not built. The owner's decisions are at the end.**
"The AI isn't doing much on this app, its story generation is faulty and never
good." The ask: write the story with deterministic rules in the browser; let
people write or paste their own story with the page guiding them; better
scenery for the animation; the reader's own picture in it; and the result
shareable.

## Why the model can go

Book mode already works as the page doing the work, with the model filling one gap:

| Job | Who does it today | Where |
|---|---|---|
| The story's structure (six page jobs) | the page | `SHAPE` in `web/book.mjs` |
| The words on each page | **the model** | `storyMessages()` → `parseStory()` → `unshape()` |
| What each picture shows (phone) | the page, from the page's words | `planFromWords()` / `wordsOnlyPlan()` |
| What each picture shows (desktop) | the model, then corrected by the page | `pageMessages()` → `fixPagePlan()` |
| Continuity: hero on every page, names not things | the page | `fixPagePlan()` |
| Placing, drawing, moving, reading aloud | the page | `scene.mjs`, `sketch.mjs`, `animate.mjs`, `voice.mjs` |
| Opening a shared book | the page, **no model at all** | `share.mjs`, `openShared()` |

Even with the shape handed to it, the best measured result for Qwen3-0.6B was
**15/24, 7 of 8 coherent** (`docs/storybook.md`). It still copies the shape's
labels into the text, which is why `unshape()` exists. It still writes "a sea turtle helps the dog see the ocean". The
owner has now judged the output on real devices and found it not good enough.
The project's rule applies: *prefer deleting a feature to shipping a confidently
wrong one*, and *if the page can compute it, the prompt should not ask for it.*
The page can compute a story.

Taking the model out of Book also:

- **Removes a 350–990 MB download from the default mode.** Book then works on
  any phone, including ones with no WebGPU, the way shared links already do.
- **Probably retires the phone's unexplained "Load failed"** for Book mode (the
  leading guess is a download cut off by the screen locking). It stays open for
  Sketch.
- **Makes Book instant.** There is no generation to wait for, and it is fully
  offline after the first visit, not just once the weights have arrived.

What is lost: surprise. Every template story is one of a finite set. That is
the real cost, and stage 1 measures it before anything ships.

---

## The flow, as a person sees it (decided)

**Nothing downloads when the app opens.** The page opens on the first step,
with no model card and no progress bar:

```
1. Your picture        upload a photo (drawn as a caricature, or cut out), a pet, or a drawing
                       — or skip and pick a kind: dog | cat | girl | boy | dragon | …   + a name
2. Write the book      ( Make one for me )  or  ( I'll write / paste my own )
                       the page writes, splits and checks — no model
3. Check it            page by page: the words, and what will be drawn on each page
4. The book            drawn, moving, read aloud — Share · Edit · Save
```

Steps 1–4 need no model, so they work on any phone, offline after the first
visit, with no download. The image is only ever processed in the tab.

**The model downloads only when someone asks it to write.** Every model
feature sits behind its own button. The first tap says what will happen before
anything starts: "This downloads a writing helper once (~350 MB on this phone),
then works offline. Download?" After that, it loads from the cache. The
buttons:

| Button | Where | What the model does | What the page checks |
|---|---|---|---|
| **Ideas for what happens next** | while writing your own | three suggestions, from the person's own text | nothing to check: the person picks one or ignores them |
| **Things to draw here** | a page with nothing drawable | suggests picture words for that page | only words that have a picture are offered |
| **Say it differently** | a rule-written or own page | rewrites one page | kept only if the names, drawn words, actions and "not"/"never" survive (`checkRewrite`); otherwise the original stays and the page says why |
| **Draw anything** (Sketch mode) | Sketch | names the things in a free request | the existing scene rules |

`?manual=1` and the storage-aware model pick stay. The pick now happens at
the first tap, not at page load. Save-Data still asks first, and that question
now covers every download.

What leaves the page: the model card as the first thing a visitor sees, the
auto-download on open, and `runBook()`'s model-written stories.
`scripts/story-pass-bench.mjs` and `book-bench.mjs` keep the story prompt for
benching.

---

## Part 1 — A story written by rules (`web/story.mjs`, new, pure)

### Shape

The six page jobs stay exactly as `SHAPE` defines them: at home → wants → tries
and fails → help → works → ending. Each job is a **slot**, and each slot has
several sentence patterns. Picking a pattern and filling it is the whole
generator. This is a story grammar in the style of
[Tracery](https://github.com/galaxykate/tracery) (Apache-2.0). It is small
enough to write directly rather than vendor (about 200 lines plus word lists),
so there is no dependency and nothing new to review for logging.

### What the person picks, and what the rules fill

| Choice | Offered as | Example values |
|---|---|---|
| Hero kind | chips (only kinds with an illustration, plus "me") | dog, cat, rabbit, bear, fox, owl, duck, dragon, unicorn, dinosaur, girl, boy, me |
| Hero name | text, with a suggestion per kind | Pip, Luna, Max |
| Place | chips | garden, forest, beach, farm, town, snowy hills, castle, home |
| Wish or worry | chips, filtered to fit the place | see the sea, find a lost ball, make a friend, be brave in the dark, fly, grow a flower, get home before the rain |

The rules then choose from lists that are **keyed to the place and the wish**:
a helper (an owl in the forest, a crab on the beach, a hen on the farm), an
obstacle (a river, a tall wall, the dark, the wind) and a way through it (a
bridge of stones, a lantern, a ride on a kite). A seed makes the choice. The
same choices and seed give the same book on every device. **"Another version"**
changes only the seed.

### Rules the word lists must obey

These come straight from findings already in `CLAUDE.md`:

- **Every concrete noun in a template is in `ART_NAMES`** (493 words), so every
  picture draws. A unit test walks every template and fails on any noun
  without a picture. The model could never promise this.
- **No drawable feelings.** Templates avoid the `ABSTRACT` words (happy, love,
  friend…) where a thing is meant, because they drew an emoji face, a heart and
  a stand-in child.
- **Deeds match `animate.mjs`.** The "tries" and "works" pages use verbs that
  `pageActions()` acts out (jumps, flies, swims, runs, looks), and the "wants"
  page uses wish words that it deliberately does *not* act out. The animation
  then tells the same story as the words.
- **The hero is named on every page**, not "he" or "she" (pronouns are fine
  after the name within a page). The continuity rules then never have to guess.
- **Two or three short sentences a page**, well under the share link's 600
  characters.
- **Pronouns follow the kind**, or use "they" when the person does not say.
  The generator never guesses a person's gender from a name.

### An illustration of the target (hand-written here, not generated)

> **Pip and the Big Blue Sea**
> 1. Pip is a little dog who lives on a farm with a red tractor.
> 2. Pip has never seen the sea, and wants to see it more than anything.
> 3. Pip runs down the road, but a wide river is in the way. Pip cannot cross.
> 4. A duck swims up. "Hop on the stones," says the duck.
> 5. Pip jumps from stone to stone, and there is the sea, with boats and big waves.
> 6. Pip splashes in the waves, then runs home to tell the cow all about it.

Every noun in it is meant to have a picture or a setting, and every deed is
one the animation acts out. **Checked against today's code, it does not yet
work**: `planFromWords()` on that text drew only *sea, boat, tractor, stone*.
Three gaps turned up:

- **`river` and `road` are not read from a page's words.** `SETTING_WORDS` in
  `book.mjs` lacks them, although `scene.mjs` knows both as settings. `farm`
  maps to a tractor, which is fine.
- **`lighthouse` resolves to `lightbulb`.** This is the prefix matcher again,
  the same class of bug as "fairy" drawn as a ferris wheel. It is live
  today wherever a scene list says lighthouse, including the scene prompt's
  own harbour example on desktop. It needs a fix whatever happens to this plan.
- **`window` resolves to `app-window`**, a UI icon. The indoor backdrop must
  draw its own window, and the word should not be a stamp.

The stage 1 test (every template noun draws) exists to catch exactly this.

### Measure before shipping, like every change here

`scripts/story-pass-bench.mjs` already scores stories 0–3, blind. The plan is to
run it on 8 rule-written books against the 0.6B's shaped stories and a few
1.7B ones. "Coherent" is expected to be 8/8 by construction. What is uncertain
is **sameness**: a second question in the scoring asks "have you read this one
already?" across 8 books from the same choices. If sameness is bad, the fix is
more patterns per slot, not the model.

### Stage 1 as built

`web/story.mjs` has 17 hero kinds (including "me"), 7 places, 6 wishes (see the
sea, find something lost, make a friend, be brave in the dark, fly, grow a
flower), 11 problems and 29 helpers. `writeStory(choices)` returns the book,
plus the words each page marks to be drawn, so the tests can hold the page to
them. Nothing in the app calls it yet; wiring it in is stage 2.

**Checked for every combination** (`tests/story.test.mjs`, 119 hero × place
pairs, every wish that fits, 12 seeds each, 7,800 books, under 4 s). Each
check is mutation-tested: break the rule and the test fails.

- 6 pages, each within the share link's limits, the hero named on every page.
- **The picture draws exactly the marked words.** Unmarked words that would
  have drawn something were caught this way: "waves at the others" → a sea,
  "one night" → a moon, "plants the seed" → a plant, "at home" → a house,
  "dancing" → a dancer, "tea" → a cup.
- Every marked word has a picture, and no picture is the hero alone.
- The helper can do what the problem needs, lives in that place, and is
  never the hero's own kind. The hero cannot solve the problem alone: a dog is
  not stuck at a river, and a dragon never wishes to fly.
- The animation acts out deeds, never wishes. The hero acts on page 3 (tries)
  and page 5 (works), and never on page 2 (wants).
- Same choices and seed, same book. A rule book survives a share link.

**Measured** (`scripts/story-rules-bench.mjs`), against the four real Qwen3
books in `scripts/demo-books/` written with Book's own prompt:

| | Books | Pages naming the hero | Pictures of only the hero | Stray drawings |
|---|---|---|---|---|
| Qwen3 (0.6B phone ×2, 1.7B desktop ×2) | 4 | 21 / 24 | 4 | not countable |
| Rules | 32 | 192 / 192 | 0 | 0 |

| Idea | Versions from one set of choices (1000 seeds) | Identical pages, average pair of 8 books |
|---|---|---|
| a little dog who has never seen the sea | 278 | 0.4 of 6 |
| a young dragon who is afraid of the dark | 355 | 0.5 of 6 |
| a girl who plants a magic seed | 837 | 0.5 of 6 |
| a robot who wants a friend | 910 | 0.2 of 6 |

**What those numbers do not say:** identical *pages* are rare, but the frames
repeat ("Just then, Owl…", "jumps for joy", "safe and sound"). Someone who
reads five books from the same choices will notice. That is the sameness to
judge by reading, and the reason "Say it differently" stays on the list.

**The blind read was skipped.** The owner found the sheet too long to score
and said to go ahead (`docs/story-rules-bench/read.md` is kept for anyone
who wants to). The only reading on record is the author's, which is not blind:
the rule books make sense page to page, and the four model books include one
that repeats "safe and happy" for six pages and one whose last two pages say
nearly the same sentence. The first real test is the owner reading a book on their
phone.

**Found on the way, and fixed for every book, not just rule books:**

- `lighthouse` was drawn as a **light bulb**, the prefix matcher again.
  A compound of two known words is now the kind of thing its last word is
  (lighthouse → house, starfish → fish), unless the first word already names
  a kind of the second (pinetree → pine). Phrases that scene.mjs runs
  together ("cake on table") keep their first word.
- **"buses", "bushes", "foxes" never drew**: `planFromWords` stripped only
  the "s". `-es` plurals are now tried too.
- **River, lake, pond, road and street** in a page's words are now drawn as
  its setting (water or road). A page saying "a wide river is in the way" drew
  nothing before.
- Two traps for any template, kept out of the word lists: a **teddy is drawn
  as a bear**, so a bear hero's lost teddy vanished into its own picture; and
  a helper named "Bird" takes the word "birds" as its name, so a flock of
  birds went undrawn.

### Stage 2 as built

- **Opening the app downloads nothing.** WebLLM used to be awaited at the top
  of `browser.html`, before anything ran. It is now fetched only when a model
  is wanted, and so is the device and model setup (`prepareModel()`). Book
  never calls either. `tests/book-browser.mjs` counts requests for the library
  and fails on any from Book (mutation-checked by loading it at startup again).
- **The builder is Book's first screen:** 1 · Your hero (the photo link, or
  the reader's drawing already chosen if they brought one; 16 kinds; a name),
  2 · Where they live, 3 · What they wish for (only wishes that fit), then
  Write. Anything left on "Surprise me" is picked so the wish fits. The
  builder stays at the top; each press is a new book. `?seed=N` makes books
  reproducible, for tests and recorded demos.
- **A phone with no WebGPU makes books.** The no-GPU message used to replace
  the whole page. Now it shows only in Sketch, and Book carries on
  (mutation-checked).
- **The privacy meter runs from page load** in Book ("0 requests since the
  page loaded"), and restarts when a model loads. It ignores the page
  re-fetching its own files for the offline cache. Without that, a first visit
  showed `sketch.mjs`, `scene.mjs` and `book.mjs` as requests (caught by the
  offline test, mutation-checked).
- **Offline:** after one visit, a whole book is written and drawn with the
  network down (`tests/offline.mjs`).
- **The model's place now:** Sketch, which downloads it when opened (with the
  old rules: cached, or not `?manual=1` and not Save-Data), and "Rewrite with
  the model" in the book editor. That button is disabled until Sketch has
  loaded the model. `runBook()` and the model-written story are gone from the
  page; `book.mjs` keeps the story prompt for the bench scripts.
- **Tests rewritten** for the builder: book, share, animate, me, offline,
  failure, stop, sketch and scene. The stop test now runs in Sketch, the only
  place a model still streams.

**Not tested on a real device:** everything above ran in headless Chromium
with touch emulation. Unknown: how the builder reads on the owner's phone, and
whether 17 hero chips are too many on a small screen.

---

## Part 2 — Your own story, with the page as a guide (`web/story.mjs`)

For someone who writes or pastes a story (a bedtime story, something a child
made up, a family trip).

### Splitting into pages

- 2–8 paragraphs: one page each.
- One block of text: sentences grouped into about six pages of 2–3 sentences,
  never breaking a sentence.
- More than 8 pages' worth: the page says so and offers to keep the first 8.
  `share.mjs` caps books at 8 pages and 600 characters a page. It never cuts
  silently.
- A short first line with no full stop is taken as the title, and shown so the
  person can change it.

### Who the hero is

The person is **asked**, with the name and kind pre-filled from the text when a
pattern is certain ("a dog named Max", "Max the dog", "Max was a little dog").
It is never a silent guess. The same page-owns-continuity rules then apply:
the hero appears on every page, a name is not drawn as a thing (Ducky the dog
is not a duck), and a kind with no picture gets a stand-in (`STAND_IN`).

### The guide: the page checks what it can check mechanically

Shown live under the text box, page by page, before anything is drawn. It uses
`planFromWords()`, which already exists:

| Check | What the person sees |
|---|---|
| What will be drawn | chips: *farm · tractor · duck* |
| Nothing to draw | "Page 3 has nothing to draw. Where is Max? (a place word helps: beach, forest, kitchen…)" |
| Words with no picture | "No picture for *llama*, so it stays in the words." |
| Hero never named | "Max is not named on pages 2–4; Max is still drawn on them." |
| Too long to share | "Page 5 is 710 characters; links hold 600. Split it?" |

This is the `checkRewrite` idea from Desk: the page cannot tell whether the story
is good, but it can make every mechanical failure visible before drawing
instead of after.

The person's words are **never rewritten**. The rule stands: the page corrects
the model, never the person. The guide suggests, and the person edits.

---

## Part 3 — Better scenery (`web/scene.mjs`, `web/sketch.mjs`, `web/animate.mjs`)

Today every picture sits on one of four skies (day, night, dusk, rain) over
flat grass, sand, water or a road (`drawBackdrops()`). Four gaps are visible in
any book:

### 3a. The setting carries from page to page (the biggest win)

Each page is drawn alone today. If page 3 says "beach" and page 4 does not, page
4 is back on grass. Plan: a book-level setting, worked out **from the words
alone, in page order**. A page's own setting words win. A page without any
keeps the previous page's setting. Because it comes from the text, a shared
link rebuilds it exactly, with **no change to the link format** (still `v: 1`)
and no extra bytes. `pack()`'s "list equals what the words give" check keeps
working if the carried setting is added at draw time, not stored in `things`.

### 3b. New backdrops, all hand-drawn on the page (no new assets)

| Backdrop | Triggered by | Drawn as |
|---|---|---|
| hills | farm, field, meadow, countryside, park | two layered rolling bands behind the ground |
| forest | forest, woods, trees | a far treeline band, darker, behind the ground |
| snow | snow, winter, ice, snowy | white ground, pale sky, falling flakes |
| town | town, city, street, village | a far skyline of simple buildings with lit windows at night |
| room (indoors) | bedroom, kitchen, inside, bed, sofa, bath | wall and floor washes, a window showing the carried time of day, the page's own bed/lamp/sofa illustrations (all in `ART_NAMES`) |
| sky details | always | soft clouds in a day sky, scattered stars and a moon glow at night, low sun at dusk (partly exists) |

These are washes and ink lines in the same style as today's backdrops, drawn
with rough.js, so they cost no download and match the Twemoji illustrations.
[Kenney's background packs](https://kenney.nl/assets/background-elements-redux)
are CC0 and were considered, but their flat game-art style would clash with the
ink-and-wash look. That is the same reason Lucide lost to Twemoji. Keep them
as a fallback idea only.

"At home" stays outdoors (a house). Only explicit indoor words go inside, so
"Lila lives in a small house" still shows the house.

### 3c. Depth when it moves

Each backdrop layer gets a `data-layer` (far / middle / ground). The camera
move `animate.mjs` already makes (slow zoom toward the hero) moves far layers
less than near ones. The result is parallax, done with the same whole-element
transforms that already run. Day clouds drift and snow falls, using the existing
`drift` and `twinkle` kinds. Reduced motion still means no motion.

### 3d. What to check

- `tests/scene.test.mjs` pins composer output, so new backdrops need new
  expected output. It is also a chance to add a test per trigger word.
- Seeded: the same page gives the same picture on every device (already
  true, and it must stay true for share links).
- Phone cost: more SVG nodes per page. Measure paint time for a six-page
  book in headless Chromium at 390px before and after. Real Safari smoothness is
  still unknown, as it already is for animation.

---

## Part 4 — The reader's own picture

### What exists

`web/selfie.html` ("Draw me") turns a photo into a moving hand-drawn
caricature on the device, and "Star in a book" makes the reader the hero on
every page, blinking. The photo is never sent or stored. **It has never run on
a real phone.**

### What changes

- **It becomes step 1 of the flow**, not a link in the intro. "Use my photo"
  opens the same selfie page and comes back with the drawing, as it does today
  via `#me=`, with "me" pre-selected as the hero kind.
- **Option to decide: a cut-out of the real photo** instead of (or beside) the
  caricature. The person-segmentation model is already vendored. A cut-out is
  instantly recognisable, but it is the person's real face in every exported
  file, and it cannot fit in a link.
- **Pets and drawings:** "any picture as a character" (a child's drawing of
  their cat) would be the cut-out path without face detection. It is simpler
  than the caricature, but has not been researched further.

### Sharing a face (the decision that matters)

| Option | Link size | Privacy |
|---|---|---|
| Today: the link says "me"; recipients see a stand-in child | ~1–1.5 KB | nothing about the face travels |
| Opt-in: the caricature's *data* in the link (planned in `docs/selfie.md`) | + a few KB (unmeasured) | the drawing's numbers travel in the fragment, never reach a server, but anyone with the link can redraw it |
| Export only (GIF / video / HTML file) with the face | n/a | the person chooses where the file goes |

Recommended: the default link stays faceless; a clearly labelled "Include my
drawing" switch adds the caricature data; files carry the face. Never the
photo, never a cut-out, in a link.

---

## Part 5 — Sharing the animation

| Form | State | Notes |
|---|---|---|
| Link | **exists** | Redraws and animates the book on the recipient's device; no model; works without WebGPU. |
| Download (one HTML file) | **exists** | Still pictures; could carry the animation code inline too. |
| GIF per page | new, cheap | `gifenc` (MIT) is already vendored for selfie. Good for sending one page in a chat. |
| Video of the whole book | new, bigger | WebCodecs `VideoEncoder` plus [Mediabunny](https://mediabunny.dev/guide/introduction) (MPL-2.0, the successor to the deprecated `mp4-muxer`) to write an MP4 in the tab. |

Two constraints found in research:

- **The read-aloud voice cannot be recorded.** `speechSynthesis` produces sound
  outside the page's audio pipeline, and no spec gives a page access to it
  ([addpipe](https://blog.addpipe.com/a-deep-dive-into-the-web-speech-api/),
  [recording web speech synthesis](https://tonyedwardspz.co.uk/blog/recording-web-speech-synthesis)).
  So exported video is **silent with the words as captions**. The rejected
  Kokoro voice (11–15 s per 4–5 s of speech, 92 MB) is the only in-tab way to
  get audio into a file. Not recommended.
- **Frames need the animation as a function of time.** The pictures move with
  the Web Animations API on live SVG. To encode frames, `animate.mjs` has to
  be able to say "where is everything at t = 1.2 s" and render that SVG to a
  canvas frame by frame. That is a real refactor of `animate.mjs`, which is
  why video is last. WebCodecs support on iOS Safari has to be checked on the
  owner's phone before building on it.

---

## Stages, each small enough to review alone

| Stage | What | Done when |
|---|---|---|
| **1. Rules** | `web/story.mjs`: the generator and its word lists; a unit test that every template noun draws and every book is 6 pages under 600 chars; blind bench against the model's stories | bench scored; the owner reads 5 books |
| **2. Book without the model** | builder UI in Book's intro (hero → story → check → book); no auto-download in Book mode, model only for Sketch (and "Rewrite with the model" in the editor, disabled until loaded); cover credit "Written by you" or "Made by sketchgpt's story rules"; four browser tests rewritten to go through the builder; `story.mjs` added to `pages.yml` and `sw.js` `SHELL`; `?v=` bumps | tests pass on touch and mouse; the owner's phone opens Book with no download |
| **3. Paste your own** | page splitting, hero questions, the live guide | a guide row per check above, each mutation-checked |
| **4. Scenery** | setting carry-over, five backdrops, parallax layers | composer tests per trigger; a before/after screenshot set; paint time measured |
| **5. Me as hero, front and centre** | selfie as step 1; opt-in "Include my drawing" in links | selfie run on the owner's phone (owed anyway) |
| **6. Export** | GIF per page first; video only if GIF is not enough | GIF made and shared from a real iPhone |

What changes elsewhere (for the stage that touches it):

- `web/browser.html`: `runBook()` leaves Book mode. `showBook()` is unchanged,
  since it already draws any book from data. `init()` stops auto-loading while
  in Book mode.
- `web/book.mjs`: the story prompt functions stay for the bench scripts, and
  `planFromWords`, `fixPagePlan` and `castAsMe` are reused as they are.
- `tests/book-browser.mjs`, `animate-browser.mjs`, `share-browser.mjs` and
  `me-browser.mjs` all write their book through a stub model today and need to
  go through the builder instead.
- `CLAUDE.md`: a findings row once stage 1 is measured, and the Book entries
  in the open threads.

## Stages 3–6 as built

**3 · Write or paste your own.** "Write my own" in the builder. `splitPages()`
makes paragraphs into pages when there are 2–8 that fit, and otherwise groups
the sentences into about six pages, never breaking one. A short first line
with no full stop is the title. More than a book holds keeps the first eight
pages and says so. `guessHero()` reads "a dog named Max", "Max the dog" and
"Max was a little dog", and picks the one the story names most, so "a robin
called Rosie" once does not become the hero of Max's story. The guide under
the box lists each page and what it will draw, flags pages with nothing to
draw, and names pages that never mention the hero. The person's words are
kept exactly: a unit test joins the pages back together and compares them.

**4 · Scenery.** The page's words now choose among hills (farm, field,
park), a far treeline (forest, woods), snow on the ground, a town skyline,
and a room (bedroom, kitchen, "in his bed") with a window showing the sky.
Day skies get drifting clouds and night skies stars. Indoors there is no sun,
bird, house or bus: "went home to his warm bed" had drawn a house on the
bedroom floor. "Snow" is snowy ground, no longer a snowman. `placeOf()`
carries a page's place to the next page that names none. A place inside a
wish ("wants to see the sea") does not carry, because nobody is there yet.
The book says so under each carried picture ("Still at the farm, like the
page before"). Far layers move less than the camera, which gives depth.

**5 · Your picture.** "Use a picture" in step 1 accepts a pet, a child's
drawing or a photo, and prepares it in the tab (`web/picture.mjs`) in one of
three ways:
- A drawing loses its paper. This is a flood fill from the border, so a white
  inside an outline stays white.
- A photo can have its person cut out, using the person segmenter
  `selfie.html` already vendors. That downloads about 13 MB from this site the
  first time, and the privacy meter lists those files.
- Anything can be kept as it is, with rounded corners.

The picture replaces the hero's illustration on every page and the cover. The
page asks what the picture is before writing. It is kept for the tab only
(sessionStorage) and never goes in a link: the recipient sees the drawn hero,
and the share note says so. The caricature can go in a link when the reader
ticks "Put my drawing in the link": 7.9 KB against 0.6 KB for the same book
without it.

**6 · Export.** "Save this page as a GIF" is in the ⋯ menu (`web/gif.mjs`).
Every animation is paused and stepped through time, each element's computed
pose is copied onto a copy of the SVG and drawn to a canvas, and gifenc
encodes the frames. The page's words go underneath. A page takes about 0.6 s
and about 220 KB in headless Chromium. On a phone the GIF goes to the share
sheet, elsewhere it downloads. It is silent, and the book says so. Video was
not built: GIF covers "send a page", and a silent video adds little.

**Tests added:** `tests/story.test.mjs` (splitting, the hero guess, the
guide), `tests/scene.test.mjs` (each backdrop trigger, the room, `placeOf`
and wishes), `tests/picture.test.mjs` (the pixel rules),
`tests/picture-browser.mjs` (a drawing and a photo, the ask, the link), and
additions to `book-browser` (own story), `animate-browser` (carry-over, depth,
GIF) and `me-browser` (the opt-in link). Mutation checks:
- the guide's "nothing to draw" row;
- the picture drawn as the hero;
- the drawing staying out of links;
- the offline cache's own re-fetch not being counted by the privacy meter.

**Not tested on a real phone:** everything in stages 3–6. Unknowns:
- Safari's `createImageBitmap` orientation handling for phone photos.
- LiteRT's person segmenter on an iPhone (the same unknown as `selfie.html`).
- GIF time on a phone CPU.
- Whether `navigator.share` with a GIF file opens the share sheet on iOS.

## After stage 6: richer backgrounds, a second picture library, video

The owner, after trying stages 3–6: "The background is still basic, add
more… add more image libraries and have the option to make this a video and
not a gif."

**A second library.** Fluent Emoji's Flat style (MIT, © Microsoft) now sits
beside Twemoji in `web/art.mjs`, built by the same script. It adds 53
pictures: 33 animals Twemoji's list lacked (llama, otter, flamingo, panda…)
and set dressing (potted plant, framed picture, log, fern, coral, nest,
ladder…). It never takes a word Twemoji draws: all 225 existing pictures and
every word mapping came out byte-identical. The bundle grew from 345 to
510 KB (192 KB gzipped). Kenney's CC0 background packs were the first choice,
but they can only be downloaded through a manual click-through, so they
cannot be fetched by a script.

**Richer backgrounds**, all drawn on the page:
- **Skies:** gradients with a glow where the light comes from.
- **Open country:** a distant mountain range, snow-capped in snow.
- **Farms:** patchwork fields, a winding path and a fence.
- **Forests:** two rows of trees.
- **Towns:** roofs, windows lit at night, a pavement and street lamps.
- **Sea:** a gradient, light on the water, and surf on the sand.
- **Grass:** deepens toward the front and has wild flowers.
- **Snow:** drifts.
- **Time of day:** night and dusk fall on the ground too.
- **Indoors:** a painted wall, skirting board, floorboards and a rug.

`scene.mjs` also dresses each place with a few small props: a barn and
sheaves, mushrooms and a log, a palm and shells, pictures on the wall. The
props are chosen by the place, so every page set there has the same ones.
They sit behind the story's things, are fewer on a busy page, and are never
animals or people.

Two catches found on the way:
- **Props must never go round nothing.** An empty plan dressed with props
  looked like a picture, which would have hidden a model that drew nothing in
  Sketch. A test caught it.
- **Twemoji's "lamp" is an oil lamp (🪔),** and it floated over the hero like a
  flame, so rooms don't use it.

**Video.** "Save the book as a video" (`web/video.mjs`) makes the cover, every
page moving with its words, and The End, at 540×720:
- Frames are stepped the way the GIF steps them, with the camera kept and
  pages fading in.
- They're encoded in the tab with WebCodecs through Mediabunny (MPL-2.0). Only
  its MP4/WebM writer is bundled: tree-shaken to 219 KB, loaded only when
  asked, and it makes no network requests.
- The output is MP4 (H.264) where the browser can encode it, else WebM (VP9).
- Headless Chromium here has no H.264 encoder, so the test covers WebM: a
  30.5 s, 0.8 MB video, made in about 16 s on this CPU and played back at
  540×720.
- It is silent.

**Not tested:** the MP4 path (any real Chrome, Edge or Safari); how long a
video takes on a phone; whether iOS shares an MP4 to Messages or WhatsApp
from the share sheet.

## Not known, and how each gets known

- **Whether rule stories feel repetitive:** the stage 1 blind read, then the owner.
- **Whether the new backdrops stay smooth on an iPhone:** only the owner's phone
  can say. The same unknown already exists for animation.
- **Caricature-data link size:** measure `encodeMe()` output on the fixture photos.
- **WebCodecs on the owner's iPhone:** a one-page probe before stage 6.

## Decisions made by the owner

1. **The model leaves Book mode.** Book writes with rules or with the person.
   The model is a helper behind buttons, never on the path to a finished book.
2. **Pictures:** the caricature **and** a cut-out of the real photo; pets and
   drawings are allowed too.
3. **Links can carry the drawing** when the person switches it on. The default
   link stays faceless. The photo itself never travels in a link.
4. **No download on opening the app.** The page asks for a picture, then helps
   write the book. A model downloads only when someone taps a button that needs
   it to write.

Build order starts with stage 1 (rules). The helper buttons come after stage 3.
"Say it differently" is built only if its bench (Ollama, 0.6B and 1.7B: how many
rewrites pass the check, and whether blind readers find the books less alike)
beats the rules alone.
