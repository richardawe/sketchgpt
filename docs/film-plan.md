# Film — a grown-up version of Book, without a model — a plan

**Status: a plan. Nothing is built. The owner makes the decisions at the end
before stage 0 starts.**

The owner said: "The general direction of this works, can we have an adult
version? No AI, better and more realistic libraries, actual moving objects and
animations and 2 mins videos with complex stories supplied by user."

Put another way: take what Book taught (the page does the work, the person
supplies the story, nothing gets uploaded, the tab writes the video) and build
it for adults. That means people instead of emoji, bodies that move instead
of pictures that bob, a story with several scenes, several characters and
dialogue instead of six pages, and a finished video of about two minutes.

"Adult" here means *for grown-ups*: grown-up characters, places and stories
(a heist, a breakup, a pitch meeting, a thriller's opening scene). It does not
mean explicit content. The site is public and linked from X, and CC0 character
kits have no rigs for explicit content anyway. The owner can overrule this
(decision 1), but the plan assumes it.

---

## What carries over from Book, and what does not

| Book today | Film | Why |
|---|---|---|
| `story.mjs` writes six pages by rules; own text split by `splitPages()` | **The person writes the story**, as a screenplay (Fountain) or as plain prose the page structures | The ask is "complex stories supplied by user". Rules can't write complex stories, and they don't need to |
| Twemoji / Fluent Emoji, flat, redrawn in ink | **3D people and places**: rigged glTF characters, CC0 environments, real lighting | "Better and more realistic libraries" |
| `animate.mjs`: whole-picture moves (hop, bob, sway), because emoji have no limbs | **Skeletal animation**: walk, sit, talk, point, argue, run, fall, hug, each from an animation library, blended | "Actual moving objects and animations" |
| `pageActions()`: verbs in the text become moves | **The same idea, one level up**: action lines and verbs become clips, dialogue becomes a talking character with a shot on them | The page reads its own text. This is Book's best idea and it carries straight over |
| `scene.mjs` places things and chooses the backdrop | Scene headings (`INT. KITCHEN - NIGHT`) choose the set, the lighting and the time of day; the page blocks the actors | "If the page can compute it, the prompt should not ask for it." There is no prompt, and the page still computes it |
| `video.mjs`: silent WebM/MP4 of the book, ~30 s, 540×720 | **A 2-minute 720p video with sound**: subtitles burned in, music, effects, and the person's own recorded voice lines if they want them | Two minutes of silence is not a film |
| `share.mjs`: the whole book in the `#` | The whole script in the `#` (compressed); the recipient's tab re-renders it | Nothing uploaded, still true |

Book stays exactly as it is. Film is a new page, `web/film.html`, the same way
`selfie.html` is its own page. It shares `video.mjs`'s encoder path and
`share.mjs`'s fragment encoding, and nothing else.

---

## Libraries — all checked for licence and for logging

The owner's rule still holds: **use nothing that logs**, and read a vendored
bundle's URLs before shipping it (`tests/face.test.mjs` already enforces this
for `web/vendor/`, and gets extended to the new bundles).

| Job | Pick | Licence | Why this one |
|---|---|---|---|
| Rendering, animation mixing, cameras | **three.js** (vendored, pinned) | MIT | glTF loader, `AnimationMixer` with cross-fades, skinned meshes, shadows, tone mapping. The most-used WebGL/WebGPU renderer, and it runs without WebGPU (WebGL2 is enough). No telemetry |
| People | **Quaternius Universal Base Characters** | CC0 | Six rigged humanoids (regular, heavy-set, teen, male/female), 20 hairstyles, ~13k triangles each, glTF. Same rig as the animation library below. The free tier is 60–70% of the kit; the $20 Source tier is everything, and CC0 either way |
| Movement | **Quaternius Universal Animation Library** (1 and 2) | CC0 | 120+ clips on that same rig: idle, walk, run, sit, talk, point, wave, fall, fight, dance… Being on one rig means any clip plays on any character with no retargeting code |
| Places, props | **Kenney** (furniture, city, interior kits), **Quaternius** environment packs, **Poly Haven** models | CC0 | A kitchen, an office, a street, a bar, a car, all low-poly enough to load on a phone |
| Light, sky, surfaces | **Poly Haven** HDRIs + textures, **ambientCG** materials | CC0 | Image-based lighting is most of what makes a low-poly scene read as "real" rather than "game". 1k HDRIs are ~1–2 MB |
| Screenplay parsing | **Fountain** syntax; a small parser written here (or a vendored MIT one, e.g. `fountain-js`) | MIT | A plain-text screenplay format writers already use. Scene headings, characters, dialogue, parentheticals and transitions are all marked, so a **complex story needs no model to understand**: the structure is in the syntax |
| Encoding | **Mediabunny** (already vendored) + WebCodecs | MPL-2.0 | Already proven in `video.mjs`. Needs its audio path added (AAC / Opus) |
| Music, effects | **Kenney audio**, **FreePD** / other CC0 music | CC0 | A few beds (tense, warm, sad, upbeat) and room tone per set. Chosen by the scene heading and by transitions, never generated |

