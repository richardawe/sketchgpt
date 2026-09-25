// Scene mode — the model says WHAT is in the picture; the page decides WHERE.
//
// Asked for anything past "a house and a tree", Qwen3-1.7B broke on
// coordinates in three ways, all measured on real output (docs/sketch-scenes.md):
//
//   loops      "a city street" came back as 40 horizontal lines, "a cabin in
//              the woods" as the same rectangle drawn ten times
//   copying    "a farm" came back as house tree sun cloud car person cat dog
//              flower mountain boat — the prompt's own example list, in order —
//              and every object at the example's coordinates, 50 52 34
//   overflow   y values up to 245 on a 0–100 grid
//
// This is the project's oldest sketch finding at a larger scale: naming is the
// easy half, placing is the hard half, and the page can simply do the placing.
// So on a model big enough to plan a scene, the prompt asks for a list of
// things — "cabin", "pine 5", "moon", "star 6 yellow" — and composeScene()
// turns that list into ordinary coordinate commands: sky things along the top,
// big things at the back, small things in front, water where there are boats.
// The result is the same format the commands panel shows and edits, so
// nothing downstream changes, and a person can still move anything by hand.

import { resolveStamp, PALETTE, GRID } from "./sketch.mjs?v=9";
import { ART_NAMES } from "./art-names.mjs?v=8";

// Names that have a full-colour illustration. Those keep their own colours;
// the composer only picks a colour for the line icons.
const ILLUSTRATED = new Set(Object.values(ART_NAMES));

// ---- Prompt ---------------------------------------------------------------

// Measured on Qwen3-1.7B (docs/sketch-scenes.md), two things decided this
// prompt. A count after the noun as a bare number ("house 4") made it NUMBER
// its entries — palm 3, house 4, person 5, flower 6 — so the count is "x3".
// And the example's night sky leaked: moon and stars turned up in a sunny
// birthday party. The example is now a harbour, with nothing in its sky a
// daytime request would copy, and the rule about night is stated.
// One single-thing example stays, because a small model has to SEE that one
// entry is allowed (the two-cats finding).
const SCENE_EXAMPLES = [
  `Draw a cat -> {"t":"A cat","c":["cat"]}`,
  `Draw a quiet harbour -> {"t":"A quiet harbour","c":["boat x2","lighthouse","bird x4 sky","fish water","crane back"]}`,
];

export function scenePrompt(maxEntries = 14) {
  return `Plan the user's picture as JSON: {"t":"short title","c":[one entry per kind of thing in it]}
Each entry: a thing in one or two plain words, then xN if there are several (tree x3), then a colour if it matters, then where if it matters (left, right, sky, back, front, water).
Things you can use include: tree, pine, palm, house, shop, car, bus, tractor, boat, sun, moon, cloud, star, flower, person, child, dog, cat, cow, horse, pig, sheep, chicken, duck, bird, fish, mountain, tent, fire, road, balloon, cake, gift.
List what the request asks for first, then a few things that belong in that place. Never repeat an entry. Only put a moon or stars in a night picture.
${SCENE_EXAMPLES.join("\n")}
Use ${maxEntries} entries or fewer. No coordinates, no code, no explanation. When changing an earlier picture, list the whole new picture.`;
}

// ---- Reading the model's list -----------------------------------------------

const PLACES = new Set(["left", "right", "middle", "centre", "center", "sky", "back", "front", "water",
  "behind", "far", "near", "top", "bottom", "foreground", "background"]);
const PLACE_OF = { centre: "middle", center: "middle", behind: "back", far: "back", background: "back",
  near: "front", foreground: "front", top: "sky", bottom: "front" };

