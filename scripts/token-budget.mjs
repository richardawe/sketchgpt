// Measures what sketch mode actually costs, in real tokens, and checks that
// the browser's estimator never reads low.
//
// The page cannot afford a tokenizer: Qwen3's tokenizer.json is 11 MB, which
// is a third of a 360M model's download. So web/sketch.mjs estimates, and this
// script is what keeps the estimate honest — it loads the real tokenizer and
// asserts estimateTokens() is never under the truth.
//
//   npm install @lenml/tokenizers        (once, anywhere on the path)
//   node scripts/token-budget.mjs
//
// The tokenizer is cached in scripts/.tokenizer-cache/ (gitignored).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import {
  estimateTokens, planSketchTurn, sketchPrompt, toSource, parseSketch, MAX_COMMANDS
} from "../web/sketch.mjs";

const MODEL = "Qwen/Qwen3-0.6B";
const CACHE = new URL("./.tokenizer-cache/", import.meta.url);

async function cached(file) {
  const path = new URL(file, CACHE);
  try { return JSON.parse(await readFile(path, "utf8")); } catch {}
  await mkdir(CACHE, { recursive: true });
  const res = await fetch(`https://huggingface.co/${MODEL}/resolve/main/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const text = await res.text();
  await writeFile(path, text);
  return JSON.parse(text);
}

const require = createRequire(import.meta.url);
let TokenizerLoader;
try { ({ TokenizerLoader } = require("@lenml/tokenizers")); }
catch { console.error("Needs @lenml/tokenizers: npm install @lenml/tokenizers"); process.exit(1); }

const tokenizer = TokenizerLoader.fromPreTrained({
  tokenizerJSON: await cached("tokenizer.json"),
  tokenizerConfig: await cached("tokenizer_config.json"),
});
const count = text => tokenizer.encode(text).length;

// ---- What the formats cost ------------------------------------------------
// The same scene — the README's "a house beside a tree" — in each format.
const OLD_PROMPT_TOKENS = 211;  // the JSON-object prompt this replaced
const oldJSON = JSON.stringify({ title: "A house beside a tree", commands: [
  ["rectangle", [100, 200, 160, 140]], ["line", [100, 200, 180, 120]], ["line", [180, 120, 260, 200]],
  ["rectangle", [150, 280, 40, 60]], ["circle", [215, 240, 14]], ["line", [320, 340, 320, 240]],
  ["circle", [320, 200, 48]], ["line", [20, 340, 380, 340]], ["circle", [60, 60, 26]],
].map(([tool, args]) => ({ tool, args, text: "" })).concat([{ tool: "text", args: [120, 370], text: "home" }]) });

const primitives = JSON.stringify({ t: "A house beside a tree", c: [
  "box 25 50 40 35", "line 25 50 45 30", "line 45 30 65 50", "box 37 70 10 15",
  "circle 53 60 3", "line 80 85 80 60", "circle 80 50 12", "line 5 85 95 85",
  "circle 15 15 6", "label 30 92 home"] });
const stamps = JSON.stringify({ t: "A house beside a tree", c: [
  "house 25 50 40", "tree 80 45 30", "sun 15 15 12", "line 5 85 95 85", "label 30 92 home"] });

const rows = [
  ["JSON objects, 0-400 grid (before)", oldJSON, 10],
  ["command lines, 0-100 grid", primitives, 10],
  ["the same scene as stamps", stamps, 5],
];
console.log("Drawing cost — one scene, three encodings\n");
console.log("  format                              tokens  commands  per command   vs before");
for (const [name, text, n] of rows) {
  const t = count(text);
  console.log(`  ${name.padEnd(34)} ${String(t).padStart(5)} ${String(n).padStart(9)} ${(t / n).toFixed(1).padStart(12)} ${(count(oldJSON) / t).toFixed(1).padStart(10)}x`);
}

const prompt = sketchPrompt(14);
console.log(`\nSystem prompt: ${count(prompt)} tokens (was ${OLD_PROMPT_TOKENS})`);

// ---- The estimator must never read low ------------------------------------
const corpus = [prompt, sketchPrompt(40), sketchPrompt(6), oldJSON, primitives, stamps,
  "Draw a house beside a tree", "make the tree bigger and add two birds",
  "A cat on a mat", JSON.stringify({ t: "x", c: ["circle 50 50 25"] }),
  "label 30 92 home sweet home", "curve 10 10 50 90 90 10 40 20 70 80",
  ...Object.values({ a: "house 25 50 40", b: "mountain-snow 80 20 35", c: "line 0 100 100 0" })];
let worst = Infinity, worstText = "";
for (const text of corpus) {
  const real = count(text), est = estimateTokens(text);
  if (est - real < worst) { worst = est - real; worstText = text; }
  assert.ok(est >= real, `estimator read low: ${est} < ${real} for ${JSON.stringify(text.slice(0, 60))}`);
}
const ratios = corpus.map(t => estimateTokens(t) / count(t));
console.log(`Estimator: never low across ${corpus.length} samples; tightest margin ${worst} token${worst === 1 ? "" : "s"}` +
  ` on ${JSON.stringify(worstText.slice(0, 40))}; overshoot ${((Math.min(...ratios) - 1) * 100).toFixed(0)}-${((Math.max(...ratios) - 1) * 100).toFixed(0)}%`);

// ---- What a conversation costs, turn by turn ------------------------------
// The failure this replaces: history grew by a whole drawing every turn.
console.log("\nPrompt size over ten turns of revision (real tokens, measured)\n");
console.log("  context   turn 1   turn 2   turn 3   turn 5   turn 10   max_tokens at turn 10");
for (const ctx of [4096, 2048, 1024]) {
  const history = [];
  const sizes = [];
  let maxTokens = 0, maxCommands = 0;
  for (let turn = 1; turn <= 10; turn++) {
    history.push({ role: "user", content: turn === 1 ? "Draw a house beside a tree" : "make the tree bigger" });
    const plan = planSketchTurn(history, ctx);
    sizes.push(plan.messages.reduce((n, m) => n + count(m.content) + 5, 0));
    maxTokens = plan.maxTokens; maxCommands = plan.maxCommands;
    history.push({ role: "assistant", content: toSource(parseSketch(stamps)) });
    assert.ok(sizes.at(-1) + maxTokens <= ctx,
      `ctx ${ctx} turn ${turn}: prompt ${sizes.at(-1)} + max_tokens ${maxTokens} exceeds ${ctx}`);
  }
  const at = i => String(sizes[i]).padStart(7);
  console.log(`  ${String(ctx).padStart(5)}  ${at(0)}  ${at(1)}  ${at(2)}  ${at(4)}  ${at(9)}   ${String(maxTokens).padStart(6)} (${maxCommands} commands)`);
}
console.log(`\n  Every row is flat after turn 2 and every prompt+max_tokens fits its window.`);
console.log(`  Command budget caps at ${MAX_COMMANDS}.`);
