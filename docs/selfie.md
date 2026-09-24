# Selfie mode — a plan

**Status: researched, nothing built.** The idea: someone uploads a selfie and the
page animates their face. The first version of the idea also wrote them a
rhyme. That part was measured, failed, and is parked (see the end).

---

## The one-line design

**Find the face with MediaPipe, then move the photo's own pixels with a mesh
the page controls.** No generative model makes the animation. The page computes
every motion (blink, smile, eyebrow raise, head tilt, mouth moving while the
book is read aloud) from 478 landmark points, the same way `animate.mjs` moves
a book's pictures. This follows the project's usual rule: *if the page can
compute it, don't ask a model for it.*

## Three ways to "animate a face", and which one to build

| Approach | What it is | Verdict |
|---|---|---|
| **Neural talking head** (LivePortrait, SadTalker, first-order-motion) | A network re-renders the face from a driving video or audio | **Reject.** Hundreds of MB of weights, slow on a phone, and LivePortrait's face detector is InsightFace, whose models are **non-commercial research only**. The output is photoreal, which makes it deepfake-shaped: a page that makes anyone's photo talk convincingly is not something a one-person lab should ship. |
| **Mesh warp of the real photo** | Landmarks → triangle mesh over the photo → move chosen points, redraw each triangle with an affine warp | **Build this.** It needs a ~3.8 MB model and no LLM. It runs on a phone with no WebGPU, and every motion is a few numbers the page chooses. The limit is also a safety property: it can blink, smile, tilt and flap a mouth, but it cannot make someone say a sentence convincingly. |
| **Cartoon from landmarks** | Build a drawn character in the book's ink-and-wash style from the face's proportions and colours sampled from the photo | **Stage 2.** The strongest product fit: *you are the hero of your book*. It shares the detection step with the mesh warp, so it comes second at little extra cost. |

## Pieces, all on-device

1. **Input.** Use `<input type="file" accept="image/*">`. On phones this already
   offers the camera, so there is no `getUserMedia` and no permission prompt.
   Decode with `createImageBitmap` (it applies EXIF orientation, so a phone
   photo is not sideways) and downscale to ~512 px on the long edge before
   anything else. A 12 MP photo decoded at full size is ~48 MB of RGBA, and
   memory is exactly what kills tabs on iPhones (see "Exceeding device memory
   kills the tab").
2. **Detection.** Use **MediaPipe Face Landmarker** (`@mediapipe/tasks-vision`,
   Apache-2.0), in `IMAGE` mode on the **CPU delegate**. It runs once per
   photo, so the GPU delegate gains nothing and would compete with WebLLM for
   the device. Output: 478 3-D landmarks, 52 blendshape scores (smile, blink,
   jaw open…) and a head-pose matrix. Measured sizes: `face_landmarker.task`
   **3.76 MB**; the SIMD wasm **11.8 MB** uncompressed, plus ~0.3 MB of JS.
3. **Mesh.** Use MediaPipe's own face tessellation (its triangle list is
   published with the model), plus a ring of fixed points around the face and
   at the image corners. The warp then fades out into the background instead of
   tearing the edge of the face.
4. **Rendering.** WebGL2 with the photo as one texture: each frame uploads
   moved vertex positions, and texture coordinates never change. Keep a
   Canvas 2D fallback (clip each triangle, `setTransform`, `drawImage`) for
   browsers where WebGL is refused. The 2D path is slower but simple to reason
   about, and it gives the tests something to check pixel by pixel.
5. **Motions** (`web/face.mjs`, pure functions of landmarks and time; unit
   tests need no browser):
   - *blink*: upper-lid points move toward the lower-lid points, every
     3–6 s at random, 150 ms.
   - *smile*: mouth corners go up and out. Scale by the photo's own smile
     blendshape, so an already-grinning face is not stretched into a grimace.
   - *eyebrows*: a small raise on "surprise" beats.
   - *head*: a gentle tilt and bob. Rotate the face mesh about the
     nose-bridge, with a falloff so the ring stays still.
   - *breathing*: a ~1% scale loop.
   - *talking*: the jaw and lower lip drop, and a dark, softly edged polygon
     fills the mouth gap behind the lips. It is driven by `voice.mjs`: the
     mouth moves while a sentence is being spoken and rests between
     sentences. There are **no visemes**, because Safari's word boundaries
     are unreliable (already found in `voice.mjs`), and approximate flapping
     reads as cartoon rather than fake. That is the right side of the line.
   - Every amplitude has a hard cap. It is a design limit, not a tunable.
6. **Where it lives.** Put it behind a flag first (`?selfie=1`), as Animate
   was. `face.mjs` and MediaPipe load by dynamic `import()` only when someone
   picks a photo, so nobody else downloads 15 MB. The deploy workflow copies
   files by name: add `face.mjs` there, and `tests/deploy.test.mjs` already
   reads dynamic imports. Bump `?v=N` and the worker's `VERSION`. The worker
   only deletes `sketchgpt-*` caches, so the model weights survive.
7. **Hosting the detector.** Vendor the wasm and the `.task` into `web/vendor/`
   instead of loading them from jsdelivr + storage.googleapis. That gives one
   origin, works offline with the existing worker, and pins the version (the
   same reasoning that vendored rough.js). GitHub Pages gzips wasm. Measure
   the transfer size before claiming one.

## Privacy: the whole point, so the page must say it and keep it

