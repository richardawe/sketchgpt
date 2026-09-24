// Captures real Book-mode output from a real model, for record-demo.mjs to
// replay. The clips must show what a model actually wrote and what the page
// actually did with it — so nothing in scripts/demo-books/ is written by hand.
//
//   OLLAMA_MODELS=$PWD/models/ollama ollama serve &
//   node scripts/capture-book.mjs qwen3:1.7b desktop "a little dog who has never seen the sea" dog
//   node scripts/capture-book.mjs qwen3:0.6b phone "a young dragon who is afraid of the dark" dragon
//
// "desktop" also captures the per-page scene plans (Qwen3-1.7B plans pages in
// the app); "phone" does not (the app draws a phone's pages from their words).
// Same prompts, schemas and token limits as web/browser.html. Ollama serves
// GGUF Q4_K_M where the browser serves MLC q4f16; the timing is not captured
// and the clips do not show it.
import { writeFileSync } from "node:fs";
import { storyMessages, pageMessages, parseStory, STORY_SCHEMA, STORY_TOKENS, PAGE_TOKENS } from "../web/book.mjs";
import { SKETCH_SCHEMA } from "../web/sketch.mjs";

const [model, device, premise, name] = process.argv.slice(2);
if (!name) { console.error("usage: capture-book.mjs <model> desktop|phone <premise> <name>"); process.exit(1); }
const chat = async (messages, format, temperature, num_predict) => (await fetch("http://127.0.0.1:11434/api/chat", {
  method: "POST", body: JSON.stringify({ model, messages, stream: false, think: false, format: JSON.parse(format),
    options: { temperature, num_predict } }) }).then(r => r.json())).message.content;

// The phone's 1024 context leaves 734 tokens for the story, as in the report
// from the real phone; a desktop gets the full STORY_TOKENS.
const story = await chat(storyMessages(premise), STORY_SCHEMA, 0.8, device === "phone" ? 734 : STORY_TOKENS);
const parsed = parseStory(story);
const plans = [];
if (device === "desktop") for (const text of parsed.pages)
  plans.push(await chat(pageMessages(parsed, text), SKETCH_SCHEMA, 0.3, PAGE_TOKENS));
writeFileSync(new URL(`./demo-books/${name}.json`, import.meta.url),
  JSON.stringify({ model, device, premise, story, plans }, null, 1) + "\n");
console.log(`"${parsed.title}" — ${parsed.cast.map(c => `${c.name}=${c.is}`).join(", ")}`);
parsed.pages.forEach((p, i) => console.log(`${i + 1}. ${p}${plans[i] ? `\n   ${JSON.parse(plans[i]).c.join(", ")}` : ""}`));
