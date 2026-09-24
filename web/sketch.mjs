// A small drawing tool API. Model output never becomes SVG markup or code.
//
// The format is chosen by token cost, measured against Qwen3's own tokenizer
// (scripts/token-budget.mjs). Qwen splits every digit into its own token and
// the space before it into another, so " 160" costs four tokens: coordinates
// are what a drawing costs, not syntax. Three consequences shape everything
// below.
//
//   1. The grid is 0-100, not 0-400. Two-digit coordinates cost a fifth less
//      than three-digit ones, and a 0-100 grid is a scale models have seen.
//   2. Commands are lines of text inside a JSON envelope, not JSON objects.
//      {"tool":"circle","args":[200,180,70],"text":""} costs 23.5 tokens;
//      "circle 53 45 17" costs 13. The envelope stays JSON so the page keeps
//      WebLLM's proven json_object grammar constraint.
//   3. A stamp — a noun plus three numbers — draws a whole object. Nine
//      primitive commands for a house and a tree cost 128 tokens; two stamps
//      covering the same scene cost 26, and look better. Naming a noun is the
//      easiest thing a small model does; drawing a recognisable tree from
//      line segments is among the hardest.
import { STAMPS, ALIASES, STAMP_BOX } from "./stamps.mjs?v=8";   // ?v= : see browser.html
import { ART_NAMES } from "./art-names.mjs?v=8";

export const GRID = 100;    // the coordinate space the model is given
export const CANVAS = 400;  // SVG user units
const SCALE = CANVAS / GRID;
const STROKE = 2.5;

// ---- Prompt ---------------------------------------------------------------
// Only a dozen stamp names are listed. Listing all 133 would cost ~200 tokens
// of prompt on every turn; the resolver below accepts any noun and falls back
// to a label, so the vocabulary costs nothing to widen.
const EXAMPLE_STAMPS = "house tree sun cloud car person cat dog flower star mountain boat";

// A worked example, not just a grammar. Qwen3-0.6B given the rules alone
// returned a single circle for "a house beside a tree" and echoed the request
// back as the title — the waffle-or-echo failure this project has already
// measured twice. The example uses nouns that are deliberately NOT the ones in
// the usual test phrase, so copying it would be visible rather than look like
// success.
// Qwen3-0.6B drew two houses for "a house" and two cats for "a cat". Every
// shape it had been shown — the template on the first line included — held at
// least two commands, so it had never seen that one was allowed. The first
// example is now a single command, and the rule is stated as well as shown:
// a small model needs both, and neither alone was enough.
const EXAMPLES = [
  `Draw a cat -> {"t":"A cat","c":["cat 50 52 34"]}`,
  `Draw a boat and two birds under the sun -> {"t":"A boat and two birds","c":["sun 82 14 16","bird 28 26 10","bird 44 20 10","boat 48 60 30","line 5 78 95 78"]}`,
];

// `brief` drops the second example for a context too small to hold both. That
// costs the varying command count, which is the whole point of having two — so
// it is a last resort, not a tier. No rung on the page's context ladder
// reaches it; the planner keeps it so that fitting the window is a guarantee
// rather than a hope.
export function sketchPrompt(maxCommands = 14, brief = false, colour = false) {
  return `Draw the user's request as JSON: {"t":"short title","c":[one command per thing you draw]}
Each command is one line of text. The grid is 0 to 100, x right, y down.
<object> x y size — draws that object centred on x y. Objects: ${EXAMPLE_STAMPS}.
For anything else: line x1 y1 x2 y2 / box x y w h / circle x y r / curve x1 y1 cx cy x2 y2
label x y words — only for words you want written on the picture, never to name something you could draw.
${colour ? `Add one colour word at the end of a command: house 25 55 40 red. Colours: ${Object.keys(PALETTE).filter(c => c !== "gray").join(" ")}.\n` : ""}Draw each thing once. One cat is one command. Repeat an object only if the request asks for more than one:
${(brief ? EXAMPLES.slice(0, 1) : EXAMPLES).join("\n")}
Use ${maxCommands} commands or fewer. No SVG, no code, no explanation. Draw the whole picture every time, including when changing an earlier one.`;
}

// The schema fixes the shape of the envelope; the line format inside each
// string is checked by parseSketch. Splitting it this way keeps the schema to
// what XGrammar reliably compiles.
export const SKETCH_SCHEMA = JSON.stringify({
  type: "object", additionalProperties: false, required: ["t", "c"],
  properties: {
    t: { type: "string", maxLength: 80 },
    c: { type: "array", minItems: 1, maxItems: 40,
         items: { type: "string", maxLength: 80 } }
  }
});

// ---- Token accounting -----------------------------------------------------
// The browser has no tokenizer it can cheaply reach, so this estimates one.
// Calibrated against Qwen3-0.6B's real tokenizer on prompts and drawings by
// scripts/token-budget.mjs, which asserts it never reads low. Digits and
// punctuation are one token each in this family; words run about four
// characters to the token.
export function estimateTokens(text) {
  if (!text) return 0;
  let tokens = 0;
  for (const run of String(text).match(/[A-Za-z]+|[0-9]|[^A-Za-z0-9]/g) || []) {
    tokens += /^[A-Za-z]+$/.test(run) ? Math.ceil(run.length / 4) : 1;
  }
  return tokens;
}

