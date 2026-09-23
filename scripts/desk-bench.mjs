// Runs Desk's real prompts through real models and applies the page's real
// checks to what comes back.
//
// Desk's two tools were chosen from five by this kind of run (docs/desk.md).
// Keep running it when a prompt changes: every prompt change so far fixed one
// failure and caused a different one, and only the outputs show which.
//
//   OLLAMA_MODELS=$PWD/models/ollama ollama serve &
//   ollama pull qwen3:0.6b && ollama pull qwen3:1.7b
//   node scripts/desk-bench.mjs qwen3:0.6b qwen3:1.7b
//
// Same caveat as sketch-bench: Ollama serves GGUF Q4_K_M, the browser serves
// MLC q4f16. This measures what the prompts get out of a model of that size,
// not the exact bytes a visitor's device produces.
import { toolById, planDeskTurn, parseChecklist, stripPreamble,
         checkRewrite, leftOut } from "../web/desk.mjs";

const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

// `keep` is what a correct answer must still say; the bench reports a miss so
// a person can read the output, it does not score quality.
const CASES = [
  { tool: "dump", text: "dentist, email Sam about the budget, buy milk, worried about Monday, " +
      "renew passport, call mum back, the car is making a noise" },
  { tool: "dump", text: "book flights for June\npay the gas bill\nfinish the slides for Thursday\n" +
      "I really need a holiday\nreply to Priya" },
  { tool: "polish", option: "more professional",
    text: "hi, the report wont be ready friday because the data came late, sorry", keep: /not|n't|unable/i },
  { tool: "polish", option: "friendlier",
    text: "You never reply to my emails. I need the invoice by 5pm.", keep: /5/ },
  { tool: "polish", option: "more professional",
    text: "i wont be able to pay the full rent this month, can i pay half now and half on the 15th",
    keep: /15/ },
  { tool: "polish", option: "firmer", text: "No. I'm not doing overtime again this weekend.",
    keep: /not|n't/i }
];

const models = process.argv.slice(2);
if (!models.length) { console.error("usage: node scripts/desk-bench.mjs <ollama tag> [...]"); process.exit(1); }

for (const model of models) {
  console.log(`\n======== ${model}`);
  let flagged = 0, missed = 0, empty = 0;
  for (const c of CASES) {
    const tool = toolById(c.tool);
    const plan = planDeskTurn({ tool, text: c.text, option: c.option || "", ctx: 4096 });
    const t0 = Date.now();
    const res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      body: JSON.stringify({ model, messages: plan.messages, stream: false, think: false,
        options: { temperature: tool.temp, num_predict: plan.maxTokens } })
    }).then(r => r.json());
    const out = stripPreamble(res.message.content);
    const ms = Date.now() - t0;
    let checks = [];
    if (!out) empty++;
    else if (tool.list) {
      const items = parseChecklist(out);
      checks = items ? leftOut(c.text, items).map(p => `not on the list: ${p}`) : ["not a list"];
    } else {
      checks = checkRewrite(c.text, out);
      if (c.keep && !c.keep.test(out)) missed++;
    }
    if (checks.length) flagged++;
    console.log(`\n### ${c.tool}${c.option ? ` [${c.option}]` : ""} (${ms} ms)\n> ${c.text.replace(/\n/g, " / ")}\n` +
      (out || "(empty after stripping the preamble)") +
      (checks.length ? `\n  PAGE FLAGS: ${checks.join(" | ")}` : ""));
  }
  console.log(`\n${model}: ${CASES.length} cases, ${empty} empty, ${flagged} flagged by the page, ` +
    `${missed} rewrites missing what they had to keep`);
}
