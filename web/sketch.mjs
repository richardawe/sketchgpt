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
import { STAMPS, ALIASES, STAMP_BOX } from "./stamps.mjs";

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
export function planSketchTurn(history, ctx, style = "") {
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
    const system = { role: "system", content: sketchPrompt(commands, brief, colour) + suffix };
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
    maxTokens: Math.max(64, Math.min(1200, plan.room)),
    seeded: plan.messages.length > 2
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

export function resolveStamp(word) {
  const key = String(word).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return null;
  for (const form of [key, key.replace(/(ies)$/, "y"), key.replace(/e?s$/, "")]) {
    if (NORMAL.has(form)) return NORMAL.get(form);
  }
  for (const [norm, name] of NORMAL) {
    if (norm.length > 3 && (norm.startsWith(key) || key.startsWith(norm))) return name;
  }
  return null;
}

const clamp = n => Math.max(0, Math.min(GRID, n));

function parseCommand(line) {
  const parts = line.trim().split(/[\s,]+/);
  if (parts.length < 2) return null;
  const head = parts[0].toLowerCase().replace(/[^a-z0-9-]/g, "");
  const tool = ALIAS_TOOL[head] || head;

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
export function parseSketch(raw, { spread = true } = {}) {
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
  let dropped = 0;
  for (const line of lines) {
    if (line.length > 120) { dropped++; continue; }
    const command = parseCommand(line);
    if (command) commands.push(command); else dropped++;
  }
  // A couple of bad lines is a model being sloppy; mostly-bad output is a
  // model that did not understand the format, and saying so beats rendering
  // a confident fragment of nonsense.
  if (!commands.length || dropped > commands.length) {
    throw new Error("The model did not return a drawing in the expected format.");
  }
  // Keep what the model said before the page tidies it. "Show commands" is
  // the only window onto a device nobody here can reach, and it would be
  // worth much less showing coordinates the page had written itself.
  const source = commandLines({ commands }, { said: true });
  const moved = spread ? spreadStamps(commands) : 0;
  return { title: data.t.slice(0, 80), commands, dropped, moved, source,
           truncated: !!data.truncated };
}

export function commandLines(drawing, { said = false } = {}) {
  return drawing.commands.map(c => {
    const colour = c.colour ? " " + c.colour : "";
    if (c.tool === "label") return `label ${c.args.join(" ")} ${c.text}`;
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

const svgNode = (doc, name, attrs = {}) => {
  const node = doc.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

// A drawing is rendered from the same seed every time so that a re-render, a
// download and a screenshot all agree.
const seedOf = title => [...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) || 7;

function drawStamp(doc, parent, rough, { args: [x, y, size], text, colour }) {
  const px = size * SCALE, k = px / STAMP_BOX;
  const group = svgNode(doc, "g", {
    stroke: (colour && PALETTE[colour]) || INK,
    transform: `translate(${(x * SCALE - px / 2).toFixed(1)} ${(y * SCALE - px / 2).toFixed(1)}) scale(${k.toFixed(4)})`,
    // The transform scales the pen too, so undo it here and the stamp is
    // drawn with the same nib as everything else.
    "stroke-width": (STROKE / k).toFixed(3)
  });
  for (const d of STAMPS[text]) {
    if (rough) group.append(rough.path(d, { roughness: 0.7 / k, strokeWidth: STROKE / k, seed: rough.seed }));
    else group.append(svgNode(doc, "path", { d }));
  }
  parent.append(group);
}

export function renderSketch(container, raw, { rough = null, onEdit = null, spread = true } = {}) {
  const drawing = parseSketch(raw, { spread }); // Validate the whole drawing before touching the DOM.
  const doc = container.ownerDocument;
  const svg = svgNode(doc, "svg", { xmlns: "http://www.w3.org/2000/svg",
    viewBox: `0 0 ${CANVAS} ${CANVAS}`, width: CANVAS, height: CANVAS, role: "img",
    "aria-label": drawing.title || "Generated sketch" });
  const title = svgNode(doc, "title"); title.textContent = drawing.title; svg.append(title);
  svg.append(svgNode(doc, "rect", { width: CANVAS, height: CANVAS, fill: "white" }));
  const group = svgNode(doc, "g", { fill: "none", stroke: INK, "stroke-width": STROKE,
    "stroke-linecap": "round", "stroke-linejoin": "round" });
  svg.append(group);

  const rc = rough ? rough.svg(svg) : null;
  const seed = seedOf(drawing.title);
  const ink = c => (c.colour && PALETTE[c.colour]) || INK;
  const s = n => n * SCALE;

  for (const command of drawing.commands) {
    const { tool, args: a, text } = command;
    const pen = { seed, roughness: 0.9, bowing: 1, strokeWidth: STROKE, stroke: ink(command) };
    let node;
    if (tool === "stamp") {
      drawStamp(doc, group, rc && { path: (d, o) => rc.path(d, { ...pen, ...o }), seed }, command);
      continue;
    }
    if (tool === "label") {
      node = svgNode(doc, "text", { x: s(a[0]), y: s(a[1]), fill: INK, stroke: "none",
        "font-size": 16, "font-family": "sans-serif" });
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

  const caption = doc.createElement("p");
  caption.textContent = drawing.title;
  if (drawing.truncated) caption.textContent += " — the model ran out of room, so this drawing is unfinished.";
  else if (drawing.dropped) caption.textContent += ` — ${drawing.dropped} command${drawing.dropped > 1 ? "s" : ""} could not be read.`;

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
      const kept = renderSketch(container, edited, { rough, onEdit, spread: false });
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