const MESSAGE_OVERHEAD = 5;    // the chat template's role wrapper, per message
const RESERVE = 48;            // headroom for template drift and a stop token
const COMMAND_TOKENS = 13;     // a measured primitive command; stamps cost less
const MIN_COMMANDS = 6;
export const MAX_COMMANDS = 40;

// The smallest context this prompt can actually serve: the brief prompt, a
// user message, the reserve, and room for a minimum drawing. It is a real
// floor, not a target — a window below it cannot host a sketch turn at all,
// and the honest thing is to state it and check the page never goes there.
// The page's context ladder bottoms out at 1024, well clear.
export const MIN_CONTEXT = 640;

// Below this the prompt cannot afford to teach colour. 2048 is the middle rung
// of the page's context ladder, so phones stay monochrome and desktops do not.
export const COLOUR_CONTEXT = 2048;

const messageTokens = m => estimateTokens(m.content) + MESSAGE_OVERHEAD;

// Builds the request for one sketch turn. The prompt is O(1) in the number of
// turns: only the previous drawing and the instruction that produced it are
// carried, because a revision needs a seed, not a transcript. Without this the
// history grows by a whole drawing per turn and a 1024-token phone runs out on
// the third one — WebLLM then stops generating mid-JSON with finishReason
// "length", or throws ContextWindowSizeExceededError once the prompt alone
// passes the window.
export function planSketchTurn(history, ctx, style = "", { scene = null } = {}) {
  // Clone: the caller owns the stored history, and nothing here should be able
  // to write back into it.
  const tail = history.slice(-1).map(m => ({ ...m }));
  // [previous instruction, previous drawing] is the seed for "make it bigger".
  const seed = history.slice(-3, -1).filter(m => m.content).map(m => ({ ...m }));
  const suffix = style ? "\nStyle preference: " + style : "";

  // Colour costs about 30 prompt tokens, which a 1024-token phone cannot
  // spare and a desktop rung never notices. Measured on CPU: Qwen3-1.7B has
  // the headroom to use extra instructions, Qwen3-0.6B is already copying the
  // examples back verbatim. The parser accepts colour from any model — it is
  // only the teaching that is rationed.
  const colour = ctx >= COLOUR_CONTEXT;
  const fit = (commands, brief) => {
    const system = { role: "system", content:
      (scene ? scene(Math.min(14, commands)) : sketchPrompt(commands, brief, colour)) + suffix };
    const withSeed = [system, ...seed, ...tail];
    const cost = list => list.reduce((n, m) => n + messageTokens(m), 0);
    const messages = cost(withSeed) + RESERVE + MIN_COMMANDS * COMMAND_TOKENS < ctx
      ? withSeed : [system, ...tail];
    return { messages, room: ctx - cost(messages) - RESERVE };
  };

  // maxCommands depends on the room left, and the room depends on the prompt
  // that quotes maxCommands. Two passes settle it; the number changes by at
  // most a character.
  const floor = MIN_COMMANDS * COMMAND_TOKENS;
  let brief = fit(MAX_COMMANDS, false).room < floor;
  let plan = fit(MAX_COMMANDS, brief);
  const commands = Math.max(MIN_COMMANDS,
    Math.min(MAX_COMMANDS, Math.floor((plan.room - 12) / COMMAND_TOKENS)));
  plan = fit(commands, brief);

  return {
    messages: plan.messages,
    maxCommands: commands,
    colour,
    // Cap output at the room left, never past it: generation that runs into
    // the context edge is truncated silently.
    // A scene plan is a dozen short entries. Capping it is the cheap half of
    // the defence against a loop; the de-duplication is the other half.
    maxTokens: Math.max(64, Math.min(scene ? 320 : 1200, plan.room)),
    seeded: plan.messages.length > 2,
    scene: !!scene
  };
}

// ---- Parsing --------------------------------------------------------------
// Qwen templates can prefill <think>, leaving only </think> in the stream,
// even with thinking disabled. Strip wrappers only BEFORE the JSON; tags in
// labels are ordinary text and must survive unchanged.
function drawingJSON(raw) {
  let text = raw.trim();
  if (!text.startsWith("{") && !text.startsWith("```")) {
    const end = text.indexOf("</think>");
    if (end !== -1) text = text.slice(end + 8).trim();
    else if (text.startsWith("<think>")) throw new Error("The model stopped before completing its drawing.");
  }
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenced) text = fenced[1].trim();
  return text;
}

// Running out of output tokens is the commonest failure on a phone, and it
// leaves valid commands stranded inside unterminated JSON. Recover the
// complete strings rather than throwing the drawing away — half a sketch is
// visibly half a sketch, where an error message says only "try again".
function salvage(text) {
  const title = text.match(/"t"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const body = text.slice(text.indexOf('"c"'));
  const commands = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]).slice(1);
  if (!commands.length) return null;
  return { t: title ? title[1] : "", c: commands, truncated: true };
}

/** The model's JSON envelope as { t, c, truncated }, salvaged if it was cut off. */
export function readDrawing(raw) {
  if (typeof raw !== "string" || raw.length > 24000) throw new Error("Drawing is too large.");
  const text = drawingJSON(raw);
  let data;
  try { data = JSON.parse(text); }
  catch { data = salvage(text); }
  if (!data || typeof data.t !== "string" || !Array.isArray(data.c) || !data.c.length) {
    throw new Error("The model did not return a complete drawing. Please try again.");
  }
  return data;
}

