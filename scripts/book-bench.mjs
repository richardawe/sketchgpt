// Runs Book mode's real story prompt through real models and draws every page
// with the page's real code, the way a phone does (from the page's words).
//
// Written after the first phone run of Book mode died with "The model did not
// return a drawing in the expected format": a page whose picture held nothing
// but sky and ground. This finds those pages without a phone.
//
//   OLLAMA_MODELS=$PWD/models/ollama ollama serve &
//   node scripts/book-bench.mjs qwen3:0.6b [runs per idea]
//
// Same caveat as the other benches: Ollama serves GGUF Q4_K_M, the browser MLC
// q4f16. This measures what the prompt gets out of a model of that size.
import { storyMessages, parseStory, wordsOnlyPlan, coverPlan, STORY_SCHEMA } from "../web/book.mjs";
import { composeScene } from "../web/scene.mjs";
import { parseSketch } from "../web/sketch.mjs";

const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const IDEAS = ["a little dog who has never seen the sea", "a young dragon who is afraid of the dark",
  "a girl who plants a magic seed", "a cat who wants to fly", "a bunny who lost his carrot",
  "a unicorn who cannot find the rainbow", "a robot who wants a friend", "a brave little mouse"];
const [model = "qwen3:0.6b", runs = "2"] = process.argv.slice(2);

const drawable = entries => {
  const c = composeScene({ t: "", c: entries });
  try { parseSketch(JSON.stringify({ t: "p", c: c.c }), { spread: false }); return true; } catch { return false; }
};

let books = 0, failedStories = 0, pages = 0, empty = 0;
const heroes = {};
for (const idea of IDEAS) for (let r = 0; r < Number(runs); r++) {
  const res = await fetch(`${HOST}/api/chat`, { method: "POST", body: JSON.stringify({
    model, messages: storyMessages(idea), stream: false, think: false, format: JSON.parse(STORY_SCHEMA),
    options: { temperature: 0.8, num_predict: 734 } }) }).then(r => r.json());
  let story;
  try { story = parseStory(res.message.content); } catch { failedStories++; console.log(`\n## ${idea}\nNOT A STORY: ${res.message.content.slice(0, 200)}`); continue; }
  books++;
  const hero = story.cast[0] ? story.cast[0].is : "(no cast)";
  heroes[hero] = (heroes[hero] || 0) + 1;
  console.log(`\n## ${idea} → "${story.title}"  cast: ${story.cast.map(c => `${c.name}=${c.is}`).join(", ") || "none"}`);
  let first = null;
  for (const text of story.pages) {
    pages++;
    const { entries } = wordsOnlyPlan(text, story);
    first = first || entries;
    const ok = drawable(entries);
    if (!ok) empty++;
    console.log(`${ok ? "  " : "!!"} [${entries.join(", ")}]  ${text.slice(0, 90)}`);
  }
  if (first && !drawable(coverPlan(story, first))) console.log("!! cover has nothing to draw");
}
console.log(`\n${model}: ${books} books (${failedStories} not stories), ${pages} pages, ${empty} with nothing to draw`);
console.log("heroes:", JSON.stringify(heroes));
