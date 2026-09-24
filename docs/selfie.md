# Selfie mode — a plan

**Status: researched, nothing built. Direction decided by the owner:** someone
picks a photo of themselves, and the page draws them as an **animated cartoon**
in the book's own ink-and-wash style. Nothing is uploaded; everything runs on
the device. The rhyme from the first version of the idea is parked (see the
end).

---

## The one-line design

**Measure the face, then draw a cartoon from the measurements.** MediaPipe
finds 478 points on the face. The page reads a few dozen numbers from them
(face shape, eye size and spacing, nose, mouth) and samples a few colours from
the photo (skin, hair, eyes, lips, clothes). It then draws a character from
those numbers and colours, the way it already draws a book's pictures from a
list of nouns.

No generative model draws anything, and there is no LLM in this mode at all.
The page owns the drawing, so it owns the animation too: every part (eyelids,
irises, brows, mouth) is a separate piece it can move.

This follows the rule that keeps paying here: *if the page can compute it,
don't ask a model for it.* Naming a noun was the easy half of a sketch;
drawing it was the page's job. Here the measuring is MediaPipe's job, and the
drawing is again the page's.

## Why this option, of the three researched

| Option | Verdict |
|---|---|
| **Drawn cartoon from landmarks** | **Build this.** It needs a ~5 MB detector and no LLM, and it runs on a phone with no WebGPU. Its output is plainly a drawing, so it cannot be mistaken for real footage of anyone. That removes most of the misuse question the photo-warp version had. It also lets you be the hero of your book. |
| Neural "cartoonize" filter (AnimeGANv2 8 MB, White-box Cartoonization 1.5–6 MB) | Rejected: both are **non-commercial only** (White-box is CC BY-NC-SA; AnimeGANv2 needs a letter from the authors), and they take 5–10 s per image without a GPU. |
| Warp the real photo (blink, smile, talk) | Rejected by the owner in favour of the cartoon. The first draft of this plan was built around it, and its privacy and failure notes are kept below where they still apply. |

A classic non-AI "toon filter" (flat colours plus ink edges, WebGL, zero
download) survives as a **fallback** when there is no face to measure: a pet,
a landscape, the back of a head.

---

## Pipeline, all in the tab

### 1. Photo in
Use `<input type="file" accept="image/*">`. On phones this already offers the
camera, so there is no `getUserMedia` and no permission prompt. Decode with
`createImageBitmap`, which applies EXIF rotation, so a phone photo is not
sideways. Downscale to ~512 px on the long edge **before** anything else. A
12 MP photo decoded at full size is ~48 MB of pixels, and exceeding memory
kills a tab on an iPhone with no catchable error.

### 2. Measure (MediaPipe, Apache-2.0, vendored into `web/vendor/`)
- **Face Landmarker**, `IMAGE` mode, CPU delegate. It runs once, so the GPU
  gains nothing and would compete with WebLLM for the device. It returns 478
  3-D points including the irises, 52 expression scores and the head pose.
  **3.76 MB**.
- **Hair segmenter**: a mask of which pixels are hair. **0.78 MB.** Landmarks
  stop at the hairline, and hair is the most recognisable thing about most
  people in a cartoon. Without it every character would be bald or wear a
  guessed wig.
- **Selfie segmenter**: person vs background. **0.25 MB.** It tells the page
  where the clothes are (person, below the chin) without guessing.
- One shared runtime: `@mediapipe/tasks-vision`, SIMD wasm **11.8 MB**
  uncompressed (a no-SIMD build, 11.0 MB, ships in the same package), plus
  ~0.3 MB of JS. Measure the gzip transfer before quoting it.

All of this loads by dynamic `import()` only when someone picks a photo.
Nobody else downloads it.

### 3. Turn measurements into a character (`web/face.mjs`, pure functions)
All numbers are normalised by the distance between the eyes, so photo size
and distance from the camera drop out. The head pose is used to un-tilt the
points first.

| Part | From | Drawn as |
|---|---|---|
| Head shape | jaw outline: width at cheekbones vs jaw vs chin, face length | a rounded outline through ~8 jaw points, smoothed |
| Eyes | eye-corner and lid points; iris points 468–477 | whites, an iris in the sampled eye colour, a lid line |
| Brows | brow points; darkness sampled above them | a brush stroke with thickness taken from the photo |
| Nose | bridge length, nostril width | one or two ink strokes, never a full outline |
| Mouth | corners and lip points; lip colour | resting mouth, plus a set of mouth shapes for animation |
| Hair | hair mask → outline → simplified to ~30 points | a filled shape behind and in front of the head, in the sampled hair colour |
| Skin, clothes | median colour of cheek pixels (away from highlights) and below the chin | head fill, and a simple shirt shape |
| Glasses, beard | **not in version 1** | See failures below. Named honestly rather than guessed. |

