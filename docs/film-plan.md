# Film — a grown-up version of Book, without a model — a plan

**Status: stages 0–4 are built and live; 5–6 are not.**

- Stage 0, `web/film-probe.html`, has run on the owner's iPhone: a 2-minute
  720p MP4 with sound in 43 s ("Stage 0 measured" below).
- Stages 1–4 have not run on a phone yet. All of them are in
  `web/film.html`:
  - 1: plain prose in, a 3D scene and its video out;
  - 2: seven sets, light by time of day, props in hand;
  - 3: acting measured on real writing, and Build one;
  - 4: sounds from the story's events, each place's sound, heads that move
    with the voice.

The free tiers turned out smaller than their "60–70%": two bodies, no
clothes, and faces that can't open their mouths.

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
| People | **Quaternius Universal Base Characters — free Standard tier** | CC0 | **Measured in stage 0: two bodies only** (Superhero female and male, ~13k triangles each; the Regular and Teen bodies are paid), 6 hairstyles, a beard and 2 eyebrow sets. No clothes, no facial morph targets. See "Stage 0 as built" |
| Movement | **Quaternius Universal Animation Library 1 + 2 — free tier** | CC0 | Same rig as the characters, so any clip plays on any body (confirmed: bone names match exactly). **Measured: 84 clips** (list below). A missing move falls back to the nearest one, and the page says so |
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

## Bring your own character

At step 2 (Cast), each name can use a built-in body, **or a character the
person brings**. There are four ways in, from simplest to most work. Three
use no machine learning; the one that does says so on the button.

| Way in | What the person gives | What the page does | ML? |
|---|---|---|---|
| **Build one** | picks body, hairstyle, skin, hair, eye and clothes colours, height | recolours and scales a free Quaternius base. Saved in the tab by name, reusable in the next film | no |
| **Your own 3D character** | a `.glb`/`.gltf` or `.vrm` file (VRoid Studio, Blender, any avatar tool that exports glTF) | maps its bones onto the Quaternius rig by name (Quaternius, Mixamo-style, VRM humanoid and Blender Rigify names are all known tables) and retargets the clips onto it (three.js `SkeletonUtils`; `@pixiv/three-vrm`, MIT, for VRM). Played exactly as given: the page doesn't restyle a person's character, the same rule as "the page corrects the model, never the person" | no |
| **Your face on a body** | a photo, plus three taps: left eye, right eye, mouth | cuts an oval around those three points and puts it on a built body's head as a texture, with skin colour from the cheek between the taps. Flat, a bit like a mask, and honest about it | no |
| **Your selfie drawing** (from `selfie.html`) | the drawing "Draw me" already made | its colours (skin, hair) and hairstyle choice go onto a built body. "Draw me" uses MediaPipe's models, so this button says **"uses on-device machine learning"** | **yes**, in selfie.html, not in Film |

**Rules for a brought character:**

- **Checked before use, against the phone budget.** File cap ~30 MB, read
  from `file.size` before a byte is read. The triangle count and texture
  memory are summed and compared with the scene budget. Over it: "This
  character is 180k triangles; a phone manages ~40k per person. Use it on
  desktop, or simplify it", never a crashed tab. The page won't silently
  decimate someone's model.
- **Bones that don't map are said, not guessed.** "No arm bones found: this
  character can stand and turn but not gesture." A character with no
  skeleton at all is still usable as a prop-like figure that slides and
  turns, and the page says so.
- **It stays in the tab.** Files and photos are never uploaded and never go
  in a share link. A shared film shows a built stand-in with the same
  colours, like Book's "me" → stand-in child. "Save" writes one file with the
  character inside, the person's choice.
- **Someone else's face is their consent, not the page's.** The photo button
  says "Use a photo of yourself, or of someone who agreed". In tier 1,
  violence against a real face is allowed with that notice. In tier 2 (if it
  ever exists) photos and likenesses are refused outright (rule 2 above).
- **Licences travel with files.** A VRM carries its author's terms in its
  meta: licence, and whether violent or sexual use is allowed
  (`violentUssageName`/`sexualUssageName` in VRM 0.x,
  `allowExcessivelyViolentUsage`/`allowExcessivelySexualUsage` in 1.0). They
  are **read and obeyed**: a VRM marked "no violent use" can't
  be cast in a scene where it fights or dies, and the page says why.

