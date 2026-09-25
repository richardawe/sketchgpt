# Film — a grown-up version of Book, without a model — a plan

**Status: a plan, with the owner's first decisions made (end of this doc).
Nothing is built. Stage 0 is next.**

The owner said: "The general direction of this works, can we have an adult
version? No AI, better and more realistic libraries, actual moving objects and
animations and 2 mins videos with complex stories supplied by user."

Put another way: take what Book taught (the page does the work, the person
supplies the story, nothing gets uploaded, the tab writes the video) and build
it for adults. That means people instead of emoji, bodies that move instead
of pictures that bob, a story with several scenes, several characters and
dialogue instead of six pages, and a finished video of about two minutes. It
is built **for the phone first**, written **in plain prose**, and uses
**free-tier CC0 assets only**.

---

## "Adult": what this site can carry, and what it cannot

The owner answered "both": grown-up stories **and** explicit content. Those
split into two tiers, because the second can't live where this project lives.

**Tier 1, mature (this plan builds it):** grown-up characters and stories,
including violence (fights, falls, a gun in hand, someone dying), swearing
in dialogue and subtitles, drinking and drugs, and romance and sex that is
*implied*: a kiss, a hug, a bedroom scene that cuts away or fades to black.
This is roughly the range of a 15/R-rated film. Film opens behind a one-tap
"stories for adults" notice. A notice is enough here: nothing in tier 1 is
pornographic.

**Tier 2, explicit (not built here, and cannot be):**

- **GitHub forbids it, in the repo and on Pages.** GitHub's acceptable-use
  policy bans "pornographic content" and "graphic depictions of sexual acts
  including … animation, drawings, computer-generated images". The Pages
  terms repeat the ban. `richardawe.github.io` and this public repo are both
  on GitHub, so explicit animations, explicit assets, or a page built to make
  explicit videos would get the repo and the site taken down, and with them
  Sketch, Book and everything else.
- **Age-verification law applies to whoever serves it.** Since 25 July 2025
  the UK Online Safety Act (Part 5) requires "highly effective age assurance"
  from any service that publishes or displays pornographic content: a real
  age check, not a click-through. Several US states have similar laws. The
  video is made in the visitor's tab, but the explicit animations and bodies
  would be served by the site, so the site would very likely count as the
  provider. This is a reading, not legal advice.
- **The assets don't exist either.** The CC0 kits have no anatomy and no
  explicit movements. They would have to be made or bought, and that work
  would be the bulk of tier 2.

If tier 2 is ever built, it needs a separate site on a host that allows adult
content, a real age check, and legal advice. It also needs three rules
enforced in code from its first line, never left to a setting:

1. **Adult bodies only.** Quaternius's "Teen" proportions and anything else
   youthful can't be cast in an explicit scene. The page refuses, rather
   than filtering after the fact.
2. **No real person's likeness.** No photo, no selfie caricature
   (`selfie.html`), no named real people. An explicit video of a real person
   is non-consensual intimate imagery, which is banned everywhere and a crime
   in many places. Film's selfie hand-off stays tier-1-only.
3. **Nothing explicit in a share link.**

Tier 1 is designed so tier 2 could reuse it (renderer, prose rules, video)
without anything explicit ever touching this repo.

---

## What carries over from Book, and what does not

| Book today | Film | Why |
|---|---|---|
| `story.mjs` writes six pages by rules; own text split by `splitPages()` | **The person writes the story in plain prose**; rules turn it into scenes, lines and moves | "Complex stories supplied by user." `splitPages()`/`guessHero()` are the seed |
| Twemoji / Fluent Emoji, flat, redrawn in ink | **3D people and places**: rigged glTF characters, CC0 environments, real lighting | "Better and more realistic libraries" |
| `animate.mjs`: whole-picture moves (hop, bob, sway), because emoji have no limbs | **Skeletal animation**: walk, sit, talk, point, argue, run, fall, hug, blended | "Actual moving objects and animations" |
| `pageActions()`: verbs in the text become moves | **The same idea, one level up**: verbs become clips, speech becomes a talking character with a shot on them | The page reads its own text. Book's best idea carries straight over |
| `scene.mjs`/`placeOf()`: place words choose the backdrop, carried to the next page | Place words choose the **set**, time words choose the **light**, both carried until the prose changes them | The same rule at a larger scale |
| `video.mjs`: silent WebM/MP4, ~30 s, 540×720 | **A 2-minute video with sound**: subtitles, music, effects, the person's own recorded voice | Two minutes of silence is not a film |
| `share.mjs`: the whole book in the `#` | The whole story in the `#` (compressed); the recipient's tab re-renders it | Nothing uploaded, still true |

