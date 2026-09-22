// Regenerates web/stamps.mjs from Lucide's icon set.
//
// Why bundle icons at all: Qwen's tokenizer splits every digit into its own
// token, so coordinates are what a drawing costs — " 160" is four tokens.
// Nine primitive commands to draw a tree and a house cost 128 tokens; two
// stamp commands covering the same scene cost 26. Moving the shape of an
// object off the model and into the page is the single biggest saving
// available, and naming a noun is the easiest thing a small model does.
//
// Run: node scripts/build-stamps.mjs
// Network access to cdn.jsdelivr.net is required; the output is committed.
import { writeFile } from "node:fs/promises";

const VERSION = "1.47.0";
const CDN = `https://cdn.jsdelivr.net/npm/lucide-static@${VERSION}/icons`;

// Nouns a small model reaches for when asked to draw a simple scene. Names on
// the left are Lucide's; ALIASES below maps the words people and models
// actually use onto them.
const ICONS = [
  // outdoors
  "house", "trees", "tree-pine", "tree-deciduous", "sun", "moon", "cloud",
  "cloud-rain", "cloud-snow", "star", "mountain", "mountain-snow", "flower",
  "flower-2", "leaf", "sprout", "wheat", "snowflake", "droplet", "flame",
  "wind", "rainbow", "waves-horizontal", "zap", "road", "bridge", "fence",
  "tent", "castle", "church", "factory", "building", "store", "school",
  "hospital", "fuel", "traffic-cone", "signpost", "flag", "map-pin", "globe",
  // things that move
  "car", "truck", "bus", "bike", "plane", "sailboat", "ship", "train-front",
  "rocket", "anchor",
  // living things
  "user", "users", "baby", "cat", "dog", "bird", "fish", "rabbit", "turtle",
  "bug", "squirrel", "face-grinning", "footprints", "ghost", "skull", "bone",
  "egg",
  // indoors
  "bed", "armchair", "sofa", "table", "lamp", "door-open", "app-window",
  "book", "book-open", "laptop", "smartphone", "camera", "clock", "calendar",
  "mail", "tv", "lightbulb", "battery", "wifi", "phone", "watch",
  // things to hold
  "heart", "umbrella", "key", "lock", "gift", "crown", "trophy", "target",
  "puzzle", "dice-5", "gamepad-2", "balloon", "volleyball", "music", "guitar",
  "palette", "pencil", "brush", "scissors", "hammer", "wrench", "shirt",
  "glasses", "backpack", "briefcase", "box", "package", "shopping-cart",
  // food
  "cake", "cake-slice", "coffee", "apple", "pizza", "carrot", "cup-soda",
  "glass-water", "utensils", "soup", "ice-cream-cone", "banana", "cherry",
  "grape", "citrus", "milk",
];

// Words -> icon names. A model that says "home" or "tree" must not fall
// through to a text label just because Lucide spells it differently.
const ALIASES = {
  home: "house", building2: "building", office: "building", shop: "store",
  tree: "tree-deciduous", pine: "tree-pine", forest: "trees", plant: "sprout",
  grass: "sprout", bush: "trees", water: "waves-horizontal",
  sea: "waves-horizontal", ocean: "waves-horizontal", wave: "waves-horizontal",
  river: "waves-horizontal", lake: "waves-horizontal", rain: "cloud-rain",
  snow: "cloud-snow", fire: "flame", lightning: "zap", hill: "mountain",
  person: "user", people: "users", man: "user", woman: "user", child: "baby",
  boy: "baby", girl: "baby", kid: "baby", face: "face-grinning",
  smile: "face-grinning", happy: "face-grinning", head: "face-grinning",
  bunny: "rabbit", puppy: "dog", kitten: "cat", boat: "sailboat",
  yacht: "sailboat", train: "train-front", bicycle: "bike", cycle: "bike",
  airplane: "plane", aeroplane: "plane", jet: "plane", van: "truck",
  lorry: "truck", window: "app-window", door: "door-open", couch: "sofa",
  chair: "armchair", seat: "armchair", light: "lightbulb", lamppost: "lamp",
  computer: "laptop", mobile: "smartphone", television: "tv", telly: "tv",
  ball: "volleyball", football: "volleyball", toy: "puzzle", dice: "dice-5",
  game: "gamepad-2", controller: "gamepad-2", paint: "palette", pen: "pencil",
  bag: "backpack", parcel: "package", cart: "shopping-cart", food: "utensils",
  drink: "cup-soda", cup: "coffee", tea: "coffee", fruit: "apple",
  icecream: "ice-cream-cone", clothes: "shirt", sign: "signpost",
  pin: "map-pin", earth: "globe", world: "globe", note: "music",
  bulb: "lightbulb", cone: "traffic-cone", petrol: "fuel", gas: "fuel",
};