const ALIAS_TOOL = { rect: "box", rectangle: "box", square: "box", path: "curve",
  text: "label", write: "label", dot: "circle", ellipse: "circle" };
const ARITY = { line: 4, box: 4, circle: 3 };

// Colour is one word at the end of a command, because a word is one token and
// "#c0392b" is seven. The page owns the actual values, so the model never has
// to know a hex code and cannot invent an unreadable one. Only offered to
// models with the context to spare — see COLOUR_CONTEXT.
export const PALETTE = {
  red: "#c0392b", orange: "#d35400", yellow: "#c9a227", green: "#2e7d4f",
  blue: "#2c5aa0", purple: "#6b4c9a", pink: "#c2557a", brown: "#7a5230",
  grey: "#6b6b6b", gray: "#6b6b6b", black: "#202020",
};
const INK = "#202020";

// Stamp names are matched loosely: a model asked for a tree may say "tree",
// "trees", "Tree" or "pine". Anything unresolved becomes a label, which is
// mediocre and visible rather than silently missing.
const NORMAL = new Map();
for (const name of Object.keys(STAMPS)) NORMAL.set(name.replace(/[^a-z0-9]/g, ""), name);
for (const [from, to] of Object.entries(ALIASES)) NORMAL.set(from.replace(/[^a-z0-9]/g, ""), to);
// Twemoji illustrations (web/art.mjs) win over the line icons wherever both
// exist, and add the nouns the icons never had: cow, pig, horse, barn, beach
// umbrella. Names shared with the icon set are the same names, so a drawing's
// commands read the same either way.
for (const [from, to] of Object.entries(ART_NAMES)) NORMAL.set(from, to);

export function resolveStamp(word) {
  const key = String(word).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  for (const form of [key, key.replace(/(ies)$/, "y"), key.replace(/e?s$/, "")]) {
    if (NORMAL.has(form)) return NORMAL.get(form);
  }
  // Loose on purpose ("puppies", "sailboats"), but not TOO loose: with the
  // illustrations' 485 words, "line" matched "liner" and drew a ship, and
  // "sky" matched "skyscraper". A word may extend a known one; a known word
  // may extend the word only when the word is long enough to mean something.
  // And a word may extend a known one only by a suffix or by another known
  // word ("pinetree"): "fairy" is not "fair" + y — a fairy hero was about to
  // be drawn as a ferris wheel on every page — nor "carpet" a car.
  for (const [norm, name] of NORMAL) {
    const tail = key.slice(norm.length);
    if (norm.length > 3 && key.startsWith(norm) &&
        (/^(s|es|ing|ed|er|ers)$/.test(tail) || NORMAL.has(tail))) return name;
    if (key.length >= 5 && norm.startsWith(key)) return name;
  }
  return null;
}

const clamp = n => Math.max(0, Math.min(GRID, n));

// Backdrops are the setting a scene sits in: a night sky, the ground, a sea, a
// road. Scene mode's composer writes them (web/scene.mjs); the model can too.
// They are drawn first, as hatched washes, so everything else sits on them.
// "water" and "road" are also stamps — one number means a backdrop, three
// mean a stamp.
const BACKDROP = new Set(["ground", "sand", "water", "sea", "road"]);

function parseCommand(line) {
  const parts = line.trim().split(/[\s,]+/);
  if (parts.length < 2) return null;
  const head = parts[0].toLowerCase().replace(/[^a-z0-9-]/g, "");
  const tool = ALIAS_TOOL[head] || head;

  if (tool === "sky" && /^(day|night|dusk|rain)$/i.test(parts[1]))
    return { tool: "backdrop", kind: "sky", args: [], text: parts[1].toLowerCase() };
  if (BACKDROP.has(tool) && parts.length === 2 && Number.isFinite(Number(parts[1])))
    return { tool: "backdrop", kind: tool === "sea" ? "water" : tool, args: [clamp(Number(parts[1]))], text: "" };

  if (tool === "label") {
    // No colour here: every trailing word belongs to the text, and a label
    // reading "the red door" must not lose its last word to the palette.
    const [x, y] = [parts[1], parts[2]].map(Number);
    const text = parts.slice(3).join(" ").slice(0, 60);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !text) return null;
    return { tool: "label", args: [clamp(x), clamp(y)], text };
  }

  const last = parts[parts.length - 1].toLowerCase();
  const colour = parts.length > 2 && Object.hasOwn(PALETTE, last) ? (parts.pop(), last) : null;

  const args = parts.slice(1).map(Number);
  if (!args.length || !args.every(Number.isFinite)) return null;

  if (tool === "curve") {
    if (args.length < 6 || (args.length - 2) % 4) return null;
    return { tool, args: args.map(clamp), text: "", colour };
  }
  if (ARITY[tool]) {
    if (args.length !== ARITY[tool]) return null;
    const a = args.map(clamp);
    if (tool === "circle" && a[2] <= 0) return null;
    if (tool === "box" && (a[2] <= 0 || a[3] <= 0)) return null;
    // Keep shapes on the canvas by shrinking them, not by rejecting the
    // drawing: one stray radius should not cost the user the whole sketch.
    if (tool === "circle") a[2] = Math.min(a[2], a[0], a[1], GRID - a[0], GRID - a[1]);
    if (tool === "box") { a[2] = Math.min(a[2], GRID - a[0]); a[3] = Math.min(a[3], GRID - a[1]); }
    if (a[2] <= 0 || (tool === "box" && a[3] <= 0)) return null;
    return { tool, args: a, text: "", colour };
  }

  const stamp = resolveStamp(head);
  if (args.length < 2 || args.length > 3) return null;
  const size = Math.min(args[2] > 0 ? args[2] : 12, GRID);
  const a = [clamp(args[0]), clamp(args[1]), size];
  // An unknown noun still knows where it belongs, so say the word there.
  // `said` keeps the model's own word: "Show commands" is the only window
  // onto a device nobody here can reach, and "tree" is what it typed even
  // though the page drew tree-deciduous.
  return stamp ? { tool: "stamp", args: a, text: stamp, colour, said: head }
               : { tool: "label", args: [a[0], a[1]], text: head.replace(/-/g, " ") };
}

