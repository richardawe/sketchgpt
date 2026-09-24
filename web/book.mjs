// Book mode — a short picture-book story written by the model, illustrated by
// the page.
//
// The model does the two things it can: write a simple story, and name what is
// in each picture. The page does everything else — placing (web/scene.mjs),
// drawing (web/sketch.mjs), and above all CONTINUITY, which the model is never
// trusted with. Three model-written books (docs/storybook.md) showed why:
//
//   - with nothing concrete on a page, the model copied the scene prompt's
//     example verbatim (5 of 18 pages)
//   - a dog called Ducky was drawn as a duck; "Sir Tink" was printed as a word
//   - "He jumped into the water", on a dog's page, came back as a boy
//   - the hero vanished whenever the text said "he" instead of the name
//
// fixPagePlan() is the answer to each of those. On a phone-sized model the
// scene list is not asked for at all: the small models loop or copy it
// (docs/sketch-scenes.md), so planFromWords() builds each picture from the
// page's own words and the cast — the page doing all of it.

import { resolveStamp } from "./sketch.mjs?v=8";
import { scenePrompt, parseEntry } from "./scene.mjs?v=8";
import { ART_NAMES } from "./art-names.mjs?v=8";

export const PAGES = 6;

// The envelope is fixed by a JSON schema, the path WebLLM has proven on a
// phone (sketch mode uses it). The story inside is free.
export const STORY_SCHEMA = JSON.stringify({
  type: "object", required: ["title", "cast", "pages"], additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: 80 },
    cast: { type: "array", minItems: 1, maxItems: 3, items: {
      type: "object", required: ["name", "is"], additionalProperties: false,
      properties: { name: { type: "string", maxLength: 40 }, is: { type: "string", maxLength: 20 } } } },
    pages: { type: "array", minItems: PAGES, maxItems: PAGES, items: { type: "string", maxLength: 400 } }
  }
});

export function storyMessages(premise) {
  return [
    { role: "system", content: "You write short picture-book stories for young children. Warm, simple, " +
      "with a small problem and a happy ending. Each page is two or three short sentences. Give each " +
      "main character a name and say in one plain word what they are (dog, cat, girl, boy, dragon, bird...)." },
    // No placeholder text in the prompt. With `"pages": ["page 1 text", ...]`
    // in it, Qwen2.5-0.5B wrote a book whose pages read "page 1 text", "page 2
    // text" — in 2 of 3 stories. The schema already fixes the shape.
    { role: "user", content: `Write a ${PAGES}-page picture-book story about ${premise}. Reply in JSON ` +
      `with the title, the cast (each main character's name and what they are), and the ${PAGES} pages.` }
  ];
}

// A story needs room: six short pages and a title fit well inside this.
export const STORY_TOKENS = 900;
export const PAGE_TOKENS = 320;

/**
 * The model's story, checked. Thinking tags and code fences are stripped, and a
 * story cut off mid-page keeps the pages that finished — half a book is
 * visibly half a book, where an error says only "try again".
 */
