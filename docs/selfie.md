# Selfie mode — plan, and stage 1 as built

**Status: stage 1 built — `web/selfie.html` ("Draw me"), not yet tried on a
real phone.** See "Built" below for what exists, what was measured and what
changed from this plan. **Direction decided by the owner:** someone
picks a photo of themselves, and the page draws them as an **animated,
hand-drawn caricature**: a pen portrait with a watercolour wash, in the book's
ink style. They can export it as a GIF or sticker, and it can star in their
book. It is for everyone. Nothing is uploaded; everything runs on the device. The rhyme from the first version of the idea is parked (see the
end).

---

## The one-line design

**Measure the face, then draw a caricature from the measurements.** MediaPipe
finds 478 points on the face and a mask of the hair. The page un-tilts them,
exaggerates some measurements (only the ones it is allowed to; see §3), and
samples colours from the photo (skin, hair, eyes, lips, clothes). It then
draws a pen-and-wash portrait along those contours, the way it already draws
a book's pictures from a list of nouns.

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
| **Drawn caricature from landmarks** | **Build this.** It needs a ~5 MB detector and no LLM, and it runs on a phone with no WebGPU. Its output is plainly a drawing, so it cannot be mistaken for real footage of anyone. That removes most of the misuse question the photo-warp version had. It also lets you be the hero of your book. |
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

### 2. Measure (MediaPipe's models, Apache-2.0, vendored into `web/vendor/`)
*As built, the models run on LiteRT.js, not on MediaPipe's runtime. See
"Built". The runtime figures below are MediaPipe's and no longer apply.*
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

### 3. Turn measurements into a caricature (`web/face.mjs`, pure functions)
**Style, decided by the owner: a detailed, hand-drawn caricature**, not a
round emoji face. A pen portrait with a watercolour wash, drawn from the
person's own contours. That changes what the landmarks are used for. They are
not used to *choose* between stock eyes and mouths; the ink lines follow the
landmarks directly.

All points are first un-tilted using the head pose and normalised by the
distance between the eyes, so photo size and distance from the camera drop
out.

| Part | From | Drawn as |
|---|---|---|
| Face outline, jaw, chin | the 36-point face oval | one confident ink line of varying weight: heavier on the shadow side, thinning at the chin |
| Eyes | the lid contours (16 points each) and iris points 468–477 | upper lid as a heavy stroke, lower lid light and broken, iris in the sampled eye colour, one highlight |
| Brows | brow points; thickness and darkness sampled from the photo | a row of short hair strokes along the brow line, not one outline |
| Nose | bridge, tip, nostril wings | the wing and tip only, plus a shadow stroke down the side (how illustrators draw noses) |
| Mouth | inner and outer lip contours; lip colour | the line between the lips heavy; the lips as a light wash |
| Cheekbones, smile lines, dimples | where the photo is darker between landmarks | light hatching, only where the photo has shadow |
| Hair | hair mask → outline, plus the direction of the hair from the photo's gradients | a wash for the mass, then 40–120 strokes following the hair's own flow; curls drawn as loops where the direction field turns quickly |
| Shading | photo brightness per face-mesh triangle | cross-hatching in the darkest third, nothing in the light |
| Skin, clothes | median colours of cheeks (away from highlights) and below the chin | watercolour washes with a soft, uneven edge |
| Glasses, beard | **not in version 1** | See failures below. Named honestly rather than guessed. |

The extra detail (hatching, hair strokes) is what makes a drawing read as
*hand-made* rather than generated. It is all page-side and costs no model
tokens, like rough.js's wobble. Stroke counts are capped per part, so a phone
draws a portrait in well under a second. Measure that in stage 0.