// Small models name objects well and place them badly. Qwen3-0.6B returned
// "house 50 50 30 / tree 50 52 30 / car 50 54 30" — three correct nouns
// stacked into one unreadable blob, having anchored on an example's
// coordinates and added 2 each time. Prompting did not reach it; three
// rounds of that were spent on the duplication bug alone, and arithmetic is
// the thing a 0.6B is worst at. The page can do arithmetic.
//
// This only separates stamps, and only when they have genuinely collapsed —
// a sun tucked behind a cloud is a composition, not a mistake. Primitives are
// never touched: a line is explicit geometry the model may mean exactly.
const COLLAPSED = 0.5;  // centres closer than half the touching distance
const SETTLE = 0.9;     // spread to just under touching, so a scene still groups

function spreadStamps(commands) {
  const stamps = commands.filter(c => c.tool === "stamp");
  if (stamps.length < 2) return 0;
  const touching = (a, b) => (a.args[2] + b.args[2]) / 2;
  const apart = (a, b) => Math.hypot(a.args[0] - b.args[0], a.args[1] - b.args[1]);
  const collapsed = stamps.some((a, i) =>
    stamps.slice(i + 1).some(b => apart(a, b) < COLLAPSED * touching(a, b)));
  if (!collapsed) return 0;

  const before = stamps.map(c => c.args.slice(0, 2));
  for (let pass = 0; pass < 24; pass++) {
    let shifted = false;
    for (let i = 0; i < stamps.length; i++) {
      for (let j = i + 1; j < stamps.length; j++) {
        const a = stamps[i].args, b = stamps[j].args;
        const want = SETTLE * (a[2] + b[2]) / 2;
        let dx = b[0] - a[0], dy = b[1] - a[1];
        let d = Math.hypot(dx, dy);
        if (d >= want) continue;
        if (d < 1e-6) {
          // Exactly coincident has no direction to push along. The golden
          // angle gives a different one per pair and never repeats, so a
          // pile of stamps opens into a fan rather than a line.
          const angle = (i * stamps.length + j) * 2.399963;
          dx = Math.cos(angle); dy = Math.sin(angle); d = 1;
        }
        const push = (want - d) / 2 / d;
        a[0] -= dx * push; a[1] -= dy * push;
        b[0] += dx * push; b[1] += dy * push;
        shifted = true;
      }
    }
    for (const c of stamps) {
      const r = Math.min(c.args[2], GRID) / 2;
      c.args[0] = Math.max(r, Math.min(GRID - r, c.args[0]));
      c.args[1] = Math.max(r, Math.min(GRID - r, c.args[1]));
    }
    if (!shifted) break;
  }

  // Pushing pairs apart finds room but scrambles the order: house/tree/car
  // came back as house/car/tree. The order the model listed them in, and the
  // order of the coordinates it did give, are the only intent it expressed —
  // so the positions are kept and re-dealt to the stamps in that order.
  const shifted = stamps.filter((c, i) => c.args[0] !== before[i][0] || c.args[1] !== before[i][1]);
  if (shifted.length > 1) {
    const spread = a => Math.max(...shifted.map(c => c.args[a])) - Math.min(...shifted.map(c => c.args[a]));
    const axis = spread(1) > spread(0) ? 1 : 0;     // whichever way they opened up
    const places = shifted.map(c => c.args.slice(0, 2)).sort((p, q) => p[axis] - q[axis]);
    const order = shifted
      .map((c, i) => ({ c, was: before[stamps.indexOf(c)][axis], i }))
      .sort((p, q) => p.was - q.was || p.i - q.i);
    order.forEach(({ c }, i) => { c.args[0] = places[i][0]; c.args[1] = places[i][1]; });
  }

  let moved = 0;
  stamps.forEach((c, i) => {
    c.args[0] = Math.round(c.args[0]);
    c.args[1] = Math.round(c.args[1]);
    if (c.args[0] !== before[i][0] || c.args[1] !== before[i][1]) moved++;
  });
  return moved;
}