Book stays exactly as it is. Film is a new page, `web/film.html`, the way
`selfie.html` is.

---

## Libraries — free tier, all CC0/MIT, none logging

The owner's rule still holds: **use nothing that logs**. Every vendored
bundle's URLs are checked (`tests/face.test.mjs` already enforces this for
`web/vendor/`, and gets extended to the new bundles).

| Job | Pick | Licence | Notes |
|---|---|---|---|
| Rendering, animation mixing, cameras | **three.js**, vendored, pinned, **WebGL2** | MIT | glTF, `AnimationMixer` cross-fades, skinned meshes. WebGL2 rather than WebGPU because every phone has it. No telemetry |
| People | **Quaternius Universal Base Characters — free Standard tier** | CC0 | Rigged humanoids, hairstyles, ~13k triangles each, glTF. The free tier is ~60–70% of the kit, so **stage 0 lists exactly which bodies and hairstyles it contains** before anything depends on them |
| Movement | **Quaternius Universal Animation Library 1 + 2 — free tier** | CC0 | Same rig as the characters, so any clip plays on any body. Free tier is again ~60–70%, so stage 0 lists the clips and the verb table is sized to what's actually there. A missing move falls back to the nearest one, and the page says so |
| Places, props | **Kenney** kits (furniture, city, interior), **Quaternius** environment packs, **Poly Haven** models | CC0 | Chosen for low triangle counts: phone first |
| Light, sky | **Poly Haven** HDRIs (1k), **ambientCG** textures | CC0 | Lighting is most of what makes low-poly read as real. On phones, light is **baked** into each set, not computed per frame |
| Compression | **meshoptimizer** (glTF), **KTX2/Basis Universal** textures via three's loaders | MIT / Apache-2.0 | Smaller downloads and far less GPU memory, which is what kills phone tabs |
| Encoding | **Mediabunny** (already vendored) + WebCodecs | MPL-2.0 | Proven in `video.mjs`. Needs its audio path (AAC/Opus) added |
| Music, effects | **Kenney audio**, CC0 music (e.g. FreePD) | CC0 | A few beds (tense, warm, sad, upbeat) plus room tone per set. Chosen by rule, never generated |
| Screenplay import/export | **Fountain** syntax | MIT | Not the input anymore (the owner chose prose). Offered as an export, and a pasted Fountain script is recognised and read directly |