export function parseStory(raw) {
  let text = String(raw || "").trim();
  const end = text.indexOf("</think>");
  if (end !== -1) text = text.slice(end + 8).trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let data = null;
  try { data = JSON.parse(text); } catch {
    const title = text.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const after = text.slice(text.indexOf('"pages"'));
    const pages = after.includes("[") ? [...after.matchAll(/"((?:[^"\\]|\\.){12,})"/g)].map(m => m[1]) : [];
    const cast = [...text.matchAll(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"is"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
      .map(m => ({ name: m[1], is: m[2] }));
    if (pages.length) data = { title: title ? title[1] : "", cast, pages, truncated: true };
  }
  if (!data || !Array.isArray(data.pages)) throw new Error("The model did not write a story. Try again.");
  const pages = data.pages.filter(p => typeof p === "string")
    // "page 1: Emily plants a seed" — the number is the page's job, not the text's.
    .map(p => p.trim().replace(/^page\s*\d+\s*[:.\-–—]\s*/i, "").trim())
    // A placeholder copied from a template is not a page.
    .filter(p => p && !/^(page\s*\d+\s*(text)?|\.\.\.|…|text)$/i.test(p))
    .slice(0, 8);
  if (pages.length < 2) throw new Error("The model did not write a story. Try again.");
  const cast = (Array.isArray(data.cast) ? data.cast : [])
    .filter(c => c && typeof c.name === "string" && typeof c.is === "string" && c.name.trim())
    .map(c => ({ name: c.name.trim(), is: c.is.trim().toLowerCase().split(/\s+/).pop() }))
    .slice(0, 3);
  return { title: (typeof data.title === "string" && data.title.trim()) || "A story", cast, pages,
           truncated: !!data.truncated || pages.length < PAGES };
}

export function pageMessages(story, text) {
  const castLine = story.cast.map(c => `${c.name} is drawn as "${drawAs(c) || c.is}"`).join("; ");
  return [
    { role: "system", content: scenePrompt(12) + `\nThis picture is one page of a story.` +
      (castLine ? ` ${castLine}. Draw each character who is on this page with exactly that word, once.` : "") },
    { role: "user", content: `Draw the picture for this page: ${text}` }
  ];
}

// ---- The page's rules ----------------------------------------------------------

// The scene prompt's example (web/scene.mjs). On a page with nothing concrete
// to draw the model copies it whole; three or more of these that the text never
// mentions is that copy.
const EXAMPLE = ["boat", "lighthouse", "bird", "fish", "crane"];
const PEOPLE = new Set(["user", "users", "baby", "family", "girl", "boy", "child"]);

// Words that set a scene, for building a picture straight from the page.
const SETTING_WORDS = { sea: "sea", ocean: "sea", beach: "sand", sand: "sand", shore: "sand",
  waves: "sea", night: "moon", sunset: "sun", forest: "pine x3", woods: "pine x3",
  garden: "flower x3", park: "tree x2", farm: "tractor", snow: "snowman", rain: "rain x2",
  castle: "castle", village: "house x3", town: "house x2", city: "building x3" };

// The words of a name that identify it. "The Sun", "Mr. Whiskers" and "Sir
// Tink" were matched on "The", "Mr" and "Sir" at first — "the" is on every
// page, so "The Sun" was drawn on all six.
const TITLES = new Set(["the", "a", "an", "mr", "mrs", "ms", "miss", "sir", "lady", "dr", "little", "old",
  "young", "big", "captain", "king", "queen", "princess", "prince", "mister", "madam", "uncle", "aunt"]);
export const nameWords = name => String(name).toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/)
  .filter(w => w.length >= 2 && !TITLES.has(w));
const named = (name, text) => nameWords(name).some(w => new RegExp("\\b" + w + "\\b", "i").test(text));

const said = e => (parseEntry(e) || {}).said || "";
const stampOf = e => (parseEntry(e) || {}).stamp || null;

// A hero with no illustration of its own is drawn as the nearest person, so
// they are still on every page. The first phone run of Book mode died on a
// picture with nothing in it: a page whose only subject had no picture.
// Fairies, witches and grandmas are people as far as a picture book's
// illustrations go; a wizard or a knight is a boy-sized hero, not a blank page.
const STAND_IN = { fairy: "girl", witch: "girl", mermaid: "girl", queen: "girl", lady: "girl",
  woman: "girl", mother: "girl", mom: "girl", mum: "girl", grandma: "girl", granny: "girl",
  grandmother: "girl", sister: "girl", aunt: "girl", daughter: "girl", ballerina: "girl",
  wizard: "boy", knight: "boy", king: "boy", man: "boy", father: "boy", dad: "boy",
  grandpa: "boy", grandfather: "boy", brother: "boy", uncle: "boy", son: "boy", pirate: "boy",
  giant: "boy", elf: "child", gnome: "child", kid: "child", person: "child", friend: "child",
  teacher: "child", hero: "child", dino: "dinosaur", kitty: "cat", doggy: "dog", pup: "dog",
  bunny: "rabbit", birdie: "bird", pony: "horse", dragonfly: "butterfly" };
/** The word a character is drawn with, or null when there is none. */
export const drawAs = c => resolveStamp(c.is) ? c.is : (STAND_IN[c.is] || null);
const castStamp = c => { const w = drawAs(c); return w ? resolveStamp(w) : null; };

// Words the illustrations happen to have that are not things in a scene.
// "Max feels happy" drew a grinning emoji face on the page, "they love
// flying" a heart, "friends" a stand-in child (measured, book-bench on
// Qwen3-0.6B). A picture book's picture shows the story, not its feelings.
const ABSTRACT = new Set(["happy", "happiness", "love", "loves", "loved", "friend", "friends",
  "heart", "light", "world", "game", "games", "family", "fun", "joy", "smile", "sad", "angry",
  "idea", "dream", "dreams", "magic", "time", "day", "way", "place", "thing", "things",
  "help", "hope", "kind", "brave", "proud", "scared", "afraid", "adventure", "story", "end",
  "problem", "surprise", "wish", "wishes", "map", "new", "best", "lot", "lots", "top", "back"]);

