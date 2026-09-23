# Scene mode — why desktop sketches stopped asking the model for coordinates

The request was "a better sketch on desktop — more complicated, and looking
hand-drawn". The first measurement said the rendering was not the problem.

Everything here is Qwen3 on Ollama on CPU (GGUF Q4_K_M), not the MLC build a
browser serves; it measures what the prompts get out of a model of that size.

## What the coordinate format did on real scenes

Qwen3-1.7B — the desktop default — asked for five scenes past "a house and a
tree", with the page's shipped coordinate prompt at a 4096 context:

| Request | What came back |
|---|---|
| a cosy cabin in the woods at night | one house, then **the same rectangle ten times** (40 commands) |
| a sunny beach with people and boats | the prompt's example — `sun 82 14 16`, `line 5 78 95 78` — then that ground line **31 times** |
| a farm with animals and a tractor | `house tree sun cloud car person cat dog flower mountain boat` — **the prompt's example stamp list, in order**, then lines marching down to y=245 on a 0–100 grid |
| a city street with shops and cars | **40 horizontal lines**, nothing else |
| a birthday party in the garden | every object at `50 52 34`, the example's coordinates |

30–50 seconds each on CPU, because 40 commands of digits is a lot of tokens.
`sketch-bench.mjs` never showed this: its requests are all simple.

This is the project's oldest sketch finding at a larger scale — naming is the
easy half, placing is the hard half — and the answer is the same one:
**if the page can compute it, the prompt should not ask for it.**

## Scene mode

On a model of 1.5B or more at a 2048+ context, the prompt asks for a list of
things, not coordinates: `["cabin x1", "moon", "star x2", "fire front",
"tree x3"]`. `composeScene()` in `web/scene.mjs` places them — sky things along
the top, mountains on the horizon, big things standing on it, small things in
front, water behind the shore with boats on it — and writes ordinary
coordinate commands, so the commands panel still shows and edits them. Setting
words ("beach", "street", "lake", "night") become backdrops the renderer draws
as hatched washes: a night sky, grass with tufts, sand, a sea with waves, a
road.

Same model, same five requests plus two more:

| | Coordinates | Scene mode |
|---|---|---|
| loops | 4 of 5 | 0 of 7 |
| copied the prompt's example | 3 of 5 | 0 of 7 (final prompt) |
| anything off the canvas | 2 of 5 | impossible — the page places everything |
| time per drawing (CPU) | 9–50 s | ~2 s |

## What the prompt had to learn

- **"house 4" made it number its entries** — `palm 3, house 4, person 5,
  flower 6`. Counts are written `x3`, and the page caps counts where more than
  one makes no sense (`5 suns` → one sun).
- **The example leaks.** With a snowy-village-at-night example, moon and stars
  turned up in a sunny birthday party and a mountain in a city street. The
  example is now a harbour, the prompt says moon and stars are for night, and
  the page decides: a sun means day and drops a leaked moon; rain drops a sun.
- **Setting words are not things.** "beach", "farm", "blue sky", "green grass"
  came back as entries. They shape the backdrop and are never printed. The
  stamp matcher's loose prefix rule had turned "sky" into a building (via
  "skyscraper"), so settings are checked first.
- **Things with no drawing stay words.** Lucide has no cow, pig or horse; they
  are written on the picture in hand lettering and named in the note under it,
  rather than drawn as the nearest animal, which would be confidently wrong.

## Not for phones, on the numbers

| Model | Scene prompt |
|---|---|
| Qwen2.5-0.5B (phone default) | looped to the 40-entry limit on 5 of 7 scenes |
| Qwen3-0.6B | copied the example ("lighthouse", "crane") into 3 of 7 |
| Qwen3-1.7B | clean on 7 of 7 |

Phones keep the coordinate path that was proven on one. `?scene=1` forces
scene mode on any model, `?scene=0` turns it off.

## The hand-drawn look

All of it is the page's, and costs the model nothing: warm paper; hatched
backdrops; a coloured-pencil wash under every coloured stamp; a tilt of a few
degrees per stamp, seeded so every render agrees; hand lettering from fonts the
system already has (Chalkboard, Segoe Print, Bradley Hand — no web font, the
page works offline). The composer also picks natural colours when the model
names none: green trees, a yellow sun, a blue sea.

## Also shipped

- **Exact duplicate commands are skipped** in the coordinate parser too, and
  the caption says how many. A loop is not a drawing, and nobody means an
  exact duplicate.
- Six stamps: tractor, palm tree, party popper, shell, snail, floor lamp.

## Open

- **No real browser has drawn a scene.** Everything above is Ollama plus the
  page's real composer and renderer in headless Chromium. The desktop
  `Qwen3-1.7B-q4f16_1` build has not generated a scene on a GPU.
- Seven requests. Treat the table as a direction.
- The layout is a single band of rows. Two big things the model wants side by
  side and a small thing it wants *on* one ("a cat on the roof") are beyond it.
