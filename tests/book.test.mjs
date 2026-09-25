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
import { PAGES, STORY_SCHEMA, SHAPE, storyMessages, parseStory, unshape, pageMessages, nameWords,
         planFromWords, fixPagePlan, wordsOnlyPlan, coverPlan, drawAs } from "../web/book.mjs?v=9";
import { resolveStamp, parseSketch } from "../web/sketch.mjs?v=9";
import { composeScene } from "../web/scene.mjs?v=9";

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
  // The shape names pages, but only with what happens on them.
  assert.doesNotMatch(m.map(x => x.content).join(" "), /page \d+ text|\.\.\."|"text"/i);
});

test("the prompt gives every page its job, one line each", () => {
  assert.equal(SHAPE.length, PAGES);
  const user = storyMessages("a cat who wants to fly")[1].content;
  SHAPE.forEach((beat, i) => assert.ok(user.includes(`Page ${i + 1}: ${beat}.`), beat));
});

test("the shape copied into a page is taken back out", () => {
  // All four from Qwen3-0.6B stories written with the shape.
  assert.equal(unshape("Who the hero is and where they live. Lila lives in a small garden.", [{ name: "Lila" }]),
    "Lila lives in a small garden.");
  assert.equal(unshape("The Hero Tries, and It Does Not Work. The robot tries to find a friend.", [{ name: "Robot" }]),
    "The robot tries to find a friend.");
  assert.equal(unshape("The hero, Lucas, lives in the woods and is afraid of the dark.", [{ name: "Lucas" }]),
    "Lucas lives in the woods and is afraid of the dark.");
  assert.equal(unshape("The hero wants to see the sea, but the ocean is too far away.", [{ name: "Max" }]),
    "Max wants to see the sea, but the ocean is too far away.");
  assert.equal(unshape("First page: At home, the Dragon is by the fire.", []), "At home, the Dragon is by the fire.");
});

test("the story's own sentences are left alone", () => {
  // Short, or not made of the shape's words: story, not a label.
  assert.equal(unshape("A friend helps. Max smiles.", [{ name: "Max" }]), "A friend helps. Max smiles.");
  assert.equal(unshape("Pip tries again and it works. The kite flies!", [{ name: "Pip" }]),
    "Pip tries again and it works. The kite flies!");
  // "The Little Dog" is a name that starts with "the"; "the hero" stays rather than read "The Little Dog" mid-sentence.
  assert.equal(unshape("The hero finds the sea.", [{ name: "The Little Dog" }]), "The hero finds the sea.");
});

test("a page that is only the shape is not a page", () => {
  // Qwen3-0.6B, spot check: labels and story on alternate pages, the hero's name in the label.
  const lila = [{ name: "Lila", is: "dog" }];
  assert.equal(unshape("Who Lila Is and Where They Live", lila), "");
  assert.equal(unshape("Lila Tries, and It Doesn't Work", lila), "");
  assert.equal(unshape("What the hero wants, or the problem.", lila), "");
  // Title Case with a name, then story: the label goes, the story stays.
  assert.equal(unshape("Who Lila Is and Where They Live. Lila lives by the sea.", lila), "Lila lives by the sea.");
  // A real one-sentence page with a name is story.
  assert.equal(unshape("Lila tries again and it works.", lila), "Lila tries again and it works.");
  const s = parseStory(JSON.stringify({ title: "A Little Dog and the Sea", cast: lila, pages: [
    "Who Lila Is and Where They Live", "Lila lives in a small town and dreams of the sea.",
    "What Lila Wants or the Problem", "Lila wants to go to the sea, but she doesn't know how.",
    "Lila Tries, and It Doesn't Work", "Lila tries to swim, but she's scared."] }));
  assert.equal(s.pages.length, 3);
  assert.ok(s.truncated, "half a book says so");
});

test("what a character is does not stay in their name", () => {
  const s = parseStory(story(["The hero wants to grow a plant.", ...six.slice(1)], { cast: [{ name: "Lila (girl)", is: "girl" }] }));
  assert.equal(s.cast[0].name, "Lila");
  assert.equal(s.pages[0], "Lila wants to grow a plant.");
});

test("the shape asked as a question is taken out too", () => {
  // Qwen3-0.6B, captured for the Book-mode clips (scripts/demo-books/dog-phone.json).
  const charlie = [{ name: "Charlie", is: "dog" }, { name: "Sally", is: "girl" }];
  assert.equal(unshape("Who is Charlie and where do they live? They are a little dog named Charlie who lives in a small town.", charlie),
    "They are a little dog named Charlie who lives in a small town.");
  assert.equal(unshape("What does Charlie want, or the problem? Charlie wants to see the sea but is afraid of it.", charlie),
    "Charlie wants to see the sea but is afraid of it.");
  // A question a character really asks is story.
  assert.equal(unshape("Where is the sea? Charlie asked.", charlie), "Where is the sea? Charlie asked.");
  assert.equal(unshape("Will Sally help Charlie find the sea? She will try.", charlie), "Will Sally help Charlie find the sea? She will try.");
});