**Likeness comes from exaggeration.** This is the classic caricature method
(Brennan's caricature generator, 1985): compare a measurement to an average
face and push it further from average. MediaPipe ships a canonical average
face with the model, so the average is free.

**What may be exaggerated is a design decision, not a free parameter.**
Exaggerating *every* difference from one average face would amplify the
features that differ most between ethnic groups (nose width, lip fullness,
eye shape). That is how caricature slides into racist caricature, and "for
everyone" means the page must never do it. So:
- **Exaggerated:** head shape and size, face length, jaw and chin, eye size
  and spacing, smile width, brow arch, hair volume, and expression (a big
  smile gets bigger).
- **Drawn true, never exaggerated:** nose width, lip fullness, eye shape
  (the lid fold), skin tone.
- **Amount:** a slider, **"How much caricature"**, runs from 0 (a straight
  portrait) to 2. The default is a gentle 1. It is the person's choice and the
  page never overrides it ("the page corrects the model, never the person";
  here there is no model to correct).
- The fixture review in stage 0 checks this list on real faces across
  ethnicities before anything ships. It is the gate for "everyone".

**Colours are snapped to a palette the page owns**, as sketch colours are, so
the portrait stays in the book's style and a dark photo cannot produce a muddy
grey person. The skin palette must span the full range of real skin tones in
fine steps, and the snap must never lighten or darken a tone to reach a
"nicer" swatch. This is a test, not a hope.

### 4. Draw
The drawing is SVG, made with the vendored rough.js and the book's ink
settings, so it sits on a book page without looking pasted in. Each part is
its own group with a `data-part` attribute, as `renderSketch` tags things with
`data-thing`.

What the page keeps is a **data object**, not an image: the normalised
contours (~150 points), a hair direction sample, and palette names — a few KB.
The drawing is always rebuilt from it with a fixed seed, so it looks the same
every time. That matters three times:
- `tests/face.test.mjs` can check it without a browser.
- **Export reads only this object, never the photo.** See Export.
- Compressed, it can travel in a share link, if the person opts in.

### 5. Animate
A detailed drawing cannot be re-roughed 30 times a second on a phone, so the
page draws each moving part in a few **keyframe states** once, and switches
between them:
- **Eyes:** open, half, closed (blink), plus the iris moved for glances.
- **Brows:** rest and raised.
- **Mouth:** rest, smile, and three open shapes. These are made by moving the
  person's own lower-lip contour down and filling the gap. They are not stock
  cartoon mouths, so the person still looks like themselves while talking.
- **Head:** a small tilt and bob applied as a transform to the whole group,
  which is cheap.

Behaviour:
- **Idle loop:** blinks every 3–6 s, glances, a slight bob.
- **Expressions:** smile, surprise, laughing, sleepy.
- **Talking:** while `voice.mjs` speaks a sentence, the mouth cycles through
  the open shapes, and it rests between sentences. There are no visemes,
  because Safari's word timing is unreliable (found in `voice.mjs`).
- **In a book:** `pageActions()` ("jumps", "swims") moves the figure as it
  moves the stand-in today.

### Export, from stage 1
- **Animated GIF**: an idle loop of about 2 s (blink, glance, smile), 400 px
  square, 12 fps. It is encoded in the tab with **gifenc** (MIT, ~170 KB
  unpacked, no dependencies). The frames are made by drawing each SVG state to
  a canvas.
- **Sticker**: a PNG with a transparent background (the portrait and hair,
  with no photo background) for messaging apps.
- **SVG**: the drawing itself, for anyone who wants to print it large.
- **Share, not save, on phones:** `navigator.share({ files })` hands the GIF
  or PNG straight to Messages or WhatsApp. Where file sharing is missing, fall
  back to a download.
- **Guarantee by construction:** the exporter's only input is the data
  object. It has no reference to the photo, so an export cannot leak photo
  pixels, EXIF location, or the background of the room. A test pins this.
- A small, removable "drawn on-device · sketchgpt" line in the corner. This
  is the lab's distribution thesis at work: every sticker sent is a link
  back. It is on by default, and one tap removes it.

### 6. Where it lives
- **Start standalone behind `?selfie=1`**: pick a photo, see yourself drawn
  and moving, then use the "How much caricature" slider, "Redraw" (same
  measurements, new pen seed), Export, or "Try another photo". It can be
  measured alone and has no model download.
- **Then as Book's hero:** "Use my caricature as the hero". `cast[0]` is drawn
  as the caricature (a big head on a small body in the clothes colour, as
  caricatures usually are) on every page,
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
- **The share link never carries the photo.** It can carry the *drawing's
  data* (a few KB compressed), but only when the person chooses to include
  it; the default link uses the stand-in hero. A caricature is not a photo,
  but it was made from someone's face, so including it is their call.
- **Exports carry only the drawing.** See Export: this holds by
  construction, and a test pins it.
- Measurements live in memory, and the page never compares faces or
  identifies anyone. That keeps it on the simple side of biometric-data law
  (BIPA; GDPR special-category data). **This is a design note, not legal
  advice.**

### For everyone, which includes children (owner's decision)
The page collects nothing, so there is no account, no age gate and nothing to
consent to storing. What "everyone" adds is care in the *drawing* and the
*words*:
- The exaggeration rules in §3 are the main safeguard. The default is gentle,
  and there is no "ugly" or "funny face" preset: the slider is about
  proportion only.
- Plain-language privacy text a child can read: "Your photo stays on this
  device. We draw you, then forget the photo."
- Anyone can draw a photo of someone else. A gentle, true-to-proportion
  default makes a mocking drawing harder to get by accident; nothing
  can stop it on purpose. Say so here rather than pretend otherwise.

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
   plausible?, sampled skin colour vs the palette swatch it snapped to,
   drawing time, and stroke count. Save the caricatures as SVG next to the
   photos at slider 0, 1 and 2 for a side-by-side review. *This is where the
   palette, the hair strokes and the exaggeration rules either work or don't.
   The review specifically asks whether any drawing reads as a stereotype.
   Nothing else is built until every fixture passes it.*
1. **Standalone `?selfie=1` with export**: photo → caricature → idle
   animation → slider → GIF / sticker / SVG, shared to Messages or WhatsApp →
   Forget. The owner tries it on the iPhone with real front-camera selfies.
   That round trip decides whether the likeness is good enough, and whether
   GIF encoding is fast enough on a phone.
2. **Expressions and talking** (tied to `voice.mjs`).
3. **Caricature as Book's hero**, including the opt-in share-link field.
4. **Glasses**, then whatever the fixture review says is missing most often.
5. **Toon-filter fallback** for photos with no face.

### Tests to write with it
- `tests/face.test.mjs`: measurement maths (scale and tilt invariance: the
  same face rotated or resized gives the same numbers), exaggeration caps,
  palette snapping (every fixture skin colour lands on its nearest swatch,
  and none crosses more than one step lighter or darker), and animation
  states (blink closes and reopens; the mouth rests when speech stops).
  **Exaggeration rules:** at every slider value, the nose width, lip
  fullness and eye shape of the output equal the input's; mutation-check it
  by exaggerating everything, which must fail. **Export isolation:** the
  exporter's input has no photo field, and a GIF made from fixture A is
  byte-identical whether the page holds photo A or photo B.
- `tests/face-browser.mjs`: on a touch screen with a fixture photo, check
  that a caricature appears and moves (frames differ). Check that **no request
  carries image bytes**, that nothing lands in any storage, and that the
  exported GIF decodes with the expected frame count and size.
  Mutation-check it: turn off the animation and the frame check must fail;
  add a test-only POST of the photo and the privacy check must fail.

### What cannot be tested here
- Whether the caricature *looks like* the person, and whether it feels kind.
  Only people can judge that: the owner first, then friends' honest
  reactions.
- GIF encoding time and `navigator.share` with files on a real iPhone.
- iPhone speed and memory with WebLLM resident at the same time.
- Real front-camera selfies (wide-angle distortion, bad light) vs portrait
  fixtures.

## Decisions (owner, answered)
1. **Style:** a detailed hand-drawn caricature, not simple emoji faces. §3 is
   built around it.
2. **Export:** from the start (stage 1): GIF, sticker PNG and SVG.
3. **Audience:** everyone. Hence the exaggeration rules in §3 and the
   "For everyone" notes under Privacy.

---

## Built: stage 1 (`web/selfie.html`, "Draw me")

What exists: pick a photo → a moving pen-and-wash caricature → a "How much
caricature" slider, Redraw, "Say hello" (the mouth moves while the device's
voice speaks) → Save GIF / Sticker (PNG) / SVG (shared to Messages or WhatsApp
on a phone, downloaded elsewhere) → Forget. It is a separate page, so the
main page is untouched and loads none of it.

