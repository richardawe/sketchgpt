// Write a short illustrated story with a real model — the Book-mode spike.
//
//   node scripts/storybook.mjs qwen3:1.7b "a little dog who has never seen the sea" story.json
//   PLAYWRIGHT_MODULE=... SKETCH_CHROME=... node scripts/storybook-render.mjs story.json out/book
//
// The model writes the story (title, cast, six pages) and plans each page as a
// scene list; web/scene.mjs places it and web/sketch.mjs draws it. The page
// guards what a story exposes that a single sketch does not (docs/storybook.md):
// the example leaking onto pages with nothing concrete to draw, a character's
// name read as a thing (Ducky -> a duck), "he" drawn as a stand-in boy, and the
// hero going missing. The page, not the model, owns continuity.
import { writeFileSync } from "node:fs";
import * as sk from "../web/sketch.mjs?v=9";
import { scenePrompt, parseEntry } from "../web/scene.mjs?v=9";
import { ART_NAMES } from "../web/art-names.mjs?v=8";
const [model, premise, out] = process.argv.slice(2);
const chat = async (messages, format, temperature, num_predict) => {
  const r = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({
    model, messages, stream: false, think: false, format, options: { temperature, num_predict } }) }).then(r => r.json());
  return r.message.content;
};
const t0 = Date.now();
// 1. The story: title, cast (each with a drawable word), six short pages.
const STORY = { type: "object", required: ["title", "cast", "pages"], properties: {
  title: { type: "string" },
  cast: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", required: ["name", "is"],
    properties: { name: { type: "string" }, is: { type: "string" } } } },
  pages: { type: "array", minItems: 6, maxItems: 6, items: { type: "string" } } } };
const raw = await chat([
  { role: "system", content: "You write short picture-book stories for young children. Warm, simple, with a small problem and a happy ending. Each page is two or three short sentences. Give each main character a name and say in one plain word what they are (dog, cat, girl, boy, dragon, bird...)." },
  { role: "user", content: `Write a six-page picture-book story: ${premise}. Reply as JSON: {"title": "...", "cast": [{"name": "...", "is": "..."}], "pages": ["page 1 text", "..."]}` }
], STORY, 0.8, 900);
const story = JSON.parse(raw);
const tStory = Date.now() - t0;
console.log(`# ${story.title}\ncast: ${story.cast.map(c => `${c.name} (${c.is})`).join(", ")}   [${(tStory / 1000).toFixed(1)}s]`);