**Rejected:** Mixamo (raw files can't be redistributed, and this repo is
public). Spine and Live2D (commercial runtimes). Ready Player Me (hosted, and
shut down). Any text-to-speech or "AI" motion or lip-sync (the owner said no
AI; Kokoro was already measured too slow in Book). The Quaternius paid tiers
(the owner's call: free only).

What "realistic" honestly means here: **stylised-realistic**, like a well-lit
indie game cutscene. It is not photoreal. No CC0 photoreal humans exist that
a phone could load.

---

## Plain prose → a film, with no model

```
1. Write     plain prose, in a guided editor that shows scenes and speakers as you type
2. Cast      each name the page found → a body, hair, skin, clothes colour; he/she/they asked, never guessed
3. Check     per scene: the set, who is there, each line's speaker, shot and move — all editable
4. Watch     preview in the tab
5. Video     rendered frame by frame, with audio, MP4 or WebM
```

The prose rules, each tested the way `story.mjs` is tested (a fixture story
in, an exact scene list out):

| In the prose | What the page does |
|---|---|
| **Names**: capitalised words that recur and aren't place words or sentence starts (`guessHero()`, extended to a cast) | The cast. Shown at step 2 to be confirmed; a wrong guess is one tap to remove |
| **Quoted speech**: `"Get out," Maya said.` / `Maya said, "…"` / `…," she whispered.` | A line of dialogue; the speaker comes from the tag. The verb gives the manner: *whispered, shouted, snapped, laughed* |
| **A quote with no tag** | The novel convention: alternate between the two people in the scene. Shown at step 3 as **"speaker guessed"**, so it's visible and never silent. With three or more people present it isn't guessed; the line is marked for the writer |
| **Pronouns**: *she, he, they* | The last-named cast member with that pronoun (from step 2). If two fit, it's marked, not guessed |
| **Place words**: *kitchen, bar, office, street, car, park, bedroom, hospital, rooftop…* | The set. Carried forward until a new place word appears (`placeOf()`'s rule) |
| **Time words**: *that night, at dawn, the next morning, later, meanwhile* | A new scene, and its lighting |
| **A blank line plus a new place or time** | A scene break (a blank line alone is a paragraph, not a cut) |
| **Verbs**: *sits, stands, walks to the window, runs, punches, falls, hugs, kisses, hands her the keys, drinks* | Animation clips. Wishes, negations and "told to" are still not deeds (`animate.mjs` already learned this) |
| **Props**: *a gun, a phone, a glass, the keys, a car* | Placed on a surface or in a hand. Continuity is kept: a prop that was handed over stays in the new hand |
| **Anything the page can't map** | **Listed, never guessed**: "No move for 'contemplates': shown standing" |

The camera, by rule: a wide establishing shot at each scene start, then
shot/reverse-shot on whoever speaks, with **the 180° rule enforced** (the
camera stays on one side of the line between the two people), a cut on each
new speaker, and a hold on a big action.

**Two minutes is a budget, and the page counts it.** At ~150 spoken words a
minute plus action beats, two minutes is about 3–6 scenes and 250–300 spoken
words. The editor shows the running length ("1:47 of 2:00") as you type. It
warns past 2:00 and doesn't cut anything silently.

**Faces.** The CC0 bodies have no facial blendshapes, so there's no
lip-sync. Speech is carried by head and body motion and by cutting to the
speaker. Stage 4 tests a jaw morph added to the free bodies in Blender (a
one-time asset edit, still CC0), driven by the loudness of the person's own
recording. That is amplitude, not AI.

---

## Phone first: what that changes

The owner's call is to start with the phone, so the phone sets the budget
and desktop just gets headroom.

- **Render offline, not in real time.** The video is made frame by frame, so
  a phone that previews at 15 fps still writes a smooth 24/30 fps file. The
  preview drops resolution and shadows before it drops frames.
- **24 fps, 720×1280 portrait** by default (the shape phones film and share
  in). That's 2,880 frames for two minutes; landscape is an option.
- **Budget per scene, measured in stage 0:** at most 4 people on screen, one
  set, baked light, blob shadows, KTX2 textures. It's checked before
  rendering, the way model memory is budgeted in `docs/mobile-models.md`:
  **exceeding GPU memory kills the tab with no catchable error**, so
  prevention is the only defence.
- **Survive the screen locking.** It's the leading suspect for the phone's
  "Load failed" today. There's a wake lock during the render, and the render
  goes **scene by scene** into separately stored pieces (IndexedDB). A tab
  that dies at scene 4 resumes at scene 4 rather than restarting two minutes
  of rendering.
- **Download per set, only when used.** Engine + 2 people + 1 set + 1 HDRI
  should fit in ~10–15 MB. The size is named before downloading, cached by
  `sw.js`, and offline afterwards. Film can't "open with no download" the way
  Book does, and it says so.
- **Test on a touch screen**, like every browser test here, starting from a
  cold cache.

---

## Stages — each ends with something the owner runs on their phone

Every stage is built the way this project already works: small, measured,
mutation-checked tests, and a "not tested" list.

**Stage 0: probes, and the free-tier inventory. No Film UI.**
- List exactly what the free Quaternius tiers contain: bodies, hairstyles,
  clips. That list decides the verb table and the cast choices.
- One free-tier character walking and talking in one Kenney room, on the
  **owner's iPhone**: preview fps, then 2,880 frames rendered to MP4, with
  wall time, peak memory (and whether the tab survives), and file size.
- The same render here (headless, WebM) and on desktop, for comparison.
- Mux one recorded voice line and one music bed through Mediabunny's audio
  path, and check it plays in iOS Photos and Messages.
- **Gate:** if the iPhone can't make 2 minutes without the tab dying, even
  scene by scene, the budget shrinks (fewer people, lower resolution, shorter
  scenes) until it can. Phone first means shrink it; it does not mean
  desktop-only.

**Stage 1: prose in, one scene out.** `web/film.mjs` (pure: prose → cast →
scenes → lines → shots) plus `web/film.html`. Covers names, quoted speech
with tags, one set, two people, shot/reverse-shot, subtitles, preview only.
Tests: an exact scene list for fixture stories, the 180° rule over every
shot, every speaker on screen when speaking, and untagged lines always shown
as guessed.

**Stage 2: sets, time, props.** 8–10 sets within the phone budget,
place/time → set/light, scene breaks, props in hand. Tests: every mark
reachable, no actor inside furniture, places carried between paragraphs.

**Stage 3: acting.** Verbs → clips from the free-tier inventory, speech tags
→ manner, entrances and exits, hand-offs, fights and falls, the mature notice.
Size the verb table from real writing: run a corpus of public-domain short
fiction through the rules and count mapped vs unmapped verbs, the lesson of
the stamp vocabulary.

**Stage 4: sound and faces.** Record your own lines (MediaRecorder, per line,
kept in the tab), music and room tone by rule, the jaw morph test, and the
mix in the video.

**Stage 5: the 2-minute video.** Scene-by-scene resumable render on the
phone, a progress bar with a time estimate, wake lock, MP4/WebM, cancel.
Test: a 2:00 fixture story renders here as WebM with audio at the right
length.

**Stage 6: share and export.** The story in the `#`. Recorded voices and any
photo never travel in a link. Fountain export, and Fountain paste
recognised.

---

## What is not known, and how each gets known

- **What the free tiers actually contain.** Stage 0's inventory. The kits
  only say "60–70%".
- **Whether an iPhone can render two minutes.** Stage 0, on the owner's
  phone. Nothing here can answer it: SwiftShader can't run a 3D scene at
  speed, and emulation never caught this project's phone bugs.
- **Whether CC0 low-poly people read as "realistic enough".** The stage 0
  clip goes to the owner before stage 1. The fallback is better light, not a
  photoreal library, because no CC0 one exists.
- **How often prose rules guess the wrong speaker or scene.** Stage 1
  fixtures, then real stories from the owner. Guesses are always shown, so a
  wrong one is visible, never silent.
- **Whether rules can direct a scene watchably.** Stage 1 fixture stories,
  watched blind next to a hand-blocked version.
- **How big the verb vocabulary must be.** Stage 3's corpus count.

---

## Decisions made by the owner

1. **"Adult": both mature and explicit.** Tier 1 (mature: violence,
   language, implied sex) is built here. Tier 2 (explicit) **can't be hosted
   on GitHub** and would need its own host, a real age check and legal advice
   before any work, plus the three rules above. It is recorded as asked for
   and parked. Nothing explicit goes in this repo.
2. **3D.** three.js, WebGL2.
3. **Free Quaternius tiers only.** Stage 0 inventories them.
4. **Plain prose first.** Fountain becomes an export and a recognised paste.
5. **Phone first.** The iPhone sets the budget, and stage 0 runs on it before
   anything else is built.