Built in stage 3 (Build one), stage 4 (face on a body; the selfie hand-off)
and stage 6 (your own 3D file, since retargeting is its own stage of work
and the free rig must be solid first). Stage 0 already loads one outside
`.glb` to prove the bone-map idea.

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

## Stage 0 as built

`web/film-probe.html` + `web/film/probe.mjs`. Deployed with the site, it is
a page the owner opens on the phone. It loads ~6.9 MB once, then:

1. **Preview for 15 seconds:** real-time playback, frame times recorded
   (median, p95, worst).
2. **Record a line** (optional): your voice, kept in the tab, mixed under the
   woman's first line.
3. **Make the 2-minute video:** 720×1280 portrait, 24 fps, 2,880 frames drawn
   one at a time (not screen-recorded), subtitles burned in, a music bed and
   room tone made on the page, encoded in the tab. MP4 (H.264 + AAC) where the
   browser can, else WebM (VP9 + Opus). Wake lock held. Save or Share.
4. **Copy the report:** device, GPU, load time and size, triangles and draw
   calls, preview fps, render wall time and × real time, draw vs encode cost
   per frame, file size, codecs, JS heap where exposed, and how many times the
   page went to the background.
5. **If the tab dies**, the next visit says how far it got ("stopped at frame
   1200 of 2880, 185 s in, the page had been in the background"). Progress is
   written every 24 frames. That sentence is the survival measurement.

`?seconds=`, `?fps=`, `?width=` and `?shadows=0` shrink the job if the
full one dies. That's how the phone budget gets found.

The scene is 30 seconds looped to fill the length. Two people in a Kenney
living room, lit by a Poly Haven HDRI plus one shadowed key light, 13
movement segments with 0.35 s cross-fades, and 6 lines of dialogue. The
camera cuts by rule: wide at the start and during walks, a two-shot between
lines, and a close shot of whoever speaks, taken from the side they face.
Every frame is a pure function of its time, so the preview and the video are
the same pictures.

### What the free tiers actually contain (`scripts/film/inventory.mjs`)

| | Free Standard tier |
|---|---|
| Bodies | **2**: Superhero female, Superhero male. Muscular proportions; the man's shirt shows his abs through it. Regular and Teen bodies are in the paid Source tier only |
| Hair | 6 styles (long, simple parted, buns, buzzed, buzzed female), a beard, 2 eyebrow sets. Grey textures made to be tinted, which works |
| Clothes | **None.** The bodies come in underwear. Quaternius's only outfit kit (Modular Character Outfits) is **fantasy** (medieval), and compatible with this rig |
| Faces | **No morph targets** on any mesh: no blinks, no mouths, no expressions |
| Textures | 2048 px; two the `.gltf` files name are missing from the free zip (eye normal, one hair normal). The build finds or drops them |
| Movement (84 clips) | Walk, Walk_Formal, Jog, Sprint, Crouch (idle, forward), Sitting (enter, idle, talking, exit), Idle, Idle_Talking, Idle_TalkingPhone, Idle_FoldArms, Idle_No (head shake), Yes (nod), Consume (drink/eat), Interact, PickUp_Table, Push, Walk_Carry, Driving, Dance, Punch (jab, cross), Melee hook, Hit (chest, head, knockback), Death01, LayToIdle (getting up), Pistol (idle, aim ×3, shoot, reload), Roll, Jump (start, loop, land), ClimbUp, Swim, Zombie ×3, plus sword, shield, spell, farming, torch and lantern moves |
| Not there | Hug, kiss, point, wave, cry, lie down (only getting up), open a door (Interact stands in), sit on the floor, run scared, turn around |

Only two bodies, and no faces that move, is a bigger gap than "60–70%"
suggested. For drama it's enough to stage a two-hander (talk, argue, drink,
phone, fight, shoot, die), but not a crowd or an embrace.