**Likeness comes from exaggeration, not accuracy.** This is the classic
caricature method (Brennan's caricature generator, 1985): compare each
measurement to an average face and push it a little further from average
(×1.3–1.5). MediaPipe ships a canonical average face with the model, so the
average is free. A cartoon drawn at exactly average proportions looks like
nobody. The exaggeration is what makes it look like *you*.

**Colours are snapped to a palette the page owns**, the same way sketch
colours are. That applies to skin, hair and eyes. It keeps the cartoon in the
book's style, and a dark photo cannot produce a muddy grey person. The skin
palette must span the full range of real skin tones, and the snap must never
lighten or darken a tone to reach a "nicer" swatch. This is a test, not a
hope: see the fixtures below.

### 4. Draw
The character is SVG, drawn with the vendored rough.js and the book's ink
settings, so it sits on a page next to Twemoji-based pictures without looking
pasted in. Each part is its own group with a `data-part` attribute, the same
way `renderSketch` tags things with `data-thing`.

The output is also a **small data object**: ~25 numbers, 6 palette names and
one ~30-point hair outline. It is not an image. That matters twice:
- `tests/face.test.mjs` can check it without a browser.
- It is small enough for a share link (see privacy).

### 5. Animate
`animate.mjs` already moves pictures by what they are. The cartoon adds a
character that can move its face:
- **Idle loop:** blinks every 3–6 s at random, eyes glance around (the irises
  move), slight head bob, breathing.
- **Expressions:** smile, surprise (brows up, mouth round), sleepy, laughing.
  These are drawn mouth and eye shapes the page swaps between, not warps.
- **Talking while the book is read aloud:** the mouth cycles through 3–4
  open shapes while `voice.mjs` is speaking a sentence, and rests between
  sentences. There are no visemes, because Safari's word timing is
  unreliable. That was already found in `voice.mjs`, and cartoon flapping
  reads fine anyway.
- **Book actions:** once the cartoon is the hero, `pageActions()`
  ("jumps", "swims") moves the whole figure as it moves the stand-in today.

### 6. Where it lives
- **Start standalone behind `?selfie=1`**: pick a photo, see yourself drawn
  and moving, then try "Redraw" (same measurements, new wobble seed) or "Try
  another photo". It can be measured alone and has no model download.
- **Then as Book's hero:** "Use my cartoon as the hero". `cast[0]` is drawn
  as the cartoon (head on a simple body in the clothes colour) on every page,
  replacing the stand-in person. The page already owns continuity ("the hero
  on every page as the same picture"), so this is a drop-in at exactly that
  point.

### 7. Deploying it (lessons already paid for)
- Add `face.mjs` and the `web/vendor/` files to the workflow's copy list.
  `tests/deploy.test.mjs` reads dynamic imports, so it will catch a missing
  file.
- Bump `?v=N` and the worker's `VERSION`. The worker deletes only
  `sketchgpt-*` caches, so visitors' model weights survive.
- Check that offline works after one visit, with the vendored wasm and models
  in the worker's cache (`tests/offline.mjs` pattern).

---

## Privacy: the whole point, so the page must say it and keep it

- **The photo is never uploaded.** Say so next to the button. The privacy
  meter already counts requests, so it can prove it.
- **The photo is never stored**: no localStorage, Cache API or IndexedDB. The
  bitmap is dropped as soon as the character is made, and "Forget" clears the
  character too.
- **The share link never carries the photo.** It can carry the *cartoon*
  (the small data object above, <1 KB), but only when the person chooses to
  include it; the default link uses the stand-in hero. A cartoon is not a
  photo, but it was made from someone's face, so including it is their call.
- Measurements live in memory, and the page never compares faces or
  identifies anyone. That keeps it on the simple side of biometric-data law
  (BIPA; GDPR special-category data). **This is a design note, not legal
  advice.** Check before promoting it to an audience of children, and the
  book is a children's format.

## Failures the page must show, not hide

| Case | What the page does |
|---|---|
| No face found | Say "No face found. Try one facing the camera, in good light". Offer the toon-filter picture as a consolation, labelled as such. |
| Several faces | Draw the largest face and outline it on the photo, so it is visible which one was picked. |
| Head turned past ~30° | Draw it anyway (the pose is un-tilted), and say the result works best facing forward. |
| Glasses, beard, hat, headscarf | Version 1 does not draw them. Say "Glasses aren't drawn yet" rather than silently dropping them. Glasses are the first addition, because the landmarks already locate them and the fixtures will show how often it matters. |
| Hair mask empty or noisy (bald, hat, busy background) | Draw no hair, or a short default, and say which. Never invent a hairstyle. |
| Detector fails to load (old Safari, no SIMD) | Try the no-SIMD wasm, then show a copyable error block like every other failure. |

Every failure keeps the photo on screen until the person leaves or presses
Forget. Seeing the photo is how they understand why it failed.

## Stages

0. **Spike, measurable in this sandbox.** MediaPipe runs on CPU/WASM, so
   headless Chromium here can run it, unlike LLM generation. Build
   `scripts/face-bench.mjs` over ~20 openly licensed portraits (Wikimedia
   Commons public domain / CC0). Pick them deliberately across **skin tone,
   age, hair type (including tightly curled and covered hair), glasses and
   beards, and head angle**. Record for each: face found?, hair mask
   plausible?, sampled skin colour vs the palette swatch it snapped to, and
   time. Save the cartoons as SVG next to the photos for a side-by-side
   review. *This is where the palette and the hair outline either work or
   don't. Nothing else should be built until it looks right.*
1. **Standalone `?selfie=1`**: photo → cartoon → idle animation → Forget.
   The owner tries it on the iPhone with real front-camera selfies. That is
   the round trip that decides whether the likeness is good enough.
2. **Expressions and talking** (tied to `voice.mjs`).
3. **Cartoon as Book's hero**, including the opt-in share-link field.
4. **Glasses**, then whatever the fixture review says is missing most often.
5. **Toon-filter fallback** for photos with no face.

### Tests to write with it
- `tests/face.test.mjs`: measurement maths (scale and tilt invariance: the
  same face rotated or resized gives the same numbers), exaggeration caps,
  palette snapping (every fixture skin colour lands on its nearest swatch,
  and none crosses more than one step lighter or darker), and animation
  states (blink closes and reopens; the mouth rests when speech stops).
- `tests/face-browser.mjs`: on a touch screen with a fixture photo, check
  that a cartoon appears and moves (frames differ). Check that **no request
  carries image bytes**, and that nothing lands in any storage.
  Mutation-check it: turn off the animation and the frame check must fail;
  add a test-only POST of the photo and the privacy check must fail.

### What cannot be tested here
- Whether the cartoon *looks like* the person. Only people can judge that:
  the owner first, then friends' honest reactions.
- iPhone speed and memory with WebLLM resident at the same time.
- Real front-camera selfies (wide-angle distortion, bad light) vs portrait
  fixtures.

## Open questions for the owner
1. **Style:** should the cartoon match Twemoji's round, simple faces (it sits
   naturally in the book), or be closer to a hand-drawn caricature (more
   likeness, more work)? The plan assumes the first, with mild exaggeration.
2. **Export as a GIF or sticker:** far less risky than with a real photo,
   because it is plainly a drawing. Yes in stage 1, or later?
3. **Children:** is the audience grown-ups making books *for* kids, or kids
   uploading themselves? The second needs more care before promotion.

---

## Parked: the rhyme

The measurement is in `scripts/rhyme-bench.mjs`. It ran 8 seeds × 2 runs
through Ollama on CPU and judged every poem with the CMU Pronouncing
Dictionary. As with every Ollama number here, the quantisation differs from
the browser build.

| Model | "Write a four-line rhyming poem" | Page picks the end words | …plus one worked example |
|---|---|---|---|
| Qwen3-0.6B | **0/16** rhymed | 0/16 rhymed, 9/64 end words obeyed | 0/16, 16/64 |
| Qwen3-1.7B | **1/16** rhymed | 0/16, 10/64 | 2/16, 28/64 |

The poems scan and mention the person's name and the thing they love. They
almost never rhyme (the 1.7B rhymed "paw" with "paw"). Subword tokens hide how
words sound (PhonologyBench, ACL 2024).

That run's end-word picker had a stress bug (it paired "tea" with "pony"),
which slightly understates the middle columns. The fix, and a
one-line-at-a-time mode where the page checks every line, are in the script
and **have not been run**. If the rhyme ever comes back, the page must own it:
CMUdict is BSD-style licensed and can be subset to the page's vocabulary.