// Lucide draws on a 24x24 box with <path>, <circle>, <rect> and <line>.
// Normalising them all into path data keeps the runtime to one element type.
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([-\\d.]+)"`));
  return m ? +m[1] : 0;
};
const circleToPath = (cx, cy, r) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
const rectToPath = (x, y, w, h, rx) => rx
  ? `M${x + rx} ${y}h${w - rx * 2}a${rx} ${rx} 0 0 1 ${rx} ${rx}v${h - rx * 2}` +
    `a${rx} ${rx} 0 0 1 ${-rx} ${rx}h${-(w - rx * 2)}a${rx} ${rx} 0 0 1 ${-rx} ${-rx}` +
    `v${-(h - rx * 2)}a${rx} ${rx} 0 0 1 ${rx} ${-rx}z`
  : `M${x} ${y}h${w}v${h}h${-w}z`;

async function iconPaths(name) {
  const res = await fetch(`${CDN}/${name}.svg`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const svg = await res.text();
  const paths = [...svg.matchAll(/<path\s+d="([^"]+)"/g)].map(m => m[1]);
  for (const [tag] of svg.matchAll(/<circle\b[^>]*>/g)) {
    paths.push(circleToPath(attr(tag, "cx"), attr(tag, "cy"), attr(tag, "r")));
  }
  for (const [tag] of svg.matchAll(/<rect\b[^>]*>/g)) {
    paths.push(rectToPath(attr(tag, "x"), attr(tag, "y"), attr(tag, "width"),
      attr(tag, "height"), attr(tag, "rx")));
  }
  for (const [tag] of svg.matchAll(/<line\b[^>]*>/g)) {
    paths.push(`M${attr(tag, "x1")} ${attr(tag, "y1")}L${attr(tag, "x2")} ${attr(tag, "y2")}`);
  }
  for (const [tag, kind] of svg.matchAll(/<(polyline|polygon)\b[^>]*>/g)) {
    const pts = (tag.match(/points="([^"]+)"/) || [, ""])[1].trim().split(/[\s,]+/);
    paths.push("M" + pts.join(" ").replace(/^(\S+ \S+) /, "$1L") +
      (kind === "polygon" ? "z" : ""));
  }
  const other = svg.replace(/<(path|circle|rect|line|polyline|polygon)[^>]*>/g, "");
  if (/<ellipse\b/.test(other)) {
    throw new Error(`${name}: unsupported element — extend the extractor`);
  }
  if (!paths.length) throw new Error(`${name}: no geometry`);
  return paths;
}

const stamps = {};
for (const name of ICONS) stamps[name] = await iconPaths(name);

const size = JSON.stringify(stamps).length;
const out = `// GENERATED by scripts/build-stamps.mjs — do not edit by hand.
//
// Icon geometry from Lucide ${VERSION} (https://lucide.dev), ISC licensed:
// Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
// part of Feather (MIT). All other copyright (c) for Lucide are held by
// Lucide Contributors 2022. Permission to use, copy, modify, and/or
// distribute this software for any purpose with or without fee is hereby
// granted, provided that the above copyright notice and this permission
// notice appear in all copies.
//
// Every path is drawn on Lucide's 24x24 box, stroke-only, so a stamp renders
// with the same pen as the primitives once it is scaled into place.
export const STAMP_BOX = 24;
export const STAMPS = ${JSON.stringify(stamps, null, 0).replace(/","/g, '", "').replace(/\],"/g, '],\n  "').replace(/^\{"/, '{\n  "').replace(/\]\}$/, "]\n}")};

export const ALIASES = ${JSON.stringify(ALIASES, null, 0).replace(/,"/g, ',\n  "').replace(/^\{"/, '{\n  "').replace(/"\}$/, '"\n}')};
`;
await writeFile(new URL("../web/stamps.mjs", import.meta.url), out);
console.log(`web/stamps.mjs: ${ICONS.length} stamps, ${Object.keys(ALIASES).length} aliases, ${(size / 1024).toFixed(1)} KB of path data`);