// 2. Each page -> a scene plan, with the cast named so the pictures agree.
const castLine = story.cast.map(c => `${c.name} is drawn as "${c.is}"`).join("; ");
const pages = [];
for (const [i, text] of story.pages.entries()) {
  const t1 = Date.now();
  const planRaw = await chat([
    { role: "system", content: scenePrompt(12) + `\nThis picture is one page of a story. ${castLine}. Draw each character who is on this page with exactly that word, once.` },
    { role: "user", content: `Draw the picture for this page: ${text}` }
  ], JSON.parse(sk.SKETCH_SCHEMA), 0.3, 320);
  let plan; try { plan = sk.readDrawing(planRaw); } catch { plan = { t: `Page ${i + 1}`, c: [] }; }
  const said = e => (parseEntry(e) || {}).said || "";
  const stampOf = e => (parseEntry(e) || {}).stamp || null;
  const inText = w => new RegExp("\\b" + w.split(" ")[0].replace(/s$/, ""), "i").test(text);
  const castStamps = story.cast.map(c => sk.resolveStamp(c.is));
  const fixes = [];
  // 1. Example leak: with nothing concrete on the page, the model copied the
  //    prompt's harbour example verbatim. Drop example things the text never mentions.
  const EXAMPLE = ["boat", "lighthouse", "bird", "fish", "crane"];
  const leaked = plan.c.filter(e => EXAMPLE.some(w => said(e).startsWith(w)) && !inText(said(e)));
  if (leaked.length >= 3) { plan.c = plan.c.filter(e => !leaked.includes(e)); fixes.push("example leak: " + leaked.join(", ")); }
  // 2. A name is not a noun: a dog called Ducky came back as a duck.
  const names = story.cast.map(c => c.name.toLowerCase());
  plan.c = plan.c.filter(e => {
    const w = said(e).toLowerCase(), st = stampOf(e);
    const fromName = w && names.some(n => n.startsWith(w) || n.includes(w)) && !castStamps.includes(st);
    if (fromName) fixes.push("name read as a thing: " + w);
    return !fromName;
  });
  // 3. No stand-ins: "He" on a dog's page came back as a boy.
  const PEOPLE = new Set(["user", "users", "baby", "family"]);
  if (!PEOPLE.has(castStamps[0])) plan.c = plan.c.filter(e => {
    const drop = PEOPLE.has(stampOf(e)) && !inText(said(e));
    if (drop) fixes.push("stand-in: " + said(e));
    return !drop;
  });
  // 4. Things with no picture stay off the art; the text is right under it.
  const unknown = plan.c.filter(e => { const p = parseEntry(e); return p && !p.stamp && !p.setting; }).map(said);
  plan.c = plan.c.filter(e => { const p = parseEntry(e); return !p || p.stamp || p.setting; });
  // 4b. Nearly empty after the fixes: read the page's own words. Only exact
  //     picture names count here ("sun", "boat", "sea") — never a loose prefix.
  if (plan.c.filter(e => !castStamps.includes(stampOf(e))).length < 2) {
    const SETTING = { sea: "sea", ocean: "sea", beach: "sand", sand: "sand", shore: "sand", waves: "sea",
      night: "moon", sunset: "sun", forest: "pine x3", woods: "pine x3", garden: "flower x3", park: "tree x2",
      farm: "tractor", snow: "snowman", rain: "rain x2" };
    const seen = new Set(plan.c.map(stampOf));
    const found = [];
    for (const raw of text.toLowerCase().match(/[a-z]+/g) || []) {
      const w = raw.replace(/(ies)$/, "y").replace(/s$/, "");
      const entry = SETTING[raw] || SETTING[w] || (ART_NAMES[raw] || ART_NAMES[w] ? w : null);
      if (!entry || names.some(n => n.startsWith(w))) continue;
      const st = stampOf(entry);
      if (st && (seen.has(st) || castStamps.includes(st))) continue;
      if (st) seen.add(st);
      if (!found.includes(entry)) found.push(entry);
    }
    if (found.length) { plan.c.push(...found); fixes.push("read from the text: " + found.join(", ")); }
  }
  // 5. The cast: the main character on every page, anyone else named in the
  //    text too — each exactly once, as the same picture.
  const added = [];
  story.cast.forEach((c, k) => {
    const want = castStamps[k];
    if (!want) return;
    const on = k === 0 || new RegExp("\\b" + c.name.split(" ")[0] + "\\b", "i").test(text);
    const mine = plan.c.filter(e => stampOf(e) === want);
    plan.c = plan.c.filter(e => stampOf(e) !== want);
    if (on) { plan.c.unshift("big " + c.is + " front"); if (!mine.length) added.push(c.is); }
  });
  if (added.length) fixes.push("cast added: " + added.join(", "));
  pages.push({ text, plan, fixes, unknown, ms: Date.now() - t1 });
  console.log(`\np${i + 1}. ${text}\n   -> ${plan.c.join(" | ")}${fixes.length ? `
      page fixed: ${fixes.join("; ")}` : ""}${unknown.length ? `
      no picture, left off: ${unknown}` : ""}   ${(pages.at(-1).ms / 1000).toFixed(1)}s`);
}
writeFileSync(out, JSON.stringify({ model, premise, ...story, pages, seconds: (Date.now() - t0) / 1000 }, null, 1));
console.log(`\ntotal ${((Date.now() - t0) / 1000).toFixed(0)}s on CPU`);