// Words that name the setting rather than a thing in it. Measured: "beach",
// "farm", "street", "blue sky", "green grass" all came back as entries, and
// printing them as words on the picture helps nobody. They shape the backdrop.
const SETTINGS = {
  beach: "water", sea: "water", ocean: "water", lake: "water", river: "water", harbour: "water",
  harbor: "water", coast: "water", sand: "water", seaside: "water",
  street: "road", road: "road", city: "road", town: "road", traffic: "road",
  night: "night", dark: "night", midnight: "night", evening: "dusk", sunset: "dusk", dusk: "dusk",
  sky: "none", grass: "none", ground: "none", garden: "none",
  campsite: "none", camping: "none", day: "none", sunny: "none", rainy: "rain", weather: "none",
  // Settings with a backdrop of their own (web/sketch.mjs drawBackdrops):
  // rolling hills, a far treeline, snow on the ground, a town's skyline, and
  // a room — the one place that is not outdoors.
  field: "hills", farm: "hills", meadow: "hills", countryside: "hills", park: "hills", hills: "hills",
  forest: "forest", woods: "forest", jungle: "forest",
  snow: "snow", snowy: "snow", winter: "snow", ice: "snow",
  village: "town", town: "town", city: "town",
  room: "room", bedroom: "room", kitchen: "room", indoors: "room", inside: "room", bathroom: "room", classroom: "room",
};

// Things there is only ever one of, or never many. Measured: "5 suns", and
// "sun x2" when the model was numbering its entries rather than counting.
const MAX_COUNT = { sun: 1, moon: 1, rainbow: 1, road: 1, "tree-palm": 4, house: 4, building: 4,
  store: 4, church: 1, castle: 1, school: 1, hospital: 1, factory: 2, tent: 3, star: 12, bird: 6,
  flower: 8, "flower-2": 8, cloud: 4, "cloud-rain": 4, user: 5, users: 3, car: 5, sailboat: 4,
  ship: 2, fish: 5, "tree-pine": 6, "tree-deciduous": 6, trees: 3, mountain: 3, "mountain-snow": 3,
  tractor: 2, bus: 2, truck: 2, balloon: 6, cake: 1, gift: 4, dog: 3, cat: 3 };

/**
 * One entry → { stamp, said, count, colour, place, setting }. Nouns are tried
 * as a whole phrase, then left to right ("pine tree" → pine, "cake on table" →
 * cake, "children playing" → child). A thing with no stamp comes back with
 * stamp null and is shown as its word — visible — rather than drawn as the
 * nearest icon, which would be confidently wrong. A setting word comes back
 * with `setting` and no stamp, and is drawn as backdrop.
 */
export function parseEntry(raw) {
  const words = String(raw).toLowerCase().replace(/[×]/g, "x").replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  let count = 1, colour = null, place = null, scale = 1;
  const nouns = [];
  for (const w of words) {
    const n = w.match(/^x?(\d+)x?$/);
    if (n) count = Math.max(1, Math.min(8, Number(n[1])));
    // Size words: a story's hero is drawn big, a far-off bird small.
    else if (/^(big|large|huge|giant|tall)$/.test(w)) scale = 1.7;
    else if (/^(small|little|tiny)$/.test(w)) scale = 0.7;
    else if (Object.hasOwn(PALETTE, w)) colour = w;
    else if (PLACES.has(w)) place = PLACE_OF[w] || w;
    else if (!/^(a|an|the|some|of|and|with|in|on|at|by|x|lots|many|few|several|playing|sitting|standing|flying|swimming|parked)$/.test(w)) nouns.push(w);
  }
  // "sky" or "front" on its own: nothing to draw.
  if (!nouns.length) return null;
  // Settings are checked BEFORE the stamp matcher, whose prefix rule is loose
  // on purpose: it turned "sky" into a building, via "skyscraper".
  if (nouns.every(w => SETTINGS[w])) {
    return { stamp: null, said: nouns.join(" "), count: 1, colour, place, setting: SETTINGS[nouns[0]], scale };
  }
  let stamp = resolveStamp(nouns.join(""), { phrase: nouns.length > 1 });
  for (let i = 0; !stamp && i < nouns.length; i++) {
    if (SETTINGS[nouns[i]] && nouns.length > 1) continue;
    stamp = resolveStamp(nouns[i]);
  }
  const settingWord = nouns.find(w => SETTINGS[w]);
  if (settingWord && (!stamp || stamp === "waves-horizontal" || stamp === "road")) {
    return { stamp: null, said: nouns.join(" "), count: 1, colour, place, setting: SETTINGS[settingWord], scale };
  }
  if (stamp && MAX_COUNT[stamp]) count = Math.min(MAX_COUNT[stamp], count);
  return { stamp, said: nouns.join(" "), count, colour, place, setting: null, scale };
}