**Clothes are painted on for now.** Each vertex is shirt, trousers or shoes
by which bones move it (the skin weights), and a shader lays the colour over
the skin texture. There's no download, and it reads as a fitted outfit from
a distance and as a bodysuit up close. The real fix is a stage 2 decision:
(a) the fantasy outfits recoloured (wrong period), (b) Quaternius's older
**Ultimate Modular Men/Women** packs (CC0, modern clothes, but a different
rig, so clips are retargeted with `SkeletonUtils.retargetClip`), or (c) the
paid Source tier (still no modern clothes, so it doesn't help here).

### Sizes (phone first)

| File | MB |
|---|---|
| three.js bundle (`vendor/three.mjs`, everything exported) | 0.82 (0.21 gzipped) |
| Mediabunny with audio (`vendor/mediabunny-film.mjs`) | 0.26 (0.06 gzipped) |
| woman.glb, man.glb (1024 px WebP textures, meshopt) | 0.33 + 0.31 |
| hair ×3 + beard | 0.32 |
| moves-1.glb + moves-2.glb (84 clips, no mesh) | 2.17 + 2.29 |
| room.glb (19 Kenney pieces) | 0.07 |
| lebombo_1k.hdr | 1.48 |
| **Total loaded by the probe** | **6.87** |

Per frame: 72k triangles (with the shadow pass), ~120 draw calls, 33 textures.
Animations are two-thirds of the download. A film would load only the clips
its story uses: the 13 the probe plays are well under 1 MB.

### Tested here, and not tested

**Tested** (`tests/film-probe-browser.mjs`, touch screen, SwiftShader,
mutation-checked: no sound, no dead-run notice, a run never marked finished,
and a single shot for everything each fail it):

- the page loads everything, with 84 clips;
- the shots follow the rules;
- a frame is really drawn;
- a 3-second video comes out as WebM/VP9 + Opus, plays for 3.02 s at
  180×320, and its sound decodes;
- a dead run is reported on the next visit;
- no page errors, and no navigation.

`tests/deploy.test.mjs` checks that the page, its module, every asset it
names and both bundles are deployed. `tests/face.test.mjs` already scans the
new bundles for logging endpoints (none).

**Not tested:** everything the stage exists for. On the owner's iPhone:

- preview fps;
- whether 2,880 frames at 720p finish, and in how long;
- whether the tab survives;
- the MP4 + AAC path, which headless Chromium here cannot encode;
- whether the file plays in Photos and shares to Messages.

SwiftShader has no GPU, so its speed says nothing about a phone's.

## Stage 0 measured on the owner's iPhone (2026-09-25)

The owner's report from `film-probe.html`, unedited settings: 120 s, 24 fps,
720×1280, shadows on.

| | |
|---|---|
| Device | iPhone, Safari 26.6.1 (the UA still says "iPhone OS 18_7": Safari 26 freezes that field), 4 cores, DPR 3, 430×932, "Apple GPU", max texture 16384. WebCodecs and wake lock present |
| Load | 6.87 MB in **0.75 s** (cached or fast network); 72k triangles, 119 draw calls, 33 textures, 84 clips |
| Video | **MP4, H.264 + AAC**: the path headless Chromium here can't test **works** |
| Render | 2,880 frames in **43.1 s: 2.79× real time**. The tab survived, and never went to the background |
| Per frame | draw **0.8 ms** (CPU side of the WebGL calls), **encode wait 13.5 ms** (GPU finish + readback + H.264). The encoder, not the scene, is the cost |
| Audio | music bed rendered in 0.9 s; finalize 68 ms |
| File | **27.1 MB** for 2:00 (3 Mbps video + 128 kbps AAC) |

**What it means:**

- **The phone-first gate passes with room to spare.** The budget in "Phone
  first" was guessed to be tight: at most 4 people, baked light, blob shadows,
  and scene-by-scene resumable rendering in case the tab died. None of it was
  needed at this scene size. A 2-minute film takes under a minute on this
  phone, with real-time shadows.
- **The scene can grow before it matters.** Drawing is 0.8 ms of a ~15 ms
  frame. More people, more props and a second set cost GPU time inside a
  budget that isn't close yet. Measure again when stage 2 adds sets; don't
  pre-optimise.
- **The resumable render (stage 5) drops in priority.** A 43 s render is
  short enough to redo. The wake lock and the "last run died at…" notice
  stay; they're cheap, and a slower phone could still need them.
- **27 MB is fine to save and too big for some chats.** WhatsApp and Messages
  recompress. A lower-bitrate "for sharing" option (1.5 Mbps is about 14 MB)
  is a small follow-up if it matters.

**Still not measured:**

- preview fps (the report has no `preview`: it wasn't run);
- memory (Safari exposes no heap figure);
- what happens if the screen locks mid-render;
- whether the MP4 played in Photos and shared to Messages (the report can't
  see that; the owner can say);
- any phone older or smaller than this one.

## Stage 1 as built

`web/film.html` + `web/film.mjs` (pure: the rules) + `web/film/stage.mjs`
(three.js: the room, the people, the camera, the video). The probe now draws
on the same stage, so anything measured on it holds for Film.

The page, top to bottom:

1. **Adult notice.** "Stories for adults… nothing explicit is drawn." One
   tap, remembered on this device.
2. **Write.** Plain prose, saved as a draft on this device. The length
   ("0:40 of 2:00") updates as you type.
3. **Cast.** Every name found, with a **pronoun to choose** (never guessed)
   and a look: 4 looks from the 2 free bodies (hair, colours, painted
   clothes).
4. **Check.** Every line and every move, scene by scene. Each line shows how
   its speaker was found: *said so*, *same paragraph*, *continues* or
   *guessed*. Guessed lines are highlighted yellow, and every line has a
   speaker menu, where the person's choice wins over the rules. Notes list
   what the page couldn't do ("No move for 'hesitated'", "'she' could be
   Maya or Ruth").
5. **Watch.** Loads ~7 MB once, then plays in real time.
6. **Make the video.** The whole film, 720×1280, 24 fps, with the music bed.
   Then Save or Share.

**The rules, as tested** (`tests/film.test.mjs`, 16 tests,
mutation-checked):

- **Cast:** capitalised words that stand mid-sentence, in a speech tag, in a
  possessive, in a list ("Maya and Ruth"), or at a sentence start before a
  verb. Words that merely start sentences ("No", "Don't", "Tonight") are not
  names.
- **Speakers, in order:**
  1. the tag before or after the quote (`"…," she whispered` gives Maya,
     manner *quiet*);
  2. a continuation of the same speaker's quote;
  3. someone acting in the same paragraph;
  4. the novel's alternation between exactly two people, marked
     **guessed**.

  With three people in the room, an untagged line goes to nobody, with a
  note.
- **Pronouns** (including her/his/their) resolve only when exactly one
  person present has that pronoun.
- **Moves:** 19 kinds (enter, exit, sit, stand, walk, nod, shake head, fold
  arms, drink, phone, punch, fall, die, shoot, draw a gun, pick up, dance,
  push, get up), each mapped to a free-tier clip. **The test reads the clip
  names out of the shipped GLBs.**
  - Negations, wishes and plans are not deeds: *didn't*, *wanted to*,
    *tried to*, *would*.
  - A speech tag is not an action, and only counts as a tag when it sits
    next to a quote ("She answered the phone" is a move).
  - "Tom, Maya and Ruth sat" seats all three.
  - A verb with no move is listed.
- **Scenes** break on a paragraph with a new place or a time jump ("That
  night…"). Stage 1 plays every scene in the one living room and says so.
- **Timing:** 150 words a minute per line, walks at 1.25 m/s, fixed holds
  per move, a 2-second wide shot opening each scene. Over 2:00, the length
  turns amber and nothing is cut.
- **Camera:** wide on scene starts and walks; on a line, a medium close-up
  of the speaker; on other moves, the person doing them; otherwise both
  people. **The 180° rule is a test:** between wide shots, every frame's
  camera is on one side of the line between the two people.

`tests/film-browser.mjs` runs on a touch screen and is mutation-checked
(corrections ignored, no notice, a cast row wider than the phone, a camera
that ignores the speaker). It covers:

- the notice;
- nothing wider than the phone (the first build was 539 px wide in a 390 px
  viewport, and the zoomed-out page put a canvas over the buttons);
- pronouns asked, not guessed;
- the guessed line highlighted, and corrected by the person;
- the stage loads, and every line's frame is shot on its speaker;
- a video of every frame, with sound, playing for the film's length;
- the draft surviving a reload.

**Not built in stage 1:** sets other than the living room (stage 2), props
in hand, per-line recorded voices (stage 4), share links (stage 6), and a
look chosen per scene.

**Not tested:** any phone. Also, whether rules-directed shots are watchable
to anyone but the page's tests, and real writers' prose: the rules are
tested on sentences written for the tests. Stage 3's corpus count is where
that gets measured.

## Voices (built after the owner heard only a hum)

The owner's first phone video had "no voice, just a humming sound". That was
as built: the hum was the page's own music bed, and every line was a subtitle.
Two things were built in answer, at the owner's choice:

- **Your own voice, in the video.** Every line in Check has 🎙 Record, ▶
  (listen back) and ✕. A take is:
  - trimmed of silence at both ends (`trimBounds`, relative to the take's
    loudest moment, so a quiet phone mic works);
  - kept in the tab only (never stored, never uploaded, gone on reload);
  - used as the line's length (`beat.seconds`), so the scene moves to fit it;
  - placed at its line in the video's soundtrack.

  Lines not recorded are silent in the video, and the page says how many are
  heard ("2 of 4 lines are heard; record the rest").
- **The phone's voice, while watching.** Each person gets a different device
  voice by default and a **pitch** (natural / deeper / higher; "he" defaults
  to deeper). Choosing either says "This is Maya" in it. One setting pitches
  both the device voice and that person's recordings (`PITCH`: speech pitch
  0.75/1/1.3, playback rate 0.88/1/1.12). Recorded lines play the recording
  instead.
  - Speech is unlocked inside the Play tap (a silent utterance and an
    AudioContext resume), because iOS speaks only what a tap asked for. Each
    line is then spoken on cue.
  - The scene holds at a line's start while the previous line is still being
    spoken, so speech never runs ahead of the picture.
  - A browser that doesn't start speaking within 2.5 s is marked "subtitles
    only" instead of holding the scene for ever.
- **Music is off by default**, a checkbox away. The probe keeps it, because it
  measures the audio encoder.

**Tested** (`tests/film-browser.mjs`, Chromium's fake microphone and a
stand-in `speechSynthesis`; mutation-checked: video without the recording, no
phone voice, pitch ignored, a take that doesn't set the line's length, music
on by default):

- a take is recorded and heard back, and its line lasts as long as it does;
- in the preview, the recorded line plays the take, and every other line is
  spoken, in order, in its speaker's voice and pitch;
- in the video, the take is loud during its line, and it is silent after.

Unit tests cover the trimming, the timing shift, and the pitch table.

**Not tested:** whether iOS Safari speaks the later, on-cue lines after the
in-tap unlock. Book queued every sentence inside the tap because a later
`speak()` "can be refused". If an iPhone refuses, the page falls back to
subtitles only and says so. Also untested: the iPhone microphone through
MediaRecorder (Safari records `audio/mp4`), and which voices an iPhone offers.

## Stage 2 as built: sets, light, props

Seven sets, chosen by the story's place words: **living room, kitchen,
bedroom, office, bar, street, park**.
- "car" and "rooftop" play on the street set, "hospital" on the bedroom set.
  The page says so ("There's no hospital set yet: it's played on the bedroom
  set").
- Each set is described in `film.mjs` `SETS` (marks, seats with what they
  face, door, off-stage point, window, wide shot) and built in `stage.mjs`
  `BUILD`.
- The film loads only the sets and kits its story uses.
  - Interiors come from Kenney's Furniture Kit.
  - The street comes from City Kit Roads + Commercial + Car Kit.
  - The park comes from the Nature Kit, recoloured by material name, because
    Kenney's grass is mint.
  - Outside also loads a Poly Haven sky HDRI (1.4 MB).
  - All CC0. The new kits add under 0.5 MB.

**Light** comes from each scene's own words, carried until they change:
*night* (midnight, dark, "two in the morning"), *evening* (dusk, sunset),
*dawn* (sunrise) and *day*.
- Each light sets the environment intensity, the key light's colour and
  strength, and a practical (a lamp, a street light).
- Outside, the sky shows, dimmed at evening and dawn and replaced by dark
  blue at night.

**Only a scene's people are on stage.** That means whoever it names, speaks
or acts. Those who "come in" start outside, and a new scene resets seats and
hands.

**Props in the right hand:**
- a glass when someone drinks or is "with a drink", which stays in hand;
- a phone while on the phone, then put away;
- a gun once drawn, which stays until they leave or the scene ends.

The glass is a tumbler with a drink in it, because Kenney's clear glass
vanished on screen. The phone and gun are simple boxes. Grips were set by
rendering the hand close up in each pose (`GRIP`).

**Bar stools lift** whoever sits on them by 0.4 m, because the free sitting
clip is chair height.

Found by looking at every set rather than trusting the numbers:
- a mint park;
- a monitor in front of the office close-up;
- a woman sitting *inside* a bar stool;
- a lamp post filling the street's wide shot;
- a gun lying across the forearm;
- an office chair turned the wrong way.

All were fixed and looked at again.

**Tested** (`tests/film-sets-browser.mjs`: a six-place story, touch screen;
mutation-checked: the set never changes, props never shown, no stool lift,
light ignoring the time):

- each scene shows only its set;
- the sky shows outside only, and not at night;
- night is darker than day;
- props appear exactly when the words put them in a hand;
- the stool lift is applied;
- every scene draws;
- the whole 45 s film renders.

Unit tests cover the sets' marks, the light words, the scene membership and
the props' rules.

**Not tested:** any of it on a phone. The phone budget from stage 0 was
measured with one room; a street set is more geometry, and nobody has timed
it on the iPhone. Also untested: whether the sets read as their places to
anyone but the page's tests.

## Stage 3 as built: acting, measured on real writing

**The measurement first** (`scripts/film/verb-bench.mjs`). Five public-domain
collections from Project Gutenberg: Doyle's *Adventures of Sherlock Holmes*,
Joyce's *Dubliners*, O. Henry's *The Four Million*, Mansfield's *The Garden
Party* and Chekhov's *The Lady with the Dog*. That's 490 passages of 15
paragraphs and 347k words, read by Film's own `readStory`, exactly as a
writer's paste would be. Runs in 2 s.

| | before stage 3 | after |
|---|---|---|
| Action verbs acted (acted ÷ acted + "no move") | 24.5% raw; **33.6%** once non-actions stopped counting | **63.1%** |
| Moves acted in the corpus | 928 | 1,874 |
| Speakers found, pronouns set as a writer would (bench guesses them; the page asks) | 50.1% (tag 20.6, paragraph 8.8, continues 15.6, guessed 4.9) | same |

- **Half of all lines get no speaker** in this corpus. It's multi-character
  Victorian and Edwardian prose, where who speaks is carried by context no
  rule reads. The page marks those lines instead of guessing. A writer
  pasting their own two-hander gets far more (the tests' stories are 100%),
  but that's a claim about tests, not writers.
- **The "no move" list was mostly not missing moves.** Before filtering, its
  top entries were "seemed", "wanted", "remembered", "Holmes", "eyes" and
  "years": states, thoughts, and false matches (a case-insensitive flag read
  "Holmes" as a verb). Now only a person's deeds count (a cast name or a
  pronoun as subject), and states and thoughts are never listed.
- Also found: **speech verbs the reader didn't know** (remarked, explained,
  exclaimed, stammered, retorted…). 16 were added, with manners.

**What was added**, each to a free-tier clip:
- give (a hand-off: the item changes hands);
- follow (walk up to them);
- run (jog, 3.2 m/s);
- turn (to someone, or away, which lasts until they next speak);
- lean (Idle_Rail);
- jump (start + land);
- kneel (crouch);
- lie down (LayToIdle held at its first frame; lasts, even to speak, until
  they get up);
- climb, throw, eat;
- flinch (gasp);
- bow (a nod);
- carry (Walk_Carry);
- handle (Interact: opened, reached, pulled, pressed, touched, lifted and
  more);
- bare "walked", "stepped" and "moved", "passed through", "returned to".

Cut, and why:
- **Point**: the free rig's only aiming pose is two-handed, so pointing read
  as an invisible gun.
- **Kiss, hug, wave, shrug**: no free clip exists. They stay on the "no
  move" list rather than being faked.

**Moves done to someone** (punch, push, shoot, give, follow, turn) find their
target:
- "punched him" is never the puncher himself;
- the pronoun can resolve to someone named a sentence later;
- an ambiguous one goes to nobody, with a note.

Then:
- a punch or a push **walks up first** (to 0.75 m) and the punch starts
  when he gets there;
- the target **reacts** (Hit_Head / Hit_Knockback / Hit_Chest), facing the
  one who did it;
- a hand-off moves the glass, gun or phone into the other hand.

**How a line is said changes how it's acted**: shouted/snapped 1.3× speed,
whispered 0.75×, laughed 1.15×, upset 0.85×. The speaker faces whoever spoke
last, not just "the other one", which matters with three people.

**Build one** (Cast → "Change …'s look"):
- body, hair (6: long, parted, buns, buzzed, buzzed fine, none), beard;
- **skin tone** (light, tan, brown, deep);
- hair, top, trousers and shoe colours.

A look is kept per name on the device and sanitised by `cleanLook` (a test
feeds it junk, and a `null` look crashed it before that test existed). Two
new free hairstyles add 0.1 MB.

**Found by looking:** the pack's "Light" and "Dark" skin textures are **the
same tone** (mean sRGB 169/121/87 vs 163/115/81). Swapping them changed
nothing. Skin tone is now a per-channel gain on the one texture, which keeps
lips redder than cheeks. The painted clothes read their shading from the
texture before that gain, or a light skin washed out the clothes.

**Tested:**
- `tests/film.test.mjs`: punch walks up / lands / reaction, hand-off, lying
  lasts through someone else's line, run faster than walk, shout faster
  than whisper, turn away then face again, ambiguous pronoun acted by
  nobody, `cleanLook`, and every clip (reactions included) read from the
  shipped GLBs. Mutation-checked: no reaction, no walking up, hand-off
  keeping the item, lying not lasting (survived until a test with someone
  else speaking was added), manner ignored, turn ignored, an object pronoun
  resolving to the doer.
- `tests/film-browser.mjs`: builds Ruth's own look on a touch screen and
  checks the stage drew it (skin gain, the chosen hair), and that it
  survives a reload.
- The acting's pictures were checked by eye (a punch landing, lying on the
  floor, running, leaning, a hand-off), not by an automated test.

**Not tested:** any of it on a phone, and on a writer's real scene.

## Stage 4 as built: sound and faces

**Sounds from what the story does** (`film.mjs` `soundCues`, made in
`web/film/sound.mjs`). They are made on the page from noise and tones: no
audio files, no download, nothing recorded from anywhere.
- a gunshot as the pistol fires;
- a punch as it lands;
- a thud when someone falls, is pushed, or dies;
- a clink when someone drinks;
- the phone ringing *before* it's answered;
- a door when someone comes into or leaves a room (not outside);
- footsteps while anyone walks, quicker when they run.

Nothing is heard that the story didn't do. A letter handed over makes no
clink, and a story with only talk has no sound but its voices. **On by
default.**

**Each place's sound** (`ambience`):
- a bar's murmur, with glasses now and then;
- a street's traffic, with cars passing (fewer and quieter at night);
- a park's wind and birds (crickets at night);
- **rooms are silent.** A room tone is what the owner heard as a hum.

**Off by default**, one checkbox away. The music bed stays off by default
too.

The preview plays the same sounds as the scene reaches them. Each place's
sound starts and stops with its scene. The video mixes them with the
recordings.

**Levels were measured, not guessed:** peak and RMS of every cue and place,
rendered offline. The first gunshot peaked at **1.25** (clipping) and was
cut to 0.74. Footsteps peaked at 0.016 (inaudible) and were raised to 0.056;
the ring from 0.047 to 0.11.

**Faces: the free bodies can't open their mouths.**
- No morph targets and no jaw bone (stage 0's inventory).
- **The meshes are completely closed.** Counting boundary edges finds 0 on
  both bodies, head included, so there is no gap between the lips for any
  jaw movement to open.
- The planned "jaw morph test" was answered by that count and not built.

What speaking can be instead: **the speaker's head moves with the voice**.
It nods on loud syllables and tilts slowly through the line.
- For a recorded line the loudness is the recording's own (`rmsEnvelope`,
  at the pitch the person chose).
- Otherwise it follows the words' syllables (`textEnvelope`: one pulse per
  vowel group, with a pause at the end of the line).

**Also found:** "walked **into** the kitchen" wasn't an entrance, because
the rule wanted the word to end at "in". Fixed ("into" for came, walked,
went, stepped and burst). The corpus score moved from 63.1% to 63.5%.

**Tested** (`tests/film-sound-browser.mjs`, touch screen; mutation-checked:
video without effects, video without the place, preview without effects,
background on by default, no head movement):

- effects on and background off by default;
- the preview hears the street, the gunshot and the thud in that order;
- in the video, a gunshot at the moment the gun fires, over silence where
  only talk happens;
- the street's sound only when switched on;
- silence with both off;
- the head posed differently under a loud and a silent voice.

Unit tests cover the cues' timing and rules (one shot, a ring before the
answer, a door only indoors, quicker steps when running, nothing for talk),
the place per scene, and both envelopes.

**Not tested:** how any of it *sounds*. Levels are measured; whether a
synthesised gunshot or bar murmur sounds real is a judgement for someone
listening, on a phone speaker. Also not tested on a phone at all.

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