**Rejected, with reasons:**

- **Mixamo.** Free to use in a finished project, but its FAQ forbids
  redistributing the raw character and animation files. This repo is public
  and serves raw `.glb` files, so it's too close to the line. The Quaternius
  rig covers the same moves as CC0.
- **Spine, Live2D.** Commercial runtime licences.
- **Ready Player Me avatars.** A hosted service, so it logs, and it has since
  shut down.
- **Any text-to-speech model** (Kokoro was already measured and rejected in
  Book: 11–15 s per 4–5 s of speech, 92 MB) and any "AI" motion or lip-sync.
  The owner said no AI.
- **The device's own voice in the video.** Browsers can't record
  `speechSynthesis` (`docs/story-rules.md`). It stays available for *playing*
  in the tab.

What "realistic" can honestly mean at this size: **stylised-realistic**, like
a well-lit indie game cutscene. It is not photoreal. Photoreal humans need
scanned characters (tens of MB each) and facial capture, and neither exists
as CC0 for the web. The plan says so up front rather than letting the first
render say it.

---

## How a story becomes a film, with no model

```
1. Write            Fountain screenplay, or prose with a guided editor that turns it into one
2. Cast             each character name → a body, hair, skin, clothes colour (or the reader's selfie colours)
3. Check            per scene: the set, who is in it, each line's shot and move — all editable
4. Watch            real-time preview in the tab, scrub, change a shot
5. Make the video   rendered frame by frame (not screen-recorded), 720p, with audio, MP4 or WebM
```

**The rules the page applies**, each testable the way `story.mjs` is:

| Script | What the page does |
|---|---|
| `INT. KITCHEN - NIGHT` | Set = kitchen (word → set table, like `placeOf()`), interior light, night: warm practicals, a dark window |
| `EXT. STREET - DAY` | Street set, HDRI sky, sun position by time of day |
| A character's first appearance in an action line | They enter: walk in from the nearest door or edge to a free mark |
| `MAYA` + dialogue | Maya plays a talk clip. The line's duration comes from its words (~150 wpm, or the recording's real length). The subtitle is burned in |
| `(angrily)`, `(whispering)` parentheticals | Clip and pose choice: gesture harder, lean in, arms crossed |
| Verbs in action lines: *sits, stands, walks to the window, runs, falls, hugs, hands her the keys* | Clips from the animation library, the `pageActions()` idea at full scale. Wishes and negations are still not deeds (the rule `animate.mjs` already learned) |
| Two people talking | Shot/reverse-shot. **The 180° rule is enforced by the page** (the camera stays on one side of the line between them), with a wide establishing shot at each scene start |
| `CUT TO:`, `FADE OUT.`, `SMASH CUT TO:` | The matching transition |
| Props named in action lines (*a gun, a phone, a coffee cup, a car*) | The prop from the kit, placed on the nearest surface or in hand |
| Things the page cannot map | **Listed, never guessed**: "No move for 'contemplates': shown standing". A visible failure, like the label fallback in Sketch |

**Two minutes is a budget, and the page counts it.** At ~150 spoken words a
minute plus action beats, two minutes is roughly 3–6 scenes and 250–300
spoken words. The editor shows a running length ("1:47 of 2:00") the way the
token budget did in Sketch. It warns past 2:00 and doesn't cut anything
silently.

**Continuity is the page's job**, the rule Book already follows: a character
wears the same clothes in every scene unless the script says otherwise, a
prop that was handed over stays in the new hand, and whoever exits a scene is
gone from it.

**Faces.** The CC0 bodies have no facial blendshapes, so there is no
lip-sync. Talking is shown by body language, head motion, and cutting to the
speaker. Stage 4 tests adding a simple jaw/mouth morph to the six bases in
Blender (a one-time asset edit, still CC0 derivative). The mouth would open
and close to the loudness of the person's own recording (Web Audio RMS), or
to the syllables of the line when there's no recording. That is amplitude,
not AI.

---

## Stages — each ends with something the owner can run on a real device