/**
 * Is this list a scene plan, or a coordinate drawing? A model asked for a plan
 * may still answer in coordinates (and the tests' stub always does). Most
 * entries carrying two or more numbers means coordinates, and those go through
 * the ordinary sketch parser untouched.
 */
export function looksLikeCoordinates(entries) {
  const numeric = entries.filter(e => (String(e).match(/-?\d+(\.\d+)?/g) || []).length >= 2).length;
  return numeric * 2 > entries.length;
}

// ---- Composing ---------------------------------------------------------------

const SKY = new Set(["sun", "moon", "cloud", "cloud-rain", "cloud-snow", "star", "bird", "plane",
  "rainbow", "balloon", "rocket", "snowflake", "zap", "wind", "helicopter", "ufo", "kite",
  "parachute", "eagle", "planet", "comet", "satellite", "parrot"]);
const WATER = new Set(["sailboat", "ship", "fish", "anchor", "turtle", "shell", "whale", "dolphin",
  "shark", "octopus", "crab", "tropical-fish", "swimmer", "surfer", "canoe", "speedboat", "swan", "wave"]);
const FAR = new Set(["mountain", "mountain-snow", "volcano"]);
const BIG = new Set(["house", "house-garden", "hut", "building", "store", "school", "hospital",
  "church", "castle", "factory", "tent", "circus", "stadium", "fountain", "ferris-wheel",
  "roller-coaster", "carousel", "statue", "crane", "island", "tree-pine", "tree-deciduous", "trees",
  "tree-palm", "christmas-tree", "bridge", "fuel", "train-front", "tram", "bus", "truck", "tractor",
  "fire-engine", "beach-umbrella", "giraffe", "elephant", "dinosaur", "t-rex", "dragon"]);
const SETTING = new Set(["waves-horizontal", "road"]);   // drawn as backdrop, not as a stamp
// Big outdoor things that are never inside a room.
const OUTDOORS = new Set(Array.from(BIG).filter(s => !/^(giraffe|elephant|dinosaur|t-rex|dragon|christmas-tree|fountain|statue)$/.test(s)));