// `spread` is false when a person edited the commands: spreadStamps exists to
// correct a model that cannot place things, and a human who types two
// coordinates means those two coordinates. The page corrects the model, never
// the person.
export function parseSketch(raw, { spread = true, scenery = false } = {}) {
  if (typeof raw !== "string" || raw.length > 24000) throw new Error("Drawing is too large.");
  const text = drawingJSON(raw);
  let data;
  try { data = JSON.parse(text); }
  catch { data = salvage(text); }
  if (!data || typeof data.t !== "string" || !Array.isArray(data.c) || !data.c.length) {
    throw new Error("The model did not return a complete drawing. Please try again.");
  }

  const lines = data.c.slice(0, MAX_COMMANDS).filter(c => typeof c === "string");
  const commands = [];
  let dropped = 0, repeated = 0;
  const seen = new Set();
  for (const line of lines) {
    if (line.length > 120) { dropped++; continue; }
    // The same command twice draws the same mark twice. Measured on
    // Qwen3-1.7B: "a cabin in the woods" repeated one rectangle ten times and
    // "a beach" drew the example's ground line 31 times. A loop is not a
    // drawing, and nobody means an exact duplicate.
    const key = line.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) { repeated++; continue; }
    seen.add(key);
    const command = parseCommand(line);
    if (command) commands.push(command); else dropped++;
  }
  // A couple of bad lines is a model being sloppy; mostly-bad output is a
  // model that did not understand the format, and saying so beats rendering
  // a confident fragment of nonsense.
  // `scenery` lets a picture be only its backdrop — a book page whose only
  // subject has no illustration still gets its sky and ground, where a sketch
  // request that produced nothing but a backdrop is a model that failed.
  if (!commands.some(c => scenery || c.tool !== "backdrop") || dropped > commands.length) {
    throw new Error("The model did not return a drawing in the expected format.");
  }
  // Keep what the model said before the page tidies it. "Show commands" is
  // the only window onto a device nobody here can reach, and it would be
  // worth much less showing coordinates the page had written itself.
  const source = commandLines({ commands }, { said: true });
  const moved = spread ? spreadStamps(commands) : 0;
  return { title: data.t.slice(0, 80), commands, dropped, repeated, moved, source,
           truncated: !!data.truncated };
}

export function commandLines(drawing, { said = false } = {}) {
  return drawing.commands.map(c => {
    const colour = c.colour ? " " + c.colour : "";
    if (c.tool === "label") return `label ${c.args.join(" ")} ${c.text}`;
    if (c.tool === "backdrop") return c.kind === "sky" ? `sky ${c.text}` : `${c.kind} ${c.args[0]}`;
    if (c.tool === "stamp") return `${said && c.said ? c.said : c.text} ${c.args.join(" ")}${colour}`;
    return `${c.tool} ${c.args.join(" ")}${colour}`;
  });
}

// The canonical form a drawing is stored and re-sent in: no reasoning, no
// fences, no invalid commands, and cheaper than whatever the model emitted.
export function toSource(drawing) {
  return JSON.stringify({ t: drawing.title, c: commandLines(drawing) });
}

// ---- Rendering ------------------------------------------------------------
// Rough.js is loaded only when a sketch mode is first entered, and the page
// renders clean SVG if that fails. It costs no model tokens at all: the
// hand-drawn look is applied to geometry the model already sent.
//
// It is vendored beside this file rather than fetched from a CDN, unlike
// KaTeX, because the page promises to work offline once the weights are
// cached — and a CDN import would cost every offline sketch its line without
// ever saying so.
const ROUGH_URL = "./rough.mjs";
let roughPromise = null;
export function loadRough(url = ROUGH_URL) {
  if (url === null) return Promise.resolve(null);   // explicitly turned off
  if (!roughPromise) roughPromise = import(url).then(m => m.default).catch(() => null);
  return roughPromise;
}
export function resetRough() { roughPromise = null; }

// The illustrations are ~330 KB, so they load only when a drawing needs them,
// and never for Desk or Chat. A failed load leaves the line icons, then words.
const ART_URL = "./art.mjs?v=8";
let artPromise = null;
export function loadArt(url = ART_URL) {
  if (url === null) return Promise.resolve(null);
  if (!artPromise) artPromise = import(url).catch(() => null);
  return artPromise;
}