test("a parsed story comes back without the shape in it", () => {
  const s = parseStory(story(["Who the hero is and where they live. Pip lives by a wood.", ...six.slice(1)]));
  assert.equal(s.pages[0], "Pip lives by a wood.");
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
  // Qwen3-0.6B on the phone's prompt, verbatim: the pages numbered themselves.
  assert.equal(parseStory(story(["1. Luna and Milo start their journey to find the light.", ...six.slice(1)])).pages[0],
    "Luna and Milo start their journey to find the light.");
  assert.equal(parseStory(story(["3 little pigs went to town.", ...six.slice(1)])).pages[0], "3 little pigs went to town.");
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

// ---- from the first phone run: a picture with nothing in it ---------------------

test("a hero with no illustration is drawn as the nearest person, and the page says so", () => {
  const fay = { cast: [{ name: "Fay", is: "fairy" }, { name: "Grandma Rose", is: "grandma" }] };
  assert.equal(drawAs(fay.cast[0]), "girl");
  const r = fixPagePlan([], "Fay sat very still and listened to Grandma Rose.", fay);
  assert.deepEqual(r.entries.slice(0, 2), ["big girl front", "big girl front"]);
  assert.match(r.fixes.join(), /Fay drawn as a girl — there is no fairy picture/);
  assert.match(pageMessages(fay, "x")[0].content, /Fay is drawn as "girl"/);
  assert.equal(drawAs({ name: "Drop", is: "dew" }), null);
});

test("'fairy' is not a ferris wheel: a word extends a known one only by a suffix or a word", () => {
  assert.equal(resolveStamp("fairy"), null);
  assert.equal(resolveStamp("sailboats"), "sailboat");
  assert.equal(resolveStamp("boating"), "sailboat");
  assert.equal(resolveStamp("pinetree"), "tree-pine");
  // A compound is its last word: the scene prompt's harbour example says
  // "lighthouse", and it was drawn as a light bulb.
  assert.equal(resolveStamp("lighthouse"), "house");
  assert.equal(resolveStamp("starfish"), "fish");
});

test("rivers, lakes and roads in a page's words are drawn as its setting", () => {
  assert.deepEqual(planFromWords("A wide river is in the way.", pip), ["sea"]);
  assert.deepEqual(planFromWords("The ball floats on the lake.", pip), ["ball", "sea"]);
  assert.deepEqual(planFromWords("Pip runs down the road.", pip), ["road"]);
});

test("'grass' is grass, not a label reading 'gras' (Qwen3-1.7B book, page 1)", () => {
  const out = planFromWords("the smell of the grass", pip);
  assert.deepEqual(out, ["grass"]);
  assert.deepEqual(planFromWords("He drops a feather.", pip), [], "a verb drew a water droplet");
});

test("feelings are not drawn (Qwen3-0.6B pages drew a grinning face for 'happy')", () => {
  assert.deepEqual(planFromWords("Max feels happy. They love their friends and have fun in the world.", pip), []);
  assert.deepEqual(planFromWords("Pip ran home.", pip), ["home"], "a home is a place you can draw");
});

test("a page with nothing drawable is still a picture: its scenery", () => {
  const scene = composeScene({ t: "It was quiet.", c: wordsOnlyPlan("It was quiet.", { cast: [{ name: "Drop", is: "dew" }] }).entries });
  const raw = JSON.stringify({ t: "p", c: scene.c });
  assert.throws(() => parseSketch(raw), /expected format/, "a sketch of nothing but backdrop is still a failed sketch");
  assert.ok(parseSketch(raw, { scenery: true }).commands.length > 0);
});

test("castAsMe: the reader replaces the first person, or joins a story with none", async () => {
  const { castAsMe } = await import("../web/book.mjs?v=9");
  assert.deepEqual(castAsMe([{ name: "Lila", is: "girl" }, { name: "Spark", is: "dragon" }]),
    [{ name: "Lila", is: "me" }, { name: "Spark", is: "dragon" }]);
  // A witch is a person as far as the pictures go (her stand-in is a girl).
  assert.deepEqual(castAsMe([{ name: "Pip", is: "dog" }, { name: "Wanda", is: "witch" }]),
    [{ name: "Wanda", is: "me" }, { name: "Pip", is: "dog" }]);
  assert.deepEqual(castAsMe([{ name: "Pip", is: "dog" }], "Kate"), [{ name: "Kate", is: "me" }, { name: "Pip", is: "dog" }]);
  // Nobody else has the reader's drawing: "me" is a child wherever it is not registered.
  assert.equal(drawAs({ name: "Kate", is: "me" }), "child");
});