// Sizes in grid units. The page owns these for the same reason it owns the
// coordinates: a 1.7B model sized a cat as big as the house it sat beside.
const SIZE = {
  sun: 15, moon: 13, cloud: 17, "cloud-rain": 17, "cloud-snow": 17, star: 5, bird: 7, plane: 12,
  rainbow: 26, balloon: 9, rocket: 14, snowflake: 5,
  mountain: 40, "mountain-snow": 40,
  house: 26, building: 30, store: 24, school: 28, hospital: 28, church: 28, castle: 32,
  factory: 30, tent: 20, "tree-pine": 24, "tree-deciduous": 24, trees: 26, "tree-palm": 26,
  bridge: 30, truck: 20, bus: 22, tractor: 18, "train-front": 18,
  car: 16, bike: 12, user: 12, users: 15, baby: 9, cat: 9, dog: 10, rabbit: 8, squirrel: 8,
  flower: 7, "flower-2": 7, sprout: 7, wheat: 8, flame: 10, sailboat: 18, ship: 20, fish: 7,
  turtle: 8, shell: 6, "party-popper": 10, gift: 9, cake: 11, balloon2: 9, fence: 14,
  "lamp-floor": 14, signpost: 11, "traffic-cone": 7, snail: 6, bug: 5,
  // the illustrations' own nouns
  cow: 15, horse: 16, pig: 12, sheep: 12, goat: 11, chicken: 8, rooster: 8, duck: 8, swan: 10,
  elephant: 22, giraffe: 26, zebra: 16, lion: 15, tiger: 16, camel: 18, bear: 14, deer: 14,
  fox: 10, monkey: 11, penguin: 10, kangaroo: 14, dinosaur: 28, "t-rex": 26, dragon: 26, unicorn: 16,
  owl: 8, eagle: 10, parrot: 8, bee: 5, butterfly: 6, frog: 7, snake: 10, mouse: 6, hedgehog: 7,
  whale: 24, dolphin: 14, shark: 16, octopus: 10, crab: 7, "tropical-fish": 7,
  helicopter: 14, ufo: 14, kite: 9, parachute: 12, planet: 12, comet: 10,
  "house-garden": 28, hut: 20, circus: 28, stadium: 32, fountain: 18, "ferris-wheel": 32,
  "roller-coaster": 32, carousel: 24, statue: 26, crane: 30, island: 30, volcano: 38,
  "christmas-tree": 24, "beach-umbrella": 18, bed: 30, sofa: 30, armchair: 18, chair: 14, "lamp-floor": 20, "fire-engine": 20, ambulance: 18, taxi: 16,
  "police-car": 16, motorbike: 12, tram: 20, canoe: 14, speedboat: 16, surfer: 13, swimmer: 12,
  girl: 10, boy: 10, child: 10, me: 15, runner: 12, cyclist: 13, dancer: 12, farmer: 13, cook: 13, astronaut: 13, santa: 14, snowman: 16,
  family: 16, picnic: 9, "christmas": 24, pumpkin: 9, fireworks: 16, sparkler: 8,
};
const sizeOf = s => SIZE[s] || 11;
// An entry's size: the page's size for the thing, times any size word.
// "Big" on a thing that is already big stops at 30: a big dragon (26 x 1.7)
// swallowed the castle behind it and ran off the cover.
const sized = e => Math.min(sizeOf(e.stamp) * (e.scale || 1), Math.max(sizeOf(e.stamp), 30));

// Colour the page adds when the model names none. It needs no tokens and
// makes the picture read at a glance — "enrichment is free if it needs no
// tokens". A colour the model DID name always wins.
const NATURAL = {
  sun: "yellow", moon: "yellow", star: "yellow", "tree-pine": "green", "tree-deciduous": "green",
  trees: "green", "tree-palm": "green", sprout: "green", flower: "pink", "flower-2": "red",
  flame: "orange", sailboat: "blue", ship: "blue", fish: "orange", rainbow: "purple",
  apple: "red", heart: "red", cake: "pink", gift: "red", balloon: "red", "party-popper": "purple",
  wheat: "yellow", cloud: "grey", "cloud-rain": "grey", "cloud-snow": "grey", tractor: "red",
  mountain: "brown", "mountain-snow": "brown", car: "red", bus: "yellow", house: "brown",
  tent: "orange", dog: "brown", cat: "orange", rabbit: "brown", bird: "blue",
};

// The model's colour always wins; otherwise a line icon gets a natural colour
// and an illustration keeps the colours it was drawn with.
const tint = s => s.colour || (ILLUSTRATED.has(s.stamp) ? null : NATURAL[s.stamp]);

// Deterministic jitter from the title, so a re-render, a download and a
// screenshot all agree — the same rule renderSketch follows.
function rng(seedText) {
  let h = [...seedText].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 2166136261) || 1;
  return () => ((h = (h ^ (h << 13)) >>> 0, h = (h ^ (h >>> 17)) >>> 0, h = (h ^ (h << 5)) >>> 0) % 10000) / 10000;
}

const ORDER = { left: 0, middle: 1, right: 2 };

// Spread n things across [from, to], respecting left/middle/right, with a
// little jitter so a row of trees does not look like a fence.
function row(items, from, to, rand) {
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) =>
    (ORDER[a.it.place] ?? 1) - (ORDER[b.it.place] ?? 1) || a.i - b.i).map(o => o.it);
  const n = sorted.length;
  const step = (to - from) / n;
  return sorted.map((it, i) => ({ ...it, x: from + step * (i + 0.5) + (rand() - 0.5) * step * 0.35 }));
}

