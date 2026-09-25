// A story written by rules (web/story.mjs): what it promises, checked for
// every hero, every place and every wish that fits them.
//
//   node --test tests/story.test.mjs
//
// A model's story could only be read and scored; a rule's story can be
// checked. Each test here is a promise the model could not keep: the picture
// shows what the words say and nothing else, the help makes sense, and the
// animation acts out what happens and not what is only wished for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeStory, wishesFor, KINDS, PLACES, WISHES, HELPERS } from "../web/story.mjs";
import { planFromWords, wordsOnlyPlan, nameWords, PAGES } from "../web/book.mjs?v=9";
import { pageActions } from "../web/animate.mjs";
import { encodeBook, decodeBook, LIMITS } from "../web/share.mjs";

const SEEDS = 12;
const every = [];
for (const kind of Object.keys(KINDS)) for (const place of Object.keys(PLACES))
  for (const wish of wishesFor(kind, place)) for (let seed = 0; seed < SEEDS; seed++)
    every.push(writeStory({ kind, place, wish, seed, name: kind === "me" ? "Kate" : "" }));
const show = (s, i) => `${s.title} (${JSON.stringify(s.choices)}) page ${i + 1}: ${s.pages[i]}`;

test("every hero has stories in every place", () => {
  for (const kind of Object.keys(KINDS)) for (const place of Object.keys(PLACES))
    assert.ok(wishesFor(kind, place).length >= 2, `${kind} in ${place}`);
  assert.ok(every.length > 5000, `${every.length} books checked`);
});

test("six pages, each short enough for a share link, the hero named on every one", () => {
  for (const s of every) {
    assert.equal(s.pages.length, PAGES);
    assert.ok(s.title && s.title.length <= LIMITS.title, s.title);
    const hero = new RegExp("\\b" + s.cast[0].name + "\\b");
    s.pages.forEach((t, i) => {
      assert.ok(t.length <= LIMITS.text, show(s, i));
      assert.match(t, hero, show(s, i));
      assert.doesNotMatch(t, /[{}[\]]/, "a placeholder or a mark left in: " + show(s, i));
    });
  }
});

test("the picture shows exactly the things the words mark — nothing drawn by accident", () => {
  // "lighthouse" was drawn as a light bulb, "waves at the others" as a sea,
  // "one night" as a moon on a page set in the daytime. Every drawable word
  // in a template is [marked]; the page must draw those and only those.
  const sorted = a => [...a].sort().join(" | ");
  for (const s of every) s.pages.forEach((t, i) => {
    assert.equal(sorted(planFromWords(t, s)), sorted(planFromWords(s.drawn[i].join(" "), s)), show(s, i));
  });
});

test("every marked word has a picture", () => {
  const words = new Set(every.flatMap(s => s.drawn.flat()));
  for (const w of words) assert.ok(planFromWords(`There is a ${w}.`, { cast: [] }).length, `"${w}" draws nothing`);
});

test("no picture is the hero alone", () => {
  for (const s of every) s.pages.forEach((t, i) => {
    const hero = `big ${s.cast[0].is === "me" ? "me" : s.cast[0].is} front`;
    const others = wordsOnlyPlan(t, s).entries.filter(e => e !== hero);
    assert.ok(others.length, "a picture of only the hero: " + show(s, i));
  });
});

test("the help makes sense: the helper can do what the problem needs, and the hero cannot", () => {
  for (const s of every) {
    const { kind, wish, helper, problem } = s.choices;
    const p = WISHES[wish].problems[problem];
    assert.notEqual(helper, kind, "the hero helping themself");
    assert.ok(PLACES[s.choices.place].helpers.includes(helper), `${helper} does not live in ${s.choices.place}`);
    if (p.need.length) assert.ok(p.need.some(n => HELPERS[helper].includes(n)), `${helper} cannot ${p.need}`);
    const own = KINDS[kind].can;
    assert.ok(!(p.stops || p.need).some(n => own.includes(n)), `a ${kind} is not stuck by that: ${show(s, 2)}`);
  }
  // Heroes who fly never wish to; a river does not stop a swimmer.
  assert.ok(!wishesFor("dragon", "forest").includes("fly"));
  for (let seed = 0; seed < 40; seed++)
    assert.doesNotMatch(writeStory({ kind: "dog", place: "farm", wish: "sea", seed }).pages[2], /river/);
});

test("the animation acts out deeds, never wishes", () => {
  for (const s of every) {
    const hero = s.cast[0];
    const acts = s.pages.map(t => pageActions(t, s.cast).get(hero) || []);
    assert.deepEqual(acts[1], [], "the wish acted out: " + show(s, 1));
    assert.ok(acts[2].length, "the hero is still when trying: " + show(s, 2));
    assert.ok(acts[4].length, "the hero is still when it works: " + show(s, 4));
  }
});

test("the helper is a character: named, drawn and acted as itself", () => {
  const s = writeStory({ kind: "cat", place: "forest", wish: "lost", seed: 3 });
  const [hero, helper] = s.cast;
  assert.equal(helper.name.toLowerCase(), helper.is);
  assert.deepEqual(nameWords(helper.name), [helper.is]);
  // Page four: the helper arrives, and it is the helper that moves.
  const acts = pageActions(s.pages[3], s.cast);
  assert.ok(!acts.get(hero), s.pages[3]);
  assert.match(wordsOnlyPlan(s.pages[3], s).entries.join(), new RegExp(`big ${helper.is} front`));
});

test("the same choices and seed give the same book; another seed, another version", () => {
  const a = { kind: "dog", name: "Pip", place: "farm", wish: "sea", seed: 7 };
  assert.deepEqual(writeStory(a), writeStory(a));
  const versions = new Set(Array.from({ length: 40 }, (_, seed) => writeStory({ ...a, seed }).pages.join("\n")));
  assert.ok(versions.size >= 8, `only ${versions.size} versions of one story`);
});

test("choices are honoured when they fit, and replaced when they do not", () => {
  const s = writeStory({ kind: "rabbit", name: "  Clover   Bun ", place: "garden", wish: "grow", seed: 1 });
  assert.deepEqual([s.choices.kind, s.choices.place, s.choices.wish, s.cast[0].name], ["rabbit", "garden", "grow", "Clover Bun"]);
  // A dragon can already fly; the seaside has no sea to go and see.
  assert.notEqual(writeStory({ kind: "dragon", wish: "fly", place: "castle", seed: 1 }).choices.wish, "fly");
  assert.notEqual(writeStory({ kind: "dog", wish: "sea", place: "beach", seed: 1 }).choices.wish, "sea");
  const any = writeStory({ seed: 5 });
  assert.ok(KINDS[any.choices.kind] && PLACES[any.choices.place] && any.pages.length === PAGES);
  assert.notEqual(any.choices.kind, "me", "the reader is never picked for them");
});

test("the reader's own drawing is never written as a kind", () => {
  for (const s of every.filter(s => s.choices.kind === "me")) {
    assert.equal(s.cast[0].is, "me");
    assert.doesNotMatch(s.pages[0], /^Kate is a /, s.pages[0]);
  }
});

test("a rule-written book survives a share link", async () => {
  const s = writeStory({ kind: "fox", place: "snow", wish: "dark", seed: 2 });
  const book = { title: s.title, cast: s.cast, voice: "",
    pages: s.pages.map(text => ({ text, things: wordsOnlyPlan(text, s).entries })) };
  book.cover = [];
  const back = await decodeBook(await encodeBook(book));
  assert.deepEqual(back.pages.map(p => p.text), s.pages);
  assert.deepEqual(back.cast, s.cast);
});
