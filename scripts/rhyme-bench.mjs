// Can a small model write a rhyme about a person? Selfie-rhyme spike.
//
// The page can know a few things about a selfie without a vision model: a
// name the person types, one thing they love, and an expression read from
// MediaPipe's blendshapes (smiling, surprised, winking...). This sends those
// seeds through real models three ways and judges every answer with the CMU
// Pronouncing Dictionary — the same check the page would run:
//
//   free   — "write a four-line rhyming poem" (the obvious design)
//   ends   — the PAGE picks two rhyming pairs from CMUdict and the model only
//            has to write lines that end on them (AABB)
//   ends1  — "ends" plus one worked example, to see what the example leaks
//   line   — one line per call, each told its last word; the page checks the
//            last word and asks again (at most 3 tries a line)
//
//   OLLAMA_MODELS=... ollama serve &
//   CMUDICT=/path/to/cmudict.dict node scripts/rhyme-bench.mjs qwen3:0.6b qwen3:1.7b
//
// cmudict.dict: https://github.com/cmusphinx/cmudict (BSD-style licence).
import { readFileSync } from "node:fs";
import { ART_NAMES } from "../web/art-names.mjs";

const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["qwen3:0.6b"];
const RUNS = Number(process.env.RUNS || 1);

// --- rhyme, from the dictionary, never from the model ----------------------
const PRON = new Map();
for (const line of readFileSync(process.env.CMUDICT || "cmudict.dict", "utf8").split("\n")) {
  const m = line.match(/^([a-z']+)(?:\(\d\))?\s+(.*?)(?:\s+#.*)?$/);
  if (!m) continue;
  if (!PRON.has(m[1])) PRON.set(m[1], []);
  PRON.get(m[1]).push(m[2].split(" "));
}
// The rhyming part: from the last vowel with primary stress to the end
// (secondary stress made "pony" rhyme with "tea" in the first run).
const tail = ph => { let i = -1;
  for (const re of [/1$/, /2$/, /\d$/]) { i = ph.findLastIndex(p => re.test(p)); if (i >= 0) break; }
  return ph.slice(Math.max(i, 0)).join(" ").replace(/\d/g, ""); };
const tails = w => (PRON.get(w) || []).map(tail);
export const rhymes = (a, b) => a !== b && tails(a).some(t => tails(b).includes(t));

// Words the page would offer as line endings: the words it can already draw,
// plus plain everyday words a child's rhyme is made of.
const COMMON = `day play way say stay away today bright light night sight right delight
fun sun run one done begun smile while mile style grin chin win in spin fine shine
mine line time rhyme climb true blue you new too do through glad bad had cheer here
near dear year sing ring thing king bring wing star far are car heart start part art
eyes skies surprise size wise sky high fly why try by hi joy boy toy hat cat that sat
flat chat hug snug grow glow show know slow so go home roam dream beam gleam team
laugh half cool school pool friend end mend bend care there where air hair chair
sweet feet treat meet street wave brave cake make take awake tree free see me be sea
bee three`.split(/\s+/);
const VOCAB = [...new Set([...Object.keys(ART_NAMES).filter(w => /^[a-z]+$/.test(w)), ...COMMON])]
  .filter(w => PRON.has(w));
const partner = (w, avoid = []) => VOCAB.find(v => rhymes(w, v) && !avoid.includes(v) && !v.startsWith(w) && !w.startsWith(v));

// --- the seeds: only what the page can know from a selfie plus two fields ---
const SEEDS = [
  { name: "Maya", mood: "smiling", loves: "cats" },
  { name: "Leo", mood: "grinning", loves: "football" },
  { name: "Grandma Rose", mood: "smiling", loves: "tea" },
  { name: "Sam", mood: "surprised", loves: "dinosaurs" },
  { name: "Priya", mood: "winking", loves: "the sea" },
  { name: "Tom", mood: "serious", loves: "trains" },
  { name: "Ava", mood: "laughing", loves: "painting" },
  { name: "Kofi", mood: "sleepy", loves: "pizza" },
];
const MOOD_WORD = { smiling: "smile", grinning: "grin", laughing: "laugh", surprised: "surprise",
  winking: "wink", serious: "face", sleepy: "dream" };
const singular = s => s.replace(/^the /, "").replace(/s$/, "");

/** Two rhyming pairs the page chooses: one on what they love, one on their look. */
export function endWords(seed) {
  const pairs = [];
  for (const w of [singular(seed.loves), MOOD_WORD[seed.mood], "day"]) {
    if (pairs.length === 2) break;
    const p = PRON.has(w) && partner(w, pairs.flat());
    if (p) pairs.push([w, p]);
  }
  if (pairs.length < 2) pairs.push(["day", "play"]);
  return pairs.slice(0, 2);
}

const about = s => `${s.name}. In the photo they are ${s.mood}. They love ${s.loves}.`;
const EXAMPLE = [
  { role: "user", content: `Write about: Ben. In the photo they are smiling. They love kites.
Line 1 ends with "kite". Line 2 ends with "bright". Line 3 ends with "smile". Line 4 ends with "while".` },
  { role: "assistant", content: `Ben runs out to fly his kite,\nup it goes, so high and bright.\nWatch him with his biggest smile,\nhe will stay out for a while.` },
];
function messages(way, seed, ends) {
  const sys = "You write short, happy rhymes for children's cards. Four lines only. No title. No explanation.";
  if (way === "free") return [{ role: "system", content: sys },
    { role: "user", content: `Write a four-line rhyming poem about ${about(seed)} Lines 1 and 2 rhyme. Lines 3 and 4 rhyme.` }];
  const rule = `Line 1 ends with "${ends[0][0]}". Line 2 ends with "${ends[0][1]}". Line 3 ends with "${ends[1][0]}". Line 4 ends with "${ends[1][1]}".`;
  return [{ role: "system", content: sys }, ...(way === "ends1" ? EXAMPLE : []),
    { role: "user", content: `Write about: ${about(seed)}\n${rule}` }];
}

const lastWord = l => (l.toLowerCase().match(/[a-z']+(?=[^a-z']*$)/) || [""])[0].replace(/'s$/, "");
function judge(text, seed, ends) {
  const lines = text.replace(/<think>[\s\S]*?<\/think>/g, "").split("\n").map(l => l.trim())
    .filter(l => l && !/^(title|here|\*\*)/i.test(l));
  const four = lines.length === 4;
  const w = lines.slice(0, 4).map(lastWord);
  const aabb = four && rhymes(w[0], w[1]) && rhymes(w[2], w[3]);
  const obeyed = ends ? w.filter((x, i) => x === [ends[0][0], ends[0][1], ends[1][0], ends[1][1]][i]).length : null;
  const first = seed.name.split(" ").at(-1).toLowerCase();
  const named = text.toLowerCase().includes(first);
  const loved = text.toLowerCase().includes(singular(seed.loves).slice(0, 5));
  const leak = /\bben\b|\bkite/i.test(text) && !/kite/.test(seed.loves);
  return { four, aabb, obeyed, named, loved, leak, lines };
}

async function ask(model, msgs) {
  const t = Date.now();
  const r = await fetch(`${HOST}/api/chat`, { method: "POST", body: JSON.stringify({
    model, messages: msgs, stream: false, think: false, options: { temperature: 0.7, num_predict: 120 } }) }).then(r => r.json());
  return { text: r.message?.content || "", ms: Date.now() - t };
}

// One line at a time: the page holds the end words and checks every line.
async function byLine(model, seed, ends) {
  const want = [ends[0][0], ends[0][1], ends[1][0], ends[1][1]];
  const lines = []; let ms = 0, calls = 0;
  for (const w of want) {
    let got = null;
    for (let t = 0; t < 3 && !got; t++) {
      const msgs = [{ role: "system", content: "You write one line of a short, happy rhyme for a child's card. Reply with the line only." },
        { role: "user", content: `The rhyme is about ${about(seed)}\n${lines.length ? "So far:\n" + lines.join("\n") + "\n" : ""}` +
          `Write the next line. It must end with the word "${w}".` }];
      const r = await ask(model, msgs); ms += r.ms; calls++;
      const line = r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim().split("\n")[0].replace(/^["']|["']$/g, "");
      if (lastWord(line) === w) got = line;
    }
    lines.push(got || "(no line)");
  }
  return { text: lines.join("\n"), ms, calls };
}

for (const model of models) {
  for (const way of ["free", "ends", "ends1", "line"]) {
    const tally = { n: 0, four: 0, aabb: 0, obeyed: 0, named: 0, loved: 0, leak: 0, ms: 0 };
    for (const seed of SEEDS) for (let r = 0; r < RUNS; r++) {
      const ends = way === "free" ? null : endWords(seed);
      const { text, ms, calls = 1 } = way === "line" ? await byLine(model, seed, ends) : await ask(model, messages(way, seed, ends));
      tally.calls = (tally.calls || 0) + calls;
      const j = judge(text, seed, ends);
      tally.n++; tally.ms += ms;
      for (const k of ["four", "aabb", "named", "loved", "leak"]) tally[k] += j[k] ? 1 : 0;
      if (ends) tally.obeyed += j.obeyed;
      console.log(`\n[${model} ${way}] ${seed.name}${ends ? " ends=" + ends.flat().join("/") : ""}` +
        `  4lines=${j.four} AABB=${j.aabb}${ends ? " ends=" + j.obeyed + "/4" : ""} named=${j.named} loved=${j.loved}${j.leak ? " LEAK" : ""}`);
      console.log(j.lines.map(l => "   " + l).join("\n"));
    }
    console.log(`\n== ${model} ${way}: four lines ${tally.four}/${tally.n}, AABB rhymes ${tally.aabb}/${tally.n}` +
      (way === "free" ? "" : `, end words obeyed ${tally.obeyed}/${tally.n * 4}`) +
      `, named ${tally.named}/${tally.n}, loved thing ${tally.loved}/${tally.n}, example leaked ${tally.leak}/${tally.n}` +
      `, ${(tally.ms / tally.n / 1000).toFixed(1)} s and ${(tally.calls / tally.n).toFixed(1)} calls each\n`);
  }
}