const r1 = n => Math.round(n * 10) / 10;
// Every picture stays wholly inside the frame: a row spreads centres across
// the page without knowing sizes, and a big thing at the edge was cut in half.
const inside = (v, size) => Math.max(size / 2 + 1, Math.min(GRID - size / 2 - 1, v));
const cmd = (stamp, x, y, size, colour) =>
  `${stamp} ${r1(inside(x, size))} ${r1(inside(y, size))} ${r1(size)}${colour ? " " + colour : ""}`;

/**
 * A scene plan → { t, c } in the ordinary coordinate format, plus what the page
 * decided so the caption can say it. Pure: same plan, same picture.
 */
export function composeScene(plan) {
  const title = String(plan.t || "A picture").slice(0, 80);
  const rand = rng(title);
  const entries = [];
  const seen = new Set();
  const settings = new Set();
  const settingsSaid = [];
  for (const raw of (plan.c || []).slice(0, 24)) {
    const e = parseEntry(raw);
    if (!e) continue;
    if (e.setting) { settings.add(e.setting); settingsSaid.push(e.said); continue; }
    // A loop is a list that repeats itself. Measured: 40 identical lines.
    const key = (e.stamp || e.said) + "|" + (e.place || "");
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(e);
  }

  const lower = title.toLowerCase();
  const all = entries.map(e => e.stamp);
  // A sun means day, whatever else leaked into the list — the example's moon
  // once turned a sunny birthday party into a night scene.
  // Rain rules out a sun the way a sun rules out a moon: measured, the model
  // put "sun front" in "a rainy day in town".
  const rain = settings.has("rain") || /rain|storm|wet|drizzle/.test(lower) ||
    all.includes("cloud-rain") || all.includes("umbrella");
  const sun = all.includes("sun") && !rain;
  const night = !sun && (settings.has("night") || /night|dark|midnight/.test(lower) ||
    all.includes("moon") || all.includes("star"));
  // Sunset is its own sky: warm, with the sun low on the horizon. Measured in a
  // story — "as the sun dipped below the horizon" got a midday sky.
  const dusk = !night && !rain && (settings.has("dusk") ||
    /sunset|sun ?set|dusk|evening|dipped|twilight|setting sun|golden hour/.test(lower));
  const water = settings.has("water") ||
    entries.some(e => e.stamp && (WATER.has(e.stamp) || e.stamp === "waves-horizontal" || e.place === "water")) ||
    /beach|sea|ocean|lake|harbou?r|river|coast/.test(lower);
  const road = settings.has("road") || all.includes("road") || /street|road/.test(lower);
  // The new backdrops, from the list or from the page's own words. A room is
  // indoors: its sky is only what the window shows.
  // A bed is indoors too: "Max went home to his warm bed" was drawn on grass.
  const room = settings.has("room") || all.includes("bed") || /\b(bedroom|kitchen|bathroom|classroom|living room|indoors|inside|(?:in|into|to|on) (?:his|her|their|my|your|a|the) (?:warm |cosy |cozy |little |own |big )?bed|under the covers)\b/.test(lower);
  const snow = !room && (settings.has("snow") || /\b(snow\w*|winter|icy|frozen)\b/.test(lower));
  const forest = !room && (settings.has("forest") || /\b(forest|woods|jungle)\b/.test(lower));
  const town = !room && (settings.has("town") || /\b(town|city|village)\b/.test(lower));
  const hills = !room && !town && (settings.has("hills") || /\b(farm|field|meadow|countryside|hills?|park)\b/.test(lower));

  // With water, the picture is laid out the way people draw a beach or a
  // lakeside: sky, then the water, then the shore in front. Boats sit on the
  // water, tents and people on the shore. The first version put the sea in the
  // FRONT, and a camp by a lake came out with the lake between you and it.
  const beach = water && (/beach|sand|coast|seaside/.test(lower) ||
    entries.some(e => /beach|sand/.test(e.said)) || settingsSaid.some(w => /beach|sand|coast|seaside/.test(w)));
  const horizon = room ? 70 : water ? 46 : 62;      // where the sky (or the wall) ends
  const shore = water && !room ? 68 : horizon;   // where the land in front begins
  const out = [];
  out.push(night ? "sky night" : rain ? "sky rain" : dusk ? "sky dusk" : "sky day");
  if (room) out.push(`room ${horizon}`);
  else {
    // Far things first: they stand on the horizon, behind everything.
    if (hills) out.push(`hills ${horizon}`);
    if (forest) out.push(`forest ${horizon}`);
    if (town) out.push(`town ${horizon}`);
    if (water) out.push(`water ${horizon}`);
    out.push(`${beach ? "sand" : snow ? "snow" : "ground"} ${shore}`);
    if (road && !water) out.push(`road ${horizon + 20}`);
  }

  const sky = [], far = [], back = [], front = [], sea = [], labels = [];
  for (const e of entries) {
    if (!e.stamp) { labels.push(e); continue; }
    if (SETTING.has(e.stamp)) continue;
    const copies = Array.from({ length: e.count }, (_, i) => ({ ...e, copy: i }));
    const where = e.place;
    // Sky things live in the sky whatever the model said: "sun front" once put
    // the sun on the grass beside the cake.
    if (where === "sky" || SKY.has(e.stamp)) sky.push(...copies);
    else if (where === "water" || (water && WATER.has(e.stamp))) sea.push(...copies);
    else if (FAR.has(e.stamp)) far.push(...copies);
    else if (where === "front") front.push(...copies);
    else if (where === "back" || BIG.has(e.stamp)) back.push(...copies);
    else front.push(...copies);
  }

  // Sky: the sun or moon takes a corner; stars scatter; the rest share a band.
  // In daylight a leaked moon or stars are dropped rather than drawn beside
  // the sun; night is decided above, from the whole list.
  // Indoors the sky is the window's: a sun or a bird is not drawn on the wall,
  // and nor is a house, a tree or a bus — "went home to his bed" drew a house
  // standing on the bedroom floor.
  if (room) {
    sky.splice(0); far.splice(0);
    for (const list of [back, front]) for (let i = list.length - 1; i >= 0; i--)
      if (OUTDOORS.has(list[i].stamp)) list.splice(i, 1);
  }
  const lights = sky.filter(s => (s.stamp === "sun" && !rain) || (s.stamp === "moon" && night));
  const stars = night ? sky.filter(s => s.stamp === "star") : [];
  const skipped = sky.filter(s => (!night && (s.stamp === "moon" || s.stamp === "star")) ||
    (rain && s.stamp === "sun"));
  const floaters = sky.filter(s => !lights.includes(s) && !stars.includes(s) && !skipped.includes(s));
  lights.forEach((s, i) => {
    const x = s.place === "left" ? 14 + i * 16 : 84 - i * 16;
    const setting = dusk && s.stamp === "sun";
    out.push(cmd(s.stamp, x, setting ? horizon - 8 : 15, sizeOf(s.stamp) * (setting ? 1.3 : 1), tint(s)));
  });
  // A sunset needs its sun even when the list forgot it.
  if (dusk && !lights.length && !room) out.push(cmd("sun", 76, horizon - 8, sizeOf("sun") * 1.3, tint({ stamp: "sun" })));
  for (const s of stars) {
    out.push(cmd("star", 6 + rand() * 88, 5 + rand() * (horizon - 30),
      sizeOf("star") * (0.7 + rand() * 0.6), tint(s)));
  }
  for (const s of row(floaters, lights.length ? 12 : 8, lights.length ? 70 : 92, rand)) {
    out.push(cmd(s.stamp, s.x, 18 + rand() * 12, sizeOf(s.stamp) * (0.85 + rand() * 0.3),
      tint(s)));
  }

  // Far: mountains stand on the horizon, big and behind everything.
  for (const s of row(far, 5, 95, rand)) {
    const size = sized(s) * (0.9 + rand() * 0.25);
    out.push(cmd(s.stamp, s.x, horizon - size / 2 + 3, size, tint(s)));
  }

  // Back row stands on the horizon; if it is crowded, a second row in front of
  // it, a little smaller — depth by overlap, which is how a hand draws it.
  const backRows = back.length > 6 ? [back.slice(0, Math.ceil(back.length / 2)), back.slice(Math.ceil(back.length / 2))] : [back];
  backRows.forEach((items, r) => {
    // By water, stand clear of the shoreline: a tent drawn ON the line looked
    // as if it were pitched in the lake.
    const base = shore + (water ? 12 : 2) + r * 9;
    const scale = r ? 0.85 : 1;
    for (const s of row(items, 4, 96, rand)) {
      const size = sized(s) * scale * (0.9 + rand() * 0.2);
      out.push(cmd(s.stamp, s.x, base - size / 2, size, tint(s)));
    }
  });

  // Water: boats ride on it, a little smaller for being further off; fish
  // swim lower down in it; shells lie on the shore.
  for (const s of row(sea, 8, 92, rand)) {
    const size = sized(s) * (0.75 + rand() * 0.2);
    const y = s.stamp === "shell" ? shore + 6
      : s.stamp === "fish" || s.stamp === "turtle" ? shore - 5 - rand() * 4
      : horizon + 9 + rand() * 5;
    out.push(cmd(s.stamp, s.x, y, size, tint(s)));
  }

  // Front row: people, animals, flowers — standing lower on the page, which
  // reads as nearer. Labels for unknown things go here too, as words.
  const frontBase = 92;
  const frontItems = row([...front, ...labels.map(l => ({ ...l, label: true }))], 6, 94, rand);
  for (const s of frontItems) {
    if (s.label) { out.push(`label ${r1(s.x - 4)} ${r1(frontBase - 2)} ${s.said}`); continue; }
    const size = sized(s) * (0.9 + rand() * 0.2);
    const base = frontBase - (rand() * 4);
    out.push(cmd(s.stamp, s.x, Math.min(GRID - size / 2 - 1, base - size / 2), size, tint(s)));
  }

  return { t: title, c: out, drawn: entries.filter(e => e.stamp).length, unknown: labels.map(l => l.said) };
}