| File | What it is |
|---|---|
| `web/selfie.html` | the page: photo in, colours and masks measured, drawing shown, exports |
| `web/face.mjs` | pure functions: alignment, the caricature rules, colour, mask outlines, hair strokes, shading, the SVG drawing, poses |
| `web/face-find.mjs` | runs the four models on LiteRT.js: anchors, crop, two-pass landmarks, masks |
| `web/face-mean.mjs` | MediaPipe's canonical (average) face, generated by `scripts/build-face-mean.mjs` |
| `web/vendor/` | LiteRT.js 2.5.3, the four `.tflite` models, gifenc 1.0.3, regenerated by `scripts/vendor-face.mjs` |
| `scripts/face-bench.mjs` | the fixture review: photos through the real page, drawings at slider 0/1/2 plus colour numbers |
| `tests/face.test.mjs`, `tests/selfie-browser.mjs` | the rules, and the page on a touch screen |

### Findings

- **MediaPipe's JavaScript runtime logs to Google.** `@mediapipe/tasks-vision`
  1.0.1 creates a logger for every task and POSTs usage statistics to
  `odml.pa.googleapis.com/v1/log` every 60 s (no image data, but a request
  off the device). The owner's rule: **don't use anything that logs.** The
  models are only weights, so they stay. They now run on **LiteRT.js**
  (Google's plain `.tflite` runtime, Apache-2.0). Every URL in its code was
  checked: its `fetch` and `XMLHttpRequest` calls only load files the page
  names. The steps MediaPipe's graph did (anchors, NMS, the rotated crop,
  two-pass landmarks) are in `face-find.mjs`. One model needed a four-int32
  patch (`shape_signature` batch −1 → 1), because LiteRT.js cannot resize a
  dynamic input; `vendor-face.mjs` does it and says so. The page also carries
  `Content-Security-Policy: connect-src 'self'` as a lock on the door, and
  `tests/face.test.mjs` fails if any vendored file names a logging endpoint
  or loads MediaPipe's runtime again.
