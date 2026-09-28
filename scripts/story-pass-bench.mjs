// Does a second pass make a small model's story make sense? It does not — the
// page's shape does. Writes each approach's stories out for a person to read
// and score: coherence has no mechanical check, so this prints, it does not judge.
//
//   OLLAMA_MODELS=$PWD/models/ollama ollama serve &
//   node scripts/story-pass-bench.mjs qwen3:0.6b 2 out.json    (ONLY=one,shaped to pick)
//
// one     the prompt before the shape (what shipped until this bench)
// shaped  web/book.mjs's prompt now: one line per page saying what it is for
// advice  the same shape as general advice in the system prompt
// plan    plan six beats, then write from the plan (two calls)
// revise  write, then "rewrite it so it makes sense" (two calls)
//
// Qwen3-0.6B, 8 stories each, scored 0-3 by a person without knowing which
// approach wrote them: one 5/24, revise 6, advice 8, plan 11, shaped 15 (7 of 8
// coherent, none broken). docs/storybook.md. Same caveat as the other benches:
// Ollama serves GGUF Q4_K_M, the browser MLC q4f16.
import { writeFileSync } from "node:fs";
import { storyMessages as shapedMessages, parseStory, STORY_SCHEMA, PAGES, SHAPE } from "../web/book.mjs";

const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const [model = "qwen3:0.6b", runs = "2", out = "story-pass.json"] = process.argv.slice(2);
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const IDEAS = ["a little dog who has never seen the sea", "a young dragon who is afraid of the dark",
  "a girl who plants a magic seed", "a robot who wants a friend"];
const S = JSON.parse(STORY_SCHEMA);
const SYS = shapedMessages("x")[0].content;
const shapeLines = SHAPE.map((a, i) => `Page ${i + 1}: ${a}.`).join(" ");

const chat = async (messages, format, temperature, num_predict) => {
  const r = await fetch(`${HOST}/api/chat`, { method: "POST", body: JSON.stringify({ model, messages, stream: false,
    think: false, format, options: { temperature, num_predict } }) }).then(r => r.json());
  return { text: r.message.content, prompt: r.prompt_eval_count, gen: r.eval_count };
};
// The prompt as it was before the shape, kept so the comparison can be rerun.
const plainMessages = idea => [{ role: "system", content: SYS }, { role: "user", content:
  `Write a ${PAGES}-page picture-book story about ${idea}. Reply in JSON with the title, the cast ` +
  `(each main character's name and what they are), and the ${PAGES} pages.` }];
const OUTLINE = { type: "object", required: ["title", "cast", "beats"], properties: {
  title: { type: "string" }, cast: S.properties.cast,
  beats: { type: "array", minItems: PAGES, maxItems: PAGES, items: { type: "string" } } } };
const ADVICE = "A good picture book has this shape: first we meet the main character at home; then they want " +
  "something, or have a problem; they try, and it does not work; a friend or an idea helps; they try again, and " +
  "it works; and the ending solves the problem. Call each character by their name. Write only the story itself.";

const V = {
  async one(idea) { const r = await chat(plainMessages(idea), S, 0.8, 900); return { raw: r.text, calls: [r] }; },
  async shaped(idea) { const r = await chat(shapedMessages(idea), S, 0.8, 900); return { raw: r.text, calls: [r] }; },
  async advice(idea) {
    const m = plainMessages(idea); m[0].content += " " + ADVICE;
    const r = await chat(m, S, 0.8, 900); return { raw: r.text, calls: [r] }; },
  async plan(idea) {
    const o = await chat([{ role: "system", content: SYS },
      { role: "user", content: `Plan a ${PAGES}-page picture-book story about ${idea}. Reply in JSON with the title, ` +
        `the cast (each main character's name and what they are), and one short sentence for what happens on each page. ${shapeLines}` }],
      OUTLINE, 0.8, 400);
    let plan; try { plan = JSON.parse(o.text); } catch { return { raw: o.text, calls: [o] }; }
    const beats = (plan.beats || []).map((b, i) => `Page ${i + 1}: ${b}`).join("\n");
    const cast = (plan.cast || []).map(c => `${c.name} (${c.is})`).join(", ");
    const w = await chat([{ role: "system", content: SYS },
      { role: "user", content: `Write the picture-book story "${plan.title}". Characters: ${cast}. Follow this plan, one page for each line:\n${beats}\n` +
        `Reply in JSON with the title, the cast, and the ${PAGES} pages.` }], S, 0.7, 900);
    return { raw: w.text, calls: [o, w] }; },
  async revise(idea) {
    const a = await chat(plainMessages(idea), S, 0.8, 900);
    let s; try { s = parseStory(a.text); } catch { return { raw: a.text, calls: [a] }; }
    const b = await chat([{ role: "system", content: SYS },
      { role: "user", content: `Here is a draft of a picture-book story about ${idea}.\nTitle: ${s.title}\n` +
        `Characters: ${s.cast.map(c => `${c.name} (${c.is})`).join(", ")}\n` + s.pages.map((p, i) => `Page ${i + 1}: ${p}`).join("\n") +
        `\n\nRewrite it so it makes sense: keep the same characters and names, make every page follow from the one before, ` +
        `and make the ending solve the problem. Reply in JSON with the title, the cast, and the ${PAGES} pages.` }], S, 0.5, 900);
    return { raw: b.text, calls: [a, b] }; },
};

const results = [];
for (const idea of IDEAS) for (let r = 0; r < +runs; r++) for (const [name, fn] of Object.entries(V)) {
  if (only && !only.includes(name)) continue;
  const res = await fn(idea);
  let story = null; try { story = parseStory(res.raw); } catch {}
  results.push({ model, idea, variant: name, run: r, story, raw: story ? undefined : res.raw,
    tokens: res.calls.map(c => `${c.prompt}+${c.gen}`).join(" ") });
  writeFileSync(out, JSON.stringify(results, null, 1));   // every story, as it lands
  console.log(`\n## ${name} — ${idea}  [${results.at(-1).tokens} tokens]`);
  if (!story) { console.log("NOT A STORY"); continue; }
  console.log(`"${story.title}"  cast: ${story.cast.map(c => `${c.name}=${c.is}`).join(", ")}`);
  story.pages.forEach((p, i) => console.log(`${i + 1}. ${p}`));
}
