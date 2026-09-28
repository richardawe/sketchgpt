// Stories by rules (web/story.mjs) against stories by the model, on what can be
// counted — and a blind sheet for what cannot.
//
//   node scripts/story-rules-bench.mjs [outdir]      (default: bench-out/)
//
// Counted, for both:
//   hero named     pages that name the hero (a page that says only "he" is the
//                  one where the hero went missing from the picture)
//   only the hero  pages whose picture is the hero and nothing else
//   stray drawings things drawn that the words never meant as things — the
//                  rule books mark every drawable word, so these are exact for
//                  them and not counted for the model's
// For the rules only, because it is their one real weakness:
//   versions       distinct books from one set of choices, over 1000 seeds
//   repeats        of 8 books from the same choices, how many pages the
//                  average pair shares word for word
//
// Coherence has no mechanical check. The sheet (read.md) holds the model's
// four real books from scripts/demo-books/ — captured from Qwen3 on the
// owner's phone and on desktop with Book's own prompt — and four rule books on
// the same ideas, shuffled and unlabelled, for a person to score 0–3 before
// opening key.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { writeStory } from "../web/story.mjs";
import { parseStory, wordsOnlyPlan, nameWords, planFromWords } from "../web/book.mjs?v=9";

const out = process.argv[2] || "bench-out";
mkdirSync(out, { recursive: true });

const IDEAS = [
  { idea: "a little dog who has never seen the sea", choices: { kind: "dog", place: "farm", wish: "sea" }, model: ["dog-phone", "dog-shaped"] },
  { idea: "a young dragon who is afraid of the dark", choices: { kind: "dragon", place: "forest", wish: "dark" }, model: ["dragon"] },
  { idea: "a girl who plants a magic seed", choices: { kind: "girl", place: "garden", wish: "grow" }, model: ["seed"] },
  { idea: "a robot who wants a friend", choices: { kind: "robot", place: "town", wish: "friend" }, model: [] },
];

const count = (story, marked = null) => {
  const hero = story.cast[0];
  const words = hero ? nameWords(hero.name) : [];
  let named = 0, alone = 0, stray = 0;
  story.pages.forEach((t, i) => {
    if (words.some(w => new RegExp("\\b" + w + "\\b", "i").test(t))) named++;
    const heroEntry = hero ? `big ${hero.is} front` : null;
    if (!wordsOnlyPlan(t, story).entries.filter(e => e !== heroEntry).length) alone++;
    if (marked) {
      const want = new Set(planFromWords(marked[i].join(" "), story));
      stray += planFromWords(t, story).filter(e => !want.has(e)).length;
    }
  });
  return { pages: story.pages.length, named, alone, stray: marked ? stray : "—" };
};

const rows = [];
const books = [];
for (const { idea, choices, model } of IDEAS) {
  for (const file of model) {
    const d = JSON.parse(readFileSync(new URL(`./demo-books/${file}.json`, import.meta.url)));
    const s = parseStory(d.story);
    rows.push({ who: `${d.model} (${d.device})`, idea, ...count(s) });
    books.push({ source: `model: ${d.model}, ${d.device}, scripts/demo-books/${file}.json`, idea, title: s.title, pages: s.pages });
  }
  const eight = Array.from({ length: 8 }, (_, seed) => writeStory({ ...choices, seed }));
  for (const s of eight) rows.push({ who: "rules", idea, ...count(s, s.drawn) });
  const r = eight[0];
  books.push({ source: `rules: ${JSON.stringify(r.choices)}`, idea, title: r.title, pages: r.pages });

  const versions = new Set(Array.from({ length: 1000 }, (_, seed) => writeStory({ ...choices, seed }).pages.join("\n"))).size;
  let shared = 0, pairs = 0;
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++, pairs++)
    shared += eight[a].pages.filter((p, i) => p === eight[b].pages[i]).length;
  console.log(`${idea}: ${versions} versions from one set of choices; 8 books share ${(shared / pairs).toFixed(1)} of 6 pages per pair`);
}

const sum = who => {
  const r = rows.filter(x => x.who === who || (who === "model" && x.who !== "rules"));
  const t = k => r.reduce((a, x) => a + (typeof x[k] === "number" ? x[k] : 0), 0);
  return `${who.padEnd(6)} books ${String(r.length).padStart(2)}  pages ${t("pages")}  hero named ${t("named")}  only the hero ${t("alone")}` +
    (who === "rules" ? `  stray drawings ${t("stray")}` : "");
};
console.log("\n" + sum("model") + "\n" + sum("rules"));
for (const r of rows.filter(r => r.who !== "rules")) console.log(`  ${r.who}  ${r.idea}: named ${r.named}/${r.pages}, only the hero ${r.alone}`);

// The blind sheet: shuffled with a fixed seed, so a rerun gives the same sheet.
let h = 7;
const rand = () => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000;
const order = books.map((b, i) => [rand(), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => books[i]);
writeFileSync(`${out}/read.md`, `# Eight picture books — score each 0–3 before opening key.json\n\n` +
  `0 does not make sense · 1 odd in places · 2 makes sense · 3 a story you would read to a child\n\n` +
  order.map((b, i) => `## Book ${String.fromCharCode(65 + i)}: ${b.title}\n\n` +
    b.pages.map((p, k) => `${k + 1}. ${p}`).join("\n") + "\n\nScore: ___\n").join("\n"));
writeFileSync(`${out}/key.json`, JSON.stringify(order.map((b, i) => ({ book: String.fromCharCode(65 + i), ...b, pages: undefined })), null, 1));
console.log(`\nWrote ${out}/read.md and ${out}/key.json`);