- The photo is **never uploaded**. MediaPipe runs in the tab, like WebLLM.
  Say so next to the button, and let the privacy meter prove it (it already
  counts requests).
- The photo is **never stored**: no localStorage, no Cache API, no IndexedDB.
  Closing the tab forgets it. Add a "Forget this photo" button that clears the
  canvas and drops the bitmap.
- The photo is **never in a share link.** `share.mjs` puts the book after the
  `#`, and a face does not belong there. It would also make the link enormous.
  A shared book with a selfie hero opens with the stand-in hero instead, and
  says so.
- Landmarks are computed in memory and discarded. The page never compares
  faces or identifies anyone. It stays that way, which keeps it on the simple
  side of biometric-data law (BIPA, GDPR special-category data). **This is a
  design note, not legal advice.** Check before promoting the feature to any
  audience that includes children.

## Misuse, and the limits that answer it

It is possible to animate a photo of someone else. The answer is to limit what
the page can do, not to verify who is in the photo:

- Motions are small, capped and cartoonish.
- There is no lip-sync to arbitrary audio and no text-to-mouth for anything
  except the book's own words.
- **No video or GIF export in the first version.** Exporting is the obvious
  next request, and it is the step that turns a toy into a clip that can be
  posted. Decide it on purpose, later.

## Failures the page must show, not hide

| Case | What the page does |
|---|---|
| No face found | "No face found. Try a photo facing the camera, in good light". The photo stays on screen so the person can see why. |
| Several faces | Animate the largest face and outline it, so it is visible which face was picked. |
| Face turned or tilted past ~30° | Animate anyway with smaller motions, and say that the result works best facing forward. |
| Very small face in a big photo | Crop to the face box plus margin before the warp. |
| Detector fails to load (old Safari, no SIMD) | Use the no-SIMD wasm (11.0 MB, shipped in the same package), then a copyable error block, as every other failure has. |
| Hand over mouth, mask, heavy beard | Unknown until tried. Add to the fixture set. |

## Stages

0. **Spike (half a day, measurable here).** Headless Chromium runs MediaPipe
   on CPU/WASM with no GPU, so this sandbox *can* test it, unlike generation.
   On a set of openly licensed portraits (Wikimedia Commons public-domain or
   CC0 photos, varied skin tones, ages, glasses, beards, angles), record: face
   found?, landmark sanity (eyes above mouth, inside box), and detection time.
   Save the fixtures and numbers as `scripts/face-bench.mjs`, in the style of
   the other benches.
1. **Mesh warp, blink and breathe only.** Test the 2D path first. The owner
   runs it on the iPhone: frame rate, heat, and whether Safari keeps up.
   *This is the round trip that decides the renderer.*
2. **Smile, brows, head tilt, then talk-while-reading** with `voice.mjs`.
3. **Selfie as the book's hero** (cartoon from landmarks). Needs its own
   plan once 1–2 are real.
4. Only then consider export, and only as a deliberate decision.

### Tests to write with it
- `tests/face.test.mjs`: motion maths (caps hold, the ring never moves, blink
  closes and reopens, a pre-existing smile scales the smile motion down). Pure
  functions, fast.
- `tests/face-browser.mjs`: load a fixture photo on a touch screen and check
  that a face is found, that the canvas changes between frames, and that
  **no network request carries image bytes**. Mutation-check it: turn the
  motions off and the frame-difference check must fail. Point the privacy
  check at a page that POSTs the photo and it must fail.

### What cannot be tested here
iPhone frame rate and memory with WebLLM resident at the same time,
Safari's wasm behaviour, and how real selfies (front-camera distortion, bad
light) differ from portrait fixtures. The owner's phone is the test for all of
these, as before.

## Questions for the owner

1. Standalone Selfie mode, or straight into Book as "make me the hero"? This
   plan builds the standalone warp first because it can be measured alone.
2. Is a real-photo animation acceptable at all, or only the cartoon version?
   The cartoon removes most of the misuse question.
3. Export (GIF/video): never, later, or yes?

---

## Parked: the rhyme

The measurement is in `scripts/rhyme-bench.mjs`. It runs 8 seeds × 2 runs
through Ollama on CPU, and every poem is judged with the CMU Pronouncing
Dictionary, the way the page would judge it. As with every Ollama number here,
the quantisation differs from the browser build.

| Model | "Write a four-line rhyming poem" | Page picks the end words | …plus one worked example |
|---|---|---|---|
| Qwen3-0.6B | **0/16** rhymed | 0/16 rhymed, 9/64 end words obeyed | 0/16, 16/64 |
| Qwen3-1.7B | **1/16** rhymed | 0/16, 10/64 | 2/16, 28/64 |

The poems scan and mention the person's name and the thing they love. They
almost never rhyme: the 1.7B rhymed "paw" with "paw". This matches the
literature. Subword tokens hide how words sound (PhonologyBench, ACL 2024).
Handing the model the end words did not rescue it, because it ignores them.

**This first run has a bug.** The end-word picker used secondary stress and
paired "tea" with "pony", so the middle columns are slightly pessimistic. The
free-verse column is unaffected. A fix is in the script, along with a
one-line-at-a-time mode where the page checks each line's last word and asks
again. **Neither the fix nor that mode has been run.** If the rhyme comes back,
that mode is the next thing to measure, and the page owns the rhyme
(CMUdict is BSD-style licensed; subset it to the vocabulary the page uses).