- **Skin colour is the most sensitive number on the page, and two obvious
  rules were wrong.** Measured on 9 public-domain NASA portraits
  (`scripts/face-bench.mjs`):
  - Sampling the *lit* pixels (45th–85th percentile) drew Jeanette Epps
    several shades lighter than she is.
  - The whole-face median drew two side-lit people far too dark: Koichi
    Wakata at L\*=35 and Jessica Watkins at L\*=21. Half of each face was in
    near-black shadow (L\*≈15).
  - "Use the lit half" did not fix it either. Even evenly lit studio
    portraits differ by 12–25 L\* between the two halves of the face.

  **What shipped:** the median of the face's skin pixels (not eyes, brows,
  lips, nostrils or hair), leaving out only *deep* shadow: pixels more than
  25 L\* below the lit half's median. That drops 8–26% of pixels on evenly
  lit faces and 43–54% on the two side-lit ones. The drawn skin then keeps
  that lightness exactly (a test holds it within 0.8 L\* across ten tones).
  This is a judgement, not a measurement of anyone's true skin tone, and
  people must review it. The bench prints the numbers for every photo.
- **Protected features are enforced by a test.** At every slider value,
  nose width, lip fullness and eye shape equal the photo's. Mutation-checked:
  exaggerating either the lips or the nose fails the test. (The lip check
  first passed a mutation, because the test face's mouth was average width;
  the test face now has a wide mouth.)
- **A turned head reads as odd proportions**, so the caricature is damped by
  how far the nose sits off-centre, and the page says to use a
  forward-facing photo.
- **Speed (headless Chromium, CPU):** the four models load in ~0.4 s and a
  photo takes 0.2–1.0 s. That is not a phone.

### What was not tested
- **Everything on a real phone.** Safari's WebAssembly (it will likely get
  LiteRT's "compat" build), memory, the share sheet with files, and how
  fast the GIF is made.
- **Real selfies.** Front cameras, bad light and arm's-length distortion. All
  9 fixtures are studio portraits.
- **The stereotype review is still owed.** 9 faces is not the ~20 this plan
  asks for, and only people can judge whether a drawing feels kind.
- Glasses, beards and hats are not drawn (the page says so). A book hero
  from the caricature (stage 3) is not built.

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