/** Picture names that appear in the text itself — exact words only, never a loose prefix. */
export function planFromWords(text, story = { cast: [] }) {
  const names = story.cast.flatMap(c => nameWords(c.name));
  const cast = new Set(story.cast.map(castStamp));
  const seen = new Set();
  const found = [];
  for (const raw of String(text).toLowerCase().match(/[a-z]+/g) || []) {
    if (raw.length < 3) continue;
    const w = raw.replace(/(ies)$/, "y").replace(/s$/, "");
    if (ABSTRACT.has(raw) || ABSTRACT.has(w)) continue;
    const entry = SETTING_WORDS[raw] || SETTING_WORDS[w] || (ART_NAMES[raw] || ART_NAMES[w] ? w : null);
    if (!entry || names.some(n => n.startsWith(w))) continue;
    const st = stampOf(entry);
    if (st && (seen.has(st) || cast.has(st))) continue;
    if (st) seen.add(st);
    if (!found.includes(entry)) found.push(entry);
  }
  return found;
}

/**
 * Apply the rules to one page's plan. Returns { entries, fixes, unknown }:
 * `fixes` says what the page changed, so the book can show its working.
 */
export function fixPagePlan(entries, text, story) {
  let c = entries.filter(e => typeof e === "string").slice(0, 24);
  const fixes = [];
  const inText = w => w && new RegExp("\\b" + w.split(" ")[0].replace(/s$/, "").replace(/[^a-z0-9]/gi, ""), "i").test(text);
  const casts = story.cast.map(castStamp);
  const names = story.cast.flatMap(x => nameWords(x.name));

  // 1. The example, copied onto a vague page.
  const leaked = c.filter(e => EXAMPLE.some(w => said(e).startsWith(w)) && !inText(said(e)));
  if (leaked.length >= 3) { c = c.filter(e => !leaked.includes(e)); fixes.push("copied example removed"); }

  // 2. A name is not a thing.
  c = c.filter(e => {
    const w = said(e).toLowerCase();
    const fromName = w && names.some(n => n.startsWith(w) || w.startsWith(n)) &&
      !casts.includes(stampOf(e));
    if (fromName) fixes.push(`"${w}" is a name, not a thing`);
    return !fromName;
  });

  // 3. No stand-ins for a hero who is not a person.
  if (casts[0] && !PEOPLE.has(casts[0])) c = c.filter(e => {
    const drop = PEOPLE.has(stampOf(e)) && !inText(said(e)) && !casts.includes(stampOf(e));
    if (drop) fixes.push(`stand-in "${said(e)}" removed`);
    return !drop;
  });

  // 4. Things with no picture stay off the art — the text is right under it.
  const unknown = c.filter(e => { const p = parseEntry(e); return p && !p.stamp && !p.setting; }).map(said);
  c = c.filter(e => { const p = parseEntry(e); return !p || p.stamp || p.setting; });

  // 5. Nearly empty: build the picture from the page's own words.
  if (c.filter(e => !casts.includes(stampOf(e))).length < 2) {
    const have = new Set(c.map(stampOf));
    const more = planFromWords(text, story).filter(e => !have.has(stampOf(e)));
    if (more.length) { c.push(...more); fixes.push("drawn from the page's words"); }
  }

  // 6. The cast: the hero on every page, anyone else named on this page too —
  //    each exactly once, big, as the same picture every time.
  const cast = [];
  story.cast.forEach((x, k) => {
    const want = casts[k];
    if (!want) return;
    c = c.filter(e => stampOf(e) !== want);
    if (k === 0 || named(x.name, text)) {
      cast.push(`big ${drawAs(x)} front`);
      if (drawAs(x) !== x.is) fixes.push(`${x.name} drawn as a ${drawAs(x)} — there is no ${x.is} picture`);
    }
  });
  return { entries: [...cast, ...c], fixes, unknown };
}

/** The picture plan for a page when the model is too small to plan scenes. */
export function wordsOnlyPlan(text, story) {
  return fixPagePlan(planFromWords(text, story), text, story);
}

/** The cover: the whole cast in the first page's setting. */
export function coverPlan(story, firstPage) {
  return [...story.cast.filter(c => castStamp(c)).map(c => `big ${drawAs(c)} front`),
          ...firstPage.filter(e => !/^big /.test(e))];
}
