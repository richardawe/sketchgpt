// Runs the page's real sketch prompt through real models and judges the
// output with the page's real parser.
//
// This exists because the question "will a bigger model draw better?" cannot
// be answered by looking at the page. SwiftShader loads models but cannot
// generate, so quality has to come from Ollama on CPU — which does work in
// this sandbox, provided zstd is installed before Ollama's installer runs.
//
//   apt-get install -y zstd && curl -fsSL https://ollama.com/install.sh | sh
//   OLLAMA_MODELS=$PWD/models/ollama ollama serve &
//   ollama pull qwen3:0.6b && ollama pull qwen3:1.7b
//   node scripts/sketch-bench.mjs qwen3:0.6b qwen3:1.7b
//
// Caveat worth repeating in any claim made from this: Ollama serves GGUF
// Q4_K_M and the browser serves MLC q4f16. This measures composition — how
// many of the requested things appear, and whether they are placed — not the
// exact bytes a visitor's device produces.
import { sketchPrompt, parseSketch, SKETCH_SCHEMA, PALETTE } from "../web/sketch.mjs";

const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

// Requests that separate composition from copying. The first three name
// things the examples never mention; "a birthday party" names nothing
// concrete at all, which is where a model that is retrieving rather than
// composing gives itself away.
const REQUESTS = [
  { ask: "Draw a house", want: ["house"] },
  { ask: "Draw a house with a tree and a car", want: ["house", "tree", "car"] },
  { ask: "Draw a cat under the sun", want: ["cat", "sun"] },
  { ask: "Draw a boat on the sea with two birds", want: ["boat", "bird"] },
  { ask: "Draw a bird above a house", want: ["bird", "house"] },
  { ask: "Draw a birthday party", want: [] },
];
const COLOURED = [
  { ask: "Draw a red house with a green tree", want: ["house", "tree"], colours: 2 },
  { ask: "Draw a yellow sun over a blue sea", want: ["sun"], colours: 2 },
];

async function ask(model, request, colour) {
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model, stream: false, think: false,
      options: { temperature: 0.2, num_predict: 700, num_ctx: 4096 },
      format: JSON.parse(SKETCH_SCHEMA),
      messages: [{ role: "system", content: sketchPrompt(40, false, colour) },
                 { role: "user", content: request }],
    }),
  });
  const json = await res.json();
  return { text: json.message?.content ?? "", tokens: json.eval_count ?? 0 };
}

// Did the drawing contain the things that were asked for? Matched against the
// model's own noun, since that is what it chose to say.
const covered = (drawing, want) => want.filter(w =>
  drawing.source.some(line => line.toLowerCase().startsWith(w))).length;

async function run(model, cases, colour) {
  let parsed = 0, commands = 0, nouns = 0, asked = 0, got = 0, piled = 0, painted = 0;
  for (const c of cases) {
    const { text, tokens } = await ask(model, c.ask, colour);
    try {
      const d = parseSketch(text);
      parsed++;
      commands += d.commands.length;
      nouns += new Set(d.commands.filter(x => x.tool === "stamp").map(x => x.text)).size;
      asked += c.want.length;
      got += covered(d, c.want);
      painted += d.commands.filter(x => x.colour && PALETTE[x.colour]).length;
      if (d.moved) piled++;
      console.log(`  ${c.ask.padEnd(38)} ${String(d.commands.length).padStart(2)} cmds` +
        `${d.moved ? `, ${d.moved} piled` : ""}${d.dropped ? `, ${d.dropped} dropped` : ""}` +
        `  (${tokens} tokens)`);
      console.log(`  ${" ".repeat(38)} ${d.source.join(" | ").slice(0, 160)}`);
    } catch (e) {
      console.log(`  ${c.ask.padEnd(38)} FAILED: ${e.message}`);
      console.log(`  ${" ".repeat(38)} ${JSON.stringify(text).slice(0, 160)}`);
    }
  }
  return { parsed, commands, nouns, asked, got, piled, painted };
}

const models = process.argv.slice(2);
if (!models.length) {
  console.error("usage: node scripts/sketch-bench.mjs <model> [model...]");
  process.exit(1);
}
const table = [];
for (const model of models) {
  console.log(`\n================ ${model} ================`);
  const plain = await run(model, REQUESTS, false);
  console.log(`  -- with colour taught --`);
  const colour = await run(model, COLOURED, true);
  table.push({ model, plain, colour });
}

console.log("\nmodel          parsed  commands  distinct nouns  asked-for things drawn  piled  colours used");
for (const { model, plain, colour } of table) {
  console.log(`  ${model.padEnd(13)} ${String(plain.parsed).padStart(1)}/${REQUESTS.length}` +
    `${String(plain.commands).padStart(10)}${String(plain.nouns).padStart(16)}` +
    `${`${plain.got}/${plain.asked}`.padStart(24)}${String(plain.piled).padStart(7)}` +
    `${String(colour.painted).padStart(14)}`);
}
console.log("\n  'piled' counts drawings the page had to spread apart — every model does this.");