Every stage is built the way the project already works: small, measured,
mutation-checked tests, and a "not tested" list.

**Stage 0: probes before building (1–2 sessions).** No Film UI.
- One Quaternius character walking in one Kenney room, three.js, 720p, real
  time. **Measure fps on the owner's iPhone and desktop.** This single number
  decides whether phones preview in real time or only render offline.
- Render 3,600 frames (2 min × 30 fps) offline through WebCodecs, headless
  here (WebM) and on the owner's devices (MP4). Measure wall time and file
  size. Book's 30 s video took ~16 s here, and 720p 3D will cost more.
- Mux a recorded voice line and a music bed through Mediabunny's audio path.
- Total download for one scene (engine + 2 characters + 1 set + 1 HDRI),
  gzipped. Target: under ~15 MB, cached by `sw.js` for offline.
- **Gate:** if an iPhone can't render 2 minutes in under ~5 minutes without
  the tab dying, Film is desktop-first and says so on the page.

**Stage 1: script in, one scene out.**
`web/film.mjs` (pure: Fountain → shot list) plus `web/film.html`. Supports
scene headings, characters, dialogue and enter/exit. One set, two
characters, shot/reverse-shot, subtitles, preview only. Tests: the shot list
for a fixture script, the 180° rule over every generated shot, every named
character on screen when they speak.

**Stage 2: sets, props, light.** 8–10 sets (kitchen, living room, office,
bar, street, car interior, park, bedroom, hospital, rooftop), the
word → set table, time-of-day lighting, props in hand. Tests hold every set
to "every mark reachable, no actor inside furniture".

**Stage 3: acting.** Verbs → clips (start with ~40 verbs), parentheticals →
manner, entrances/exits, hand-offs, blended transitions. The unmapped-verb
list is shown to the writer. Test: a corpus of real public-domain scenes
(film scripts past copyright, or the owner's own), counting mapped vs
unmapped verbs, so the vocabulary is sized from real writing and not guessed
(the lesson of the stamp vocabulary).

**Stage 4: sound and faces.** Record your own lines (MediaRecorder, per line,
kept in the tab), music beds and room tone per set, a mouth driven by the
recording's loudness, and the mix muxed into the video.

**Stage 5: the 2-minute video.** Full offline render, a progress bar with a
time estimate, a wake lock during the render (the unexplained "Load failed"
lesson), MP4/WebM, and cancel. Test: a 2:00 fixture script renders here as
WebM and plays back at the right length with audio.

**Stage 6: prose in, share out.** A guided editor for people who don't know
Fountain ("Where does this happen? Who speaks?"), which writes Fountain
underneath. Share link = the script in the `#`. Recorded voices never travel
in a link (like the photo in Book).

---

## What is not known, and how each gets known

- **Whether an iPhone can render it at all.** Stage 0, on the owner's phone.
  Nothing here can answer it: SwiftShader can't run a 3D scene at speed, and
  emulation never caught this project's phone bugs.
- **Whether CC0 low-poly people read as "realistic enough".** The stage 0
  clip goes to the owner before stage 1. If the answer is no, the options are
  the Source tier's shaders, better lighting, or accepting a stylised look.
  There isn't a CC0 photoreal option to fall back to.
- **Whether rules can direct a scene watchably.** Shot choice by rule is how
  game cutscene systems and previs tools work, but nobody has measured this
  page doing it. Stage 1 fixture scripts, watched blind next to a hand-blocked
  version.
- **How big the verb vocabulary must be.** Stage 3's corpus count.
- **Download size vs "opens with no download".** Book keeps that promise;
  Film can't (it needs its assets). It downloads per set, only when a script
  uses that set, names the size first, and is offline after that.

---

## Decisions for the owner

1. **"Adult" = grown-up stories, not explicit content.** Is that right?
2. **3D (three.js + CC0 rigged people) or illustrated 2D rigs?** The plan
   recommends 3D: it is the only route to "realistic" and "actual moving"
   with CC0 assets. The cost is a download and phone performance, and stage 0
   measures both. 2D (e.g. Open Peeps-style cut-out people on bones) would be
   lighter and would work on every phone, but it looks illustrated, not real.
3. **Buy the $20 Quaternius Source tiers?** Everything stays CC0 either way;
   the free tier is ~60–70% of the characters and clips.
4. **Is Fountain acceptable as the main input,** with the prose editor
   (stage 6) as the on-ramp? Or should prose come first?
5. **Is desktop-first OK** if stage 0 says phones can't render two minutes?

Build order starts with stage 0, and nothing past it is built until the owner
has seen the stage 0 clip on their own devices.