const svgNode = (doc, name, attrs = {}) => {
  const node = doc.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

// A drawing is rendered from the same seed every time so that a re-render, a
// download and a screenshot all agree.
const seedOf = title => [...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) || 7;

// Hand lettering for words on the picture. No web font: it would have to be
// fetched, and the page works offline. These ship with the systems people
// actually use — Chalkboard and Bradley Hand on Apple, Segoe Print on Windows
// — and "cursive" is the browser's own fallback.
const HAND = '"Chalkboard SE", "Segoe Print", "Bradley Hand", "Comic Sans MS", "Marker Felt", cursive';
const PAPER = "#fffdf7";

function drawStamp(doc, parent, rough, { args: [x, y, size], text, colour }, tilt = 0) {
  const px = size * SCALE, k = px / STAMP_BOX;
  const ink = (colour && PALETTE[colour]) || INK;
  const group = svgNode(doc, "g", {
    stroke: ink,
    // A hand never places two things at exactly the same angle. A degree or
    // three either way, seeded, so every render of a drawing agrees.
    transform: `translate(${(x * SCALE - px / 2).toFixed(1)} ${(y * SCALE - px / 2).toFixed(1)}) ` +
      `scale(${k.toFixed(4)})` + (tilt ? ` rotate(${tilt.toFixed(1)} ${STAMP_BOX / 2} ${STAMP_BOX / 2})` : ""),
    // The transform scales the pen too, so undo it here and the stamp is
    // drawn with the same nib as everything else.
    "stroke-width": (STROKE / k).toFixed(3)
  });
  // Colour is a coloured-pencil wash under the ink line: hatched, light, and
  // drawn first so the outline sits on top. It costs no tokens — the model
  // said one colour word, or none and the scene composer chose one.
  if (colour && rough && rough.fill) {
    const wash = svgNode(doc, "g", { opacity: 0.38 });
    for (const d of STAMPS[text]) {
      wash.append(rough.fill(d, { fill: ink, fillStyle: "hachure", stroke: "none",
        hachureGap: 3.2 / k, fillWeight: 1.3 / k, hachureAngle: -41, roughness: 1.1 / k }));
    }
    group.append(wash);
  }
  for (const d of STAMPS[text]) {
    if (rough) group.append(rough.path(d, { roughness: 0.7 / k, strokeWidth: STROKE / k, seed: rough.seed }));
    else group.append(svgNode(doc, "path", { d }));
  }
  parent.append(group);
}

// A Twemoji illustration in "ink and wash": the picture's own flat colours,
// laid down with a slight hand wobble and a thin ink line. Small details —
// eyes, windows, buttons — stay crisp, because wobbling a 2-unit eye at scene
// scale smudged every face in the prototype. A colour word from the model
// repaints the picture's main colour ("blue car"), nothing else.
function mainFill(shapes) {
  const area = new Map();
  for (const [d, fill, small] of shapes) if (!small) area.set(fill, (area.get(fill) || 0) + d.length);
  return [...area].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function drawArt(doc, parent, rc, art, { args: [x, y, size], text, colour }, tilt, seed) {
  const shapes = art.ART[text];
  const box = art.ART_BOX || 36;
  const px = size * SCALE, k = px / box;
  const group = svgNode(doc, "g", {
    transform: `translate(${(x * SCALE - px / 2).toFixed(1)} ${(y * SCALE - px / 2).toFixed(1)}) ` +
      `scale(${k.toFixed(4)})` + (tilt ? ` rotate(${tilt.toFixed(1)} ${box / 2} ${box / 2})` : ""),
  });
  const repaint = colour && PALETTE[colour] ? mainFill(shapes) : null;
  const ink = Math.max(0.3, 0.8 / k);
  shapes.forEach(([d, fill, small, transform], i) => {
    const paint = repaint && fill === repaint ? PALETTE[colour] : fill;
    const node = rc && !small
      // The wobble is in the picture's own units, so it grows with the picture:
      // a big dragon came out scribbled. Steady it as the picture grows, and
      // drop rough.js's second pass on big pictures, where it reads as mess.
      ? rc.path(d, { seed: seed + i, fill: paint, fillStyle: "solid", roughness: 0.45 * Math.min(1, 2.5 / k),
          bowing: 0.6 * Math.min(1, 2.5 / k), disableMultiStroke: k > 3, stroke: "#3a3a3a", strokeWidth: ink })
      : svgNode(doc, "path", { d, fill: paint, stroke: "none" });
    if (transform) node.setAttribute("transform", transform);
    group.append(node);
  });
  parent.append(group);
}

// The setting, drawn before anything else: a night sky, the ground, a sea, a
// road. Hatched in light colour like a coloured pencil laid on its side, so it
// reads as backdrop and never competes with the ink.
function drawBackdrops(doc, parent, rc, backdrops, seed) {
  const s = n => n * SCALE;
  const ground = backdrops.find(b => b.kind === "ground" || b.kind === "sand");
  const water = backdrops.find(b => b.kind === "water");
  const land = s(ground ? ground.args[0] : 62);
  // The sky ends where the first thing below it starts: water if there is
  // any above the land, otherwise the land itself.
  const skyline = water && s(water.args[0]) < land ? s(water.args[0]) : land;
  // Seeded, so tufts and wave offsets land in the same place on every render.
  let h = seed || 7;
  const rand = () => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000;

  // Backdrops are flat washes, like watercolour under an ink drawing. They
  // were pencil hatching first, and beside painted illustrations a hatched
  // night sky read as rain. Hatching is kept for the one sky that IS rain.
  const wash = (x, y, w, hgt, colour, opacity, hatch = null) => {
    if (hgt <= 0) return;
    const g = svgNode(doc, "g", { opacity });
    g.append(rc
      ? rc.rectangle(x, y, w, hgt, hatch
          ? { seed, fill: colour, fillStyle: "hachure", stroke: "none", hachureGap: hatch.gap,
              fillWeight: 1.1, hachureAngle: hatch.angle, roughness: 1.6 }
          : { seed, fill: colour, fillStyle: "solid", stroke: "none", roughness: 1.2 })
      : svgNode(doc, "rect", { x, y, width: w, height: hgt, fill: colour, stroke: "none" }));
    parent.append(g);
  };
  const line = (d, colour, width = STROKE, opacity = 1) => {
    const node = rc
      ? rc.path(d, { seed, stroke: colour, strokeWidth: width, roughness: 1.2, bowing: 2 })
      : svgNode(doc, "path", { d, stroke: colour, "stroke-width": width, fill: "none" });
    if (opacity < 1) node.setAttribute("opacity", opacity);
    parent.append(node);
  };
  const skyline_d = y => `M 0 ${y + 2} Q ${CANVAS / 3} ${y - 6} ${CANVAS / 2} ${y} T ${CANVAS} ${y - 1}`;

  for (const b of backdrops.filter(b => b.kind === "sky")) {
    if (b.text === "night") wash(0, 0, CANVAS, skyline, "#26345f", 0.78);
    else if (b.text === "dusk") wash(0, 0, CANVAS, skyline, "#e6a26a", 0.35);
    else if (b.text === "rain") {
      wash(0, 0, CANVAS, skyline, "#8f97a3", 0.3);
      wash(0, 0, CANVAS, skyline, "#5f6b7a", rc ? 0.45 : 0, { gap: 11, angle: -70 });
    } else wash(0, 0, CANVAS, skyline, "#bfe0f5", 0.45);
  }
  if (water) {
    const top = s(water.args[0]);
    const bottom = ground && land > top ? land : CANVAS;
    wash(0, top, CANVAS, bottom - top, "#5ba3d9", 0.55);
    line(skyline_d(top), PALETTE.blue, 1.8);
    const rows = Math.max(1, Math.round((bottom - top) / 34));
    for (let i = 0; i < rows; i++) {
      const y = top + (i + 0.6) * ((bottom - top) / (rows + 0.2));
      const x0 = 6 + rand() * 30;
      line(`M ${x0} ${y} q 12 -6 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0 t 24 0`,
        PALETTE.blue, 1.4, 0.8);
    }
  }
  if (ground) {
    const sand = ground.kind === "sand";
    wash(0, land, CANVAS, CANVAS - land, sand ? "#ecd49a" : "#9fcf7f", sand ? 0.75 : 0.55);
    line(skyline_d(land), INK, 1.8);
    // Grass is tufts, not a hatched field: a field of long parallel strokes
    // read as rain in the first screenshots.
    if (!sand) {
      const roads = backdrops.filter(b => b.kind === "road").map(b => s(b.args[0]));
      for (let i = 0; i < 16; i++) {
        const x = 8 + rand() * (CANVAS - 16), y = land + 14 + rand() * (CANVAS - land - 22);
        if (roads.some(r => Math.abs(y - 3 - r) < 30)) continue;   // no grass on the road
        line(`M ${x - 5} ${y} L ${x - 2} ${y - 7} M ${x} ${y} L ${x + 1} ${y - 9} M ${x + 4} ${y} L ${x + 6} ${y - 6}`,
          PALETTE.green, 1.4, 0.75);
      }
    } else {
      for (let i = 0; i < 22; i++) {
        const x = 8 + rand() * (CANVAS - 16), y = land + 8 + rand() * (CANVAS - land - 12);
        line(`M ${x} ${y} l 1.5 0.5`, "#9a7b3c", 1.6, 0.7);
      }
    }
  }
  for (const b of backdrops.filter(b => b.kind === "road")) {
    const y = s(b.args[0]);
    wash(0, y - 22, CANVAS, 44, "#8c8c8c", 0.55);
    line(`M 0 ${y - 22} L ${CANVAS} ${y - 22}`, INK, 1.8);
    line(`M 0 ${y + 22} L ${CANVAS} ${y + 22}`, INK, 1.8);
    for (let x = 12; x < CANVAS; x += 52) line(`M ${x} ${y} L ${x + 26} ${y}`, "#f4f1e8", 3);
  }
}

export function renderSketch(container, raw, { rough = null, art = null, onEdit = null, spread = true, scenery = false } = {}) {
  const drawing = parseSketch(raw, { spread, scenery }); // Validate the whole drawing before touching the DOM.
  const doc = container.ownerDocument;
  const svg = svgNode(doc, "svg", { xmlns: "http://www.w3.org/2000/svg",
    viewBox: `0 0 ${CANVAS} ${CANVAS}`, width: CANVAS, height: CANVAS, role: "img",
    "aria-label": drawing.title || "Generated sketch" });
  const title = svgNode(doc, "title"); title.textContent = drawing.title; svg.append(title);
  svg.append(svgNode(doc, "rect", { width: CANVAS, height: CANVAS, fill: PAPER }));
  const group = svgNode(doc, "g", { fill: "none", stroke: INK, "stroke-width": STROKE,
    "stroke-linecap": "round", "stroke-linejoin": "round" });
  svg.append(group);

  const rc = rough ? rough.svg(svg) : null;
  const seed = seedOf(drawing.title);
  const ink = c => (c.colour && PALETTE[c.colour]) || INK;
  const s = n => n * SCALE;

  const backdrops = drawing.commands.filter(c => c.tool === "backdrop");
  if (backdrops.length) drawBackdrops(doc, group, rc, backdrops, seed);

  let index = 0, usedArt = false;
  for (const command of drawing.commands) {
    const { tool, args: a, text } = command;
    if (tool === "backdrop") continue;
    const pen = { seed, roughness: 0.9, bowing: 1, strokeWidth: STROKE, stroke: ink(command) };
    let node;
    if (tool === "stamp") {
      // Tilt from the drawing's seed and the stamp's place in it: stable.
      const tilt = rc ? (((seed >>> (index++ % 24)) % 7) - 3) : 0;
      if (art && art.ART && art.ART[text]) { usedArt = true; drawArt(doc, group, rc, art, command, tilt, seed); continue; }
      if (!STAMPS[text]) {
        // A noun only the illustrations know, with the illustrations not
        // loaded: say the word where the picture would have gone.
        node = svgNode(doc, "text", { x: s(a[0]) - 12, y: s(a[1]), fill: INK, stroke: "none",
          "font-size": 17, "font-family": HAND });
        node.textContent = command.said || text;
        group.append(node);
        continue;
      }
      drawStamp(doc, group, rc && {
        path: (d, o) => rc.path(d, { ...pen, ...o }),
        fill: (d, o) => rc.path(d, { seed, ...o }),
        seed }, command, tilt);
      continue;
    }
    if (tool === "label") {
      node = svgNode(doc, "text", { x: s(a[0]), y: s(a[1]), fill: INK, stroke: "none",
        "font-size": 17, "font-family": HAND });
      node.textContent = text;
    } else if (rc) {
      if (tool === "line") node = rc.line(s(a[0]), s(a[1]), s(a[2]), s(a[3]), pen);
      if (tool === "box") node = rc.rectangle(s(a[0]), s(a[1]), s(a[2]), s(a[3]), pen);
      if (tool === "circle") node = rc.circle(s(a[0]), s(a[1]), s(a[2]) * 2, pen);
      if (tool === "curve") node = rc.path(`M ${s(a[0])} ${s(a[1])} Q ${a.slice(2).map(s).join(" ")}`, pen);
    } else {
      if (tool === "line") node = svgNode(doc, "line", { x1: s(a[0]), y1: s(a[1]), x2: s(a[2]), y2: s(a[3]) });
      if (tool === "box") node = svgNode(doc, "rect", { x: s(a[0]), y: s(a[1]), width: s(a[2]), height: s(a[3]) });
      if (tool === "circle") node = svgNode(doc, "circle", { cx: s(a[0]), cy: s(a[1]), r: s(a[2]) });
      if (tool === "curve") node = svgNode(doc, "path", { d: `M ${s(a[0])} ${s(a[1])} Q ${a.slice(2).map(s).join(" ")}` });
    }
    if (node) {
      if (command.colour && tool !== "label") node.setAttribute("stroke", ink(command));
      group.append(node);
    }
  }

  // The illustrations are CC-BY: the credit travels inside the SVG, so a
  // downloaded drawing carries it wherever it goes.
  if (usedArt) {
    const desc = svgNode(doc, "desc");
    desc.textContent = "Illustrations from Twemoji (c) Twitter, Inc and other contributors, CC-BY 4.0 — https://github.com/jdecked/twemoji";
    svg.insertBefore(desc, svg.children[1] || null);
  }

  const caption = doc.createElement("p");
  caption.textContent = drawing.title;
  if (drawing.truncated) caption.textContent += " — the model ran out of room, so this drawing is unfinished.";
  else if (drawing.dropped) caption.textContent += ` — ${drawing.dropped} command${drawing.dropped > 1 ? "s" : ""} could not be read.`;
  if (drawing.repeated) caption.textContent += ` The model repeated itself; ${drawing.repeated} duplicate command${drawing.repeated > 1 ? "s were" : " was"} skipped.`;

  // What the model actually said, and a place to change it. Without this every
  // test on a device nobody here can reach is a guess: a drawing that comes
  // back nearly empty looks identical to one that was misparsed. Making it
  // editable costs nothing extra and turns the panel from a disclosure into
  // the most useful part of the page — change a number, press Redraw.
  const source = doc.createElement("details");
  source.className = "source";
  const summary = doc.createElement("summary");
  summary.textContent = `Show commands (${drawing.commands.length})` +
    (drawing.moved ? ` · ${drawing.moved} moved apart` : "");

  const lines = drawing.source || commandLines(drawing);
  const editor = doc.createElement("textarea");
  editor.className = "commands";
  editor.rows = Math.min(14, lines.length + 1);
  editor.spellcheck = false;
  editor.value = lines.join("\n");
  editor.setAttribute("aria-label", "Drawing commands — edit and press Redraw");

  const redraw = doc.createElement("button");
  redraw.type = "button";
  redraw.textContent = "Redraw";
  const note = doc.createElement("p");
  note.className = "note";
  note.textContent = drawing.moved
    ? `The model placed ${drawing.moved} of these on top of each other, so the page spread them out. Change a number and press Redraw.`
    : "Change a number and press Redraw.";

  redraw.addEventListener("click", () => {
    const edited = JSON.stringify({ t: drawing.title,
      c: editor.value.split("\n").map(l => l.trim()).filter(Boolean) });
    try {
      // renderSketch parses before it touches the DOM, so a bad edit throws
      // here with the drawing still on screen.
      const kept = renderSketch(container, edited, { rough, art, onEdit, spread: false });
      const panel = container.querySelector("details.source");
      if (panel) {
        panel.open = true;
        const box = panel.querySelector("textarea");
        if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
      }
      if (onEdit) onEdit(kept);
    } catch (err) {
      note.textContent = err.message + " The drawing below is unchanged.";
      note.classList.add("bad");
    }
  });

  source.append(summary, editor, redraw, note);

  const download = doc.createElement("button");
  download.type = "button"; download.textContent = "Download SVG";
  download.addEventListener("click", () => {
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement("a"); link.href = url; link.download = "sketch.svg";
    doc.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  container.replaceChildren(svg, caption, download, source);
  container.classList.add("rich", "sketch");
  return toSource(drawing); // Keep reasoning, fences and bad commands out of future prompts.
}
