// Book mode: the story is the model's, continuity is the page's.
//
//   node --test tests/book.test.mjs
//
// Each rule here is a failure seen in model-written books (docs/storybook.md):
// a dog called Ducky drawn as a duck, a boy standing in for a dog who "jumped
// into the water", the hero missing from a page that said "he", the scene
// prompt's harbour example copied onto a vague page, and — from Qwen2.5-0.5B —
// a book whose pages read "page 1 text".
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES, STORY_SCHEMA, storyMessages, parseStory, pageMessages, nameWords,
         planFromWords, fixPagePlan, wordsOnlyPlan, coverPlan } from "../web/book.mjs?v=7";

const story = (pages, extra = {}) => JSON.stringify({ title: "Pip and the Sea",
  cast: [{ name: "Pip", is: "dog" }], pages, ...extra });
const six = Array.from({ length: PAGES }, (_, i) => `Page ${i + 1} of a story about a dog called Pip.`);
const pip = { cast: [{ name: "Pip", is: "dog" }, { name: "Mr. Gull", is: "bird" }] };
const ducky = { cast: [{ name: "Ducky", is: "dog" }] };

test("the schema fixes six pages and a small cast", () => {
  const s = JSON.parse(STORY_SCHEMA);
  assert.equal(s.properties.pages.minItems, 6);
  assert.equal(s.properties.pages.maxItems, 6);
  assert.equal(s.properties.cast.maxItems, 3);
});

test("the prompt carries the premise and no placeholder text to copy", () => {
  const m = storyMessages("a cat who wants to fly");
  assert.match(m[1].content, /a cat who wants to fly/);
  // `"page 1 text"` in the prompt became the pages themselves on Qwen2.5-0.5B.
  assert.doesNotMatch(m.map(x => x.content).join(" "), /page 1|\.\.\."|"text"/i);
});

test("a story is read, with thinking and code fences stripped", () => {
  const s = parseStory("</think>\n```json\n" + story(six) + "\n```");
  assert.equal(s.title, "Pip and the Sea");
  assert.equal(s.pages.length, 6);
  assert.equal(s.truncated, false);
  assert.deepEqual(s.cast, [{ name: "Pip", is: "dog" }]);
});

test("what a character is comes down to one lowercase word", () => {
  const s = parseStory(story(six, { cast: [{ name: "Luna", is: "Little Dragon" }, { name: "", is: "cat" }] }));
  assert.deepEqual(s.cast, [{ name: "Luna", is: "dragon" }]);
});

test("'page 3:' prefixes go, and a book of placeholders is not a book (Qwen2.5-0.5B)", () => {
  assert.equal(parseStory(story(["page 1: Pip woke up early.", ...six.slice(1)])).pages[0], "Pip woke up early.");
  assert.throws(() => parseStory(story(["page 1 text", "page 2 text", "page 3 text", "...", "text", "page 6"])),
    /did not write a story/);
});

test("a story cut off mid-page keeps the pages that finished", () => {
  const full = story(six);
  const s = parseStory(full.slice(0, full.indexOf("Page 4") + 10));
  assert.equal(s.pages.length, 3);
  assert.equal(s.truncated, true);
  assert.equal(s.title, "Pip and the Sea");
  assert.deepEqual(s.cast, [{ name: "Pip", is: "dog" }]);
});

test("prose is not a story", () => {
  assert.throws(() => parseStory("Once upon a time there was a dog."), /did not write a story/);
  assert.throws(() => parseStory(""), /did not write a story/);
});

test("each page's prompt says how every character is drawn", () => {
  const m = pageMessages(pip, "Pip ran.");
  assert.match(m[0].content, /Pip is drawn as "dog"; Mr\. Gull is drawn as "bird"/);
  assert.match(m[1].content, /Pip ran\./);
});

test("a name's identifying words skip titles ('The Sun' was drawn on every page)", () => {
  assert.deepEqual(nameWords("The Sun"), ["sun"]);
  assert.deepEqual(nameWords("Mr. Whiskers"), ["whiskers"]);
  assert.deepEqual(nameWords("Sir Tink"), ["tink"]);
});

// ---- the page's rules ------------------------------------------------------

test("a dog called Ducky is not drawn as a duck", () => {
  const r = fixPagePlan(["duck", "tree x2"], "Ducky dug under the tree.", ducky);
  assert.deepEqual(r.entries, ["big dog front", "tree x2"]);
  assert.match(r.fixes.join(), /"duck" is a name/);
  assert.deepEqual(planFromWords("Ducky found a line of ducks in the sky.", ducky), [],
    "a name, and 'line' and 'sky', were read as things");
});

test("no boy stands in for a dog who 'jumped into the water'", () => {
  const r = fixPagePlan(["boy", "sea"], "He jumped into the water.", ducky);
  assert.deepEqual(r.entries, ["big dog front", "sea"]);
  // A person the text names is kept.
  assert.ok(fixPagePlan(["boy", "sea"], "A boy threw a ball to Ducky.", ducky).entries.includes("boy"));
});

test("the hero is on every page, once, first — even when the text says 'he'", () => {
  assert.deepEqual(fixPagePlan(["dog x2", "sun", "house"], "He ran home.", pip).entries,
    ["big dog front", "sun", "house"]);
});

test("anyone else in the cast is drawn only on pages that name them", () => {
  assert.deepEqual(fixPagePlan(["tree", "house"], "Mr. Gull waved at Pip.", pip).entries.slice(0, 2),
    ["big dog front", "big bird front"]);
  assert.ok(!fixPagePlan(["tree", "house", "bird"], "Pip slept.", pip).entries.some(e => /bird/.test(e)),
    "a cast member was drawn on a page that does not mention them");
});

test("the scene prompt's example, copied onto a vague page, is removed", () => {
  const r = fixPagePlan(["boat x2", "lighthouse", "bird x3", "fish x2", "crane"], "Pip followed the sound.", pip);
  assert.ok(!r.entries.some(e => /lighthouse|crane|fish/.test(e)), r.entries.join());
  assert.match(r.fixes.join(), /copied example removed/);
  // What the text does mention stays.
  assert.ok(fixPagePlan(["boat x2", "lighthouse", "bird x3", "fish x2", "crane"],
    "Pip watched the boats come home.", pip).entries.includes("boat x2"));
});

test("things with no picture stay off the art and are reported", () => {
  const r = fixPagePlan(["tail", "tree", "house"], "Pip wagged his tail.", pip);
  assert.ok(!r.entries.includes("tail"));
  assert.deepEqual(r.unknown, ["tail"]);
});

test("a near-empty plan is rebuilt from the page's own words", () => {
  const r = fixPagePlan([], "Pip ran across the sand to the sea under the sun.", pip);
  assert.deepEqual(r.entries, ["big dog front", "sand", "sea", "sun"]);
});

test("a phone's picture comes from the words alone, hero included", () => {
  assert.deepEqual(wordsOnlyPlan("At night Pip saw the castle.", pip).entries, ["big dog front", "moon", "castle"]);
});

test("the cover holds the whole cast in the first page's setting", () => {
  assert.deepEqual(coverPlan(pip, ["big dog front", "sea", "sun"]),
    ["big dog front", "big bird front", "sea", "sun"]);
});
