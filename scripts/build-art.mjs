// Regenerates web/art.mjs and web/art-names.mjs from Twemoji.
//
// Why: Lucide's line icons made every sketch look like a diagram. Twemoji is a
// full-colour illustration set with the nouns people actually ask for — a cow,
// a barn, a beach umbrella — and renderSketch redraws it through rough.js in an
// "ink and wash" style: flat colour with a slight hand wobble and a thin ink
// line, tiny details (eyes, windows) left crisp so faces do not smudge. The
// model still names a noun and nothing else; only the picture behind the name
// changed, so this costs no tokens and works on phones too.
//
// Twemoji graphics: CC-BY 4.0, (c) Twitter, Inc and other contributors,
// https://github.com/jdecked/twemoji — credited on the page, in the README,
// and inside every downloaded SVG.
//
// Run:  NODE_PATH=<dir with node_modules containing svg-path-bbox> node scripts/build-art.mjs
// Needs network access to cdn.jsdelivr.net; the output is committed.
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let svgPathBbox;
try { ({ svgPathBbox } = require("svg-path-bbox")); }
catch { console.error("Needs svg-path-bbox: npm install svg-path-bbox, then set NODE_PATH"); process.exit(1); }

const VERSION = "16.0.1";
const CDN = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${VERSION}/assets/svg`;

// [name, twemoji file (code points), ...aliases]. Names that Lucide already
// used (house, tree-deciduous, user, sailboat...) are kept, so a drawing's
// commands read the same as before and the tests' expectations still hold.
const ART = [
  // sky and weather
  ["sun", "2600", "sunshine"], ["moon", "1f319", "crescent"], ["star", "2b50", "stars"],
  ["cloud", "2601", "clouds"], ["cloud-rain", "1f327", "rain", "raincloud", "rainy"],
  ["cloud-snow", "1f328", "snow", "snowfall"], ["zap", "1f329", "lightning", "storm", "thunder"],
  ["rainbow", "1f308"], ["snowflake", "2744"], ["comet", "2604", "meteor"],
  ["planet", "1fa90", "saturn"], ["globe", "1f30d", "earth", "world"],
  // landscape
  ["mountain", "26f0", "hill", "hills", "mountains"], ["mountain-snow", "1f3d4", "snowymountain", "alps"],
  ["volcano", "1f30b"], ["island", "1f3dd", "desertisland"], ["beach-umbrella", "26f1", "parasol", "sunshade"],
  ["tree-deciduous", "1f333", "tree", "oak", "bush"], ["tree-pine", "1f332", "pine", "fir", "evergreen", "conifer"],
  ["tree-palm", "1f334", "palm", "palmtree", "coconut"], ["christmas-tree", "1f384", "xmastree"],
  ["cactus", "1f335"], ["sprout", "1f331", "plant", "seedling", "grass"],
  ["flower", "1f33c", "flowers", "daisy", "blossom"], ["tulip", "1f337"], ["rose", "1f339"],
  ["sunflower", "1f33b"], ["leaf", "1f343", "leaves"], ["maple-leaf", "1f341", "autumn"],
  ["mushroom", "1f344", "toadstool"], ["wheat", "1f33e", "crops", "corn", "grain"], ["rock", "1faa8", "stone", "boulder"],
  ["flame", "1f525", "fire", "campfire", "bonfire", "flames"], ["droplet", "1f4a7", "drop", "water-drop"],
  ["wave", "1f30a", "waves"],
  // buildings and places
  ["house", "1f3e0", "home", "cabin", "cottage", "barn", "farmhouse"], ["house-garden", "1f3e1", "housewithgarden"],
  ["hut", "1f6d6", "shack"], ["building", "1f3e2", "office", "skyscraper", "tower", "apartment", "flats"],
  ["store", "1f3ea", "shop", "shops", "supermarket", "convenience"], ["school", "1f3eb"],
  ["hospital", "1f3e5"], ["church", "26ea", "chapel"], ["castle", "1f3f0", "palace"],
  ["factory", "1f3ed"], ["tent", "26fa", "camping"], ["circus", "1f3aa", "circustent"],
  ["stadium", "1f3df"], ["fountain", "26f2"], ["ferris-wheel", "1f3a1", "funfair", "fair"],
  ["roller-coaster", "1f3a2", "rollercoaster"], ["carousel", "1f3a0", "merrygoround"],
  ["statue", "1f5fd", "statueofliberty"], ["crane", "1f3d7", "construction"],
  ["fuel", "26fd", "petrol", "gas", "gasstation"], ["traffic-light", "1f6a6", "trafficlight"],
  ["traffic-cone", "1f6a7", "roadworks", "barrier"], ["mailbox", "1f4eb", "postbox"],
  ["flag", "1f6a9"], ["map-pin", "1f4cd", "pin"],
  // things that move
  ["car", "1f697", "automobile"], ["taxi", "1f695", "cab"], ["police-car", "1f693", "police"],
  ["fire-engine", "1f692", "firetruck", "fireengine"], ["ambulance", "1f691"],
  ["truck", "1f69a", "lorry", "van", "delivery"], ["bus", "1f68c", "coach"], ["tractor", "1f69c"],
  ["bike", "1f6b2", "bicycle", "cycle"], ["motorbike", "1f3cd", "motorcycle", "scooter"],
  ["train-front", "1f686", "train", "railway"], ["tram", "1f68a"],
  ["plane", "2708", "airplane", "aeroplane", "jet"], ["helicopter", "1f681"], ["rocket", "1f680", "spaceship"],
  ["satellite", "1f6f0"], ["ufo", "1f6f8", "flyingsaucer"],
  ["sailboat", "26f5", "boat", "yacht", "sailingboat"], ["ship", "1f6a2", "liner", "ferry"],
  ["canoe", "1f6f6", "kayak", "rowboat"], ["speedboat", "1f6a4", "motorboat"], ["anchor", "2693"],
  ["balloon", "1f388", "balloons"], ["kite", "1fa81"], ["parachute", "1fa82"],
  // people
  ["user", "1f9cd", "person", "man", "woman", "adult", "someone", "human"],
  ["users", "1f46b", "people", "couple", "friends", "crowd"], ["family", "1f46a"],
  ["baby", "1f476", "child", "kid", "boy", "girl", "children", "kids", "toddler"],
  ["runner", "1f3c3", "running", "jogger"], ["swimmer", "1f3ca", "swimming"], ["surfer", "1f3c4", "surfing"],
  ["cyclist", "1f6b4", "biker"], ["dancer", "1f483", "dancing"], ["cook", "1f9d1-200d-1f373", "chef"],
  ["farmer", "1f9d1-200d-1f33e"], ["artist", "1f9d1-200d-1f3a8", "painter"],
  ["astronaut", "1f9d1-200d-1f680", "spaceman"], ["santa", "1f385", "fatherchristmas"],
  ["snowman", "26c4"], ["ghost", "1f47b"], ["robot", "1f916"], ["alien", "1f47d"],
  ["face-grinning", "1f600", "face", "smile", "happy", "head"],
  // animals
  ["dog", "1f415", "puppy", "hound"], ["cat", "1f408", "kitten", "kitty"], ["cow", "1f404", "cattle", "bull", "calf"],
  ["pig", "1f416", "piglet", "hog"], ["horse", "1f40e", "pony", "stallion"], ["sheep", "1f411", "lamb", "ewe"],
  ["goat", "1f410"], ["chicken", "1f414", "hen", "chick"], ["rooster", "1f413", "cockerel"],
  ["duck", "1f986", "ducks", "duckling"], ["swan", "1f9a2"], ["bird", "1f426", "birds", "sparrow", "robin"],
  ["owl", "1f989"], ["eagle", "1f985", "hawk"], ["parrot", "1f99c"], ["penguin", "1f427"],
  ["rabbit", "1f407", "bunny", "hare"], ["mouse", "1f401", "mice", "rat"], ["squirrel", "1f43f", "chipmunk"],
  ["hedgehog", "1f994"], ["fox", "1f98a"], ["deer", "1f98c", "reindeer", "stag"], ["bear", "1f43b", "teddy"],
  ["elephant", "1f418"], ["giraffe", "1f992"], ["zebra", "1f993"], ["lion", "1f981"], ["tiger", "1f405"],
  ["monkey", "1f412", "ape"], ["camel", "1f42b"], ["kangaroo", "1f998"], ["dinosaur", "1f995", "brontosaurus"],
  ["t-rex", "1f996", "trex", "tyrannosaurus"], ["dragon", "1f409"], ["unicorn", "1f984"],
  ["snake", "1f40d"], ["turtle", "1f422", "tortoise"], ["frog", "1f438", "toad"], ["snail", "1f40c", "slug"],
  ["bug", "1f41e", "ladybird", "ladybug", "beetle", "insect"], ["bee", "1f41d", "bees", "wasp"],
  ["butterfly", "1f98b"], ["fish", "1f41f", "fishes"], ["tropical-fish", "1f420", "clownfish"],
  ["whale", "1f40b"], ["dolphin", "1f42c"], ["shark", "1f988"], ["octopus", "1f419"], ["crab", "1f980"],
  ["shell", "1f41a", "seashell"],
  // food and party
  ["cake", "1f382", "birthdaycake"], ["cake-slice", "1f370", "slice"], ["gift", "1f381", "present", "presents"],
  ["party-popper", "1f389", "party", "confetti"], ["fireworks", "1f386", "firework"], ["sparkler", "1f387"],
  ["pumpkin", "1f383", "halloween"], ["candle", "1f56f"], ["apple", "1f34e", "fruit"], ["banana", "1f34c"],
  ["cherry", "1f352", "cherries"], ["grape", "1f347", "grapes"], ["citrus", "1f34a", "orange", "lemon"],
  ["watermelon", "1f349", "melon"], ["strawberry", "1f353"], ["carrot", "1f955"], ["pizza", "1f355"],
  ["burger", "1f354", "hamburger"], ["ice-cream-cone", "1f366", "icecream"], ["coffee", "2615", "tea", "cup", "mug"],
  ["cup-soda", "1f964", "drink", "soda"], ["bread", "1f35e", "loaf"], ["cheese", "1f9c0"], ["egg", "1f95a"],
  ["milk", "1f95b"], ["picnic", "1f9fa", "basket", "picnicbasket"],
  // things
  ["umbrella", "2602"], ["heart", "2764", "love"], ["crown", "1f451"], ["trophy", "1f3c6", "cup-trophy"],
  ["volleyball", "26bd", "ball", "football", "soccer"], ["basketball", "1f3c0"], ["guitar", "1f3b8"],
  ["drum", "1f941"], ["music", "1f3b5", "note", "song"], ["book", "1f4d5"], ["books", "1f4da", "library"],
  ["laptop", "1f4bb", "computer"], ["smartphone", "1f4f1", "phone", "mobile"], ["camera", "1f4f7"],
  ["tv", "1f4fa", "television", "telly"], ["clock", "23f0", "alarm"], ["lightbulb", "1f4a1", "bulb", "idea", "light"],
  ["lamp-floor", "1fa94", "lamp", "lantern"], ["bed", "1f6cf"], ["sofa", "1f6cb", "couch"], ["armchair", "1fa91", "chair", "seat", "bench"],
  ["door-open", "1f6aa", "door"], ["app-window", "1fa9f", "window"], ["key", "1f511"], ["lock", "1f512", "padlock"],
  ["backpack", "1f392", "bag", "rucksack", "schoolbag"], ["glasses", "1f453", "spectacles"], ["shirt", "1f455", "tshirt", "clothes"],
  ["hat", "1f3a9", "tophat"], ["scissors", "2702"], ["hammer", "1f528"], ["wrench", "1f527", "spanner"],
  ["pencil", "270f", "pen"], ["palette", "1f3a8", "paint", "painting"], ["magnet", "1f9f2"], ["gem", "1f48e", "diamond", "jewel"],
  ["money", "1f4b0", "moneybag", "treasure"], ["dice-5", "1f3b2", "dice", "die"], ["gamepad-2", "1f3ae", "game", "controller"],
  ["puzzle", "1f9e9", "jigsaw"], ["teddy-bear", "1f9f8", "teddybear", "toy"], ["telescope", "1f52d"],
];

const shapes = [];
function toPath(el) {
  const num = n => Number((el.match(new RegExp(`\\b${n}="([-\\d.]+)"`)) || [])[1] || 0);
  const tag = el.match(/^<(\w+)/)[1];
  if (tag === "path") return (el.match(/\bd="([^"]+)"/) || [])[1];
  if (tag === "circle") { const [cx, cy, r] = ["cx", "cy", "r"].map(num); return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`; }
  if (tag === "ellipse") { const [cx, cy, rx, ry] = ["cx", "cy", "rx", "ry"].map(num); return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`; }
  if (tag === "rect") { const [x, y, w, h] = ["x", "y", "width", "height"].map(num); return `M${x} ${y}h${w}v${h}h${-w}z`; }
  if (tag === "polygon" || tag === "polyline") return "M" + (el.match(/\bpoints="([^"]+)"/) || [])[1] + (tag === "polygon" ? "z" : "");
  return null;
}

const art = {}, names = {};
let bytes = 0, missing = [];
for (const [name, file, ...aliases] of ART) {
  const res = await fetch(`${CDN}/${file}.svg`);
  if (!res.ok) { missing.push(`${name} (${file})`); continue; }
  const svg = await res.text();
  if (/<use|Gradient|<mask|<clipPath/.test(svg)) console.warn(`  note: ${name} uses features the renderer draws flat`);
  const list = [];
  for (const el of svg.match(/<(path|circle|ellipse|rect|polygon|polyline)\b[^>]*>/g) || []) {
    const fill = (el.match(/\bfill="([^"]+)"/) || [])[1] || "#000";
    if (fill === "none") continue;
    const d = toPath(el);
    if (!d) continue;
    let small = false;
    try {
      const [x0, y0, x1, y1] = svgPathBbox(d);
      // Small details are drawn crisp: wobbling a 2-unit eye at scene scale
      // smudged every face in the prototype.
      small = Math.max(x1 - x0, y1 - y0) < 7;
    } catch {}
    // A few pictures rotate single shapes (the carousel's poles, the UFO's
    // beams); the rotation rides along as a fourth element.
    const transform = (el.match(/\btransform="([^"]+)"/) || [])[1];
    list.push(transform ? [d, fill, small ? 1 : 0, transform] : small ? [d, fill, 1] : [d, fill]);
  }
  art[name] = list;
  bytes += JSON.stringify(list).length;
  names[name.replace(/[^a-z0-9]/g, "")] = name;
  for (const a of aliases) names[a.replace(/[^a-z0-9]/g, "")] = name;
}

const header = `// GENERATED by scripts/build-art.mjs from Twemoji ${VERSION} — do not edit by hand.
// Twemoji graphics (c) Twitter, Inc and other contributors, CC-BY 4.0:
// https://github.com/jdecked/twemoji  https://creativecommons.org/licenses/by/4.0/
`;
await writeFile(new URL("../web/art.mjs", import.meta.url), header +
  `// Each shape is [path, fill], [path, fill, 1] for a small detail drawn crisp,\n` +
  `// or [path, fill, 0|1, transform] when the source rotates that one shape.\n` +
  `export const ART_BOX = 36;\nexport const ART = ${JSON.stringify(art)};\n`);
await writeFile(new URL("../web/art-names.mjs", import.meta.url), header +
  `// Word -> art name. Small and loaded up front, so parsing can resolve a noun\n` +
  `// before the art itself (web/art.mjs, loaded lazily) has arrived.\n` +
  `export const ART_NAMES = ${JSON.stringify(names)};\n`);
console.log(`web/art.mjs: ${Object.keys(art).length} pictures, ${(bytes / 1024).toFixed(0)} KB of shape data; ` +
  `web/art-names.mjs: ${Object.keys(names).length} words`);
if (missing.length) console.log(`missing from Twemoji ${VERSION}: ${missing.join(", ")}`);