/**
 * Where a page is, from its own words — the place, not the time of day. A
 * page that names no place is still where the page before it was: "Max ran
 * down to the beach" and then "He splashed in the waves" is the same beach,
 * though the second page never says so. Returned as entries composeScene
 * reads as settings.
 */
export function placeOf(text, { wishes = false } = {}) {
  // "Pip wants to see the sea" puts nobody at the sea: a place in a wish, a
  // dream or a "never" is not where the page is (the same line animate.mjs
  // draws between a deed and a wish). `wishes` counts them anyway, to ask
  // whether a page mentions a place at all.
  const t = String(text).toLowerCase().split(/(?<=[.!?])\s+/)
    .filter(x => wishes || !/\b(wants?|wanted|dreams?|dreamed|dreamt|wish(?:es|ed)?|hopes?|never|not|can't|cannot|if only|would like|longs? to)\b/.test(x))
    .join(" ");
  const out = [];
  if (/\b(bedroom|kitchen|bathroom|classroom|living room|indoors|inside|(?:in|into|to|on) (?:his|her|their|my|your|a|the) (?:warm |cosy |cozy |little |own |big )?bed)\b/.test(t)) return ["room"];
  if (/\b(beach|seaside|shore|sand)\b/.test(t)) out.push("beach");
  else if (/\b(sea|ocean|waves|lake|river|pond|harbou?r)\b/.test(t)) out.push("sea");
  if (/\b(forest|woods|jungle)\b/.test(t)) out.push("forest");
  if (/\b(snow\w*|winter|icy|frozen)\b/.test(t)) out.push("snow");
  if (/\b(town|city|village)\b/.test(t)) out.push("town");
  else if (/\b(farm|field|meadow|countryside|hills?|park)\b/.test(t)) out.push("farm");
  return out;
}
