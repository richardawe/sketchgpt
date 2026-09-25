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

// ---- A story the person writes (stage 3) ---------------------------------------

import { splitPages, guessHero, storyFromText, checkPages, OWN } from "../web/story.mjs";

const MAX = `Max and the Big Snow

Max was a little dog who lived in a small house by the woods.

One morning, snow covered everything. Max had never seen snow.

He ran outside and jumped in it. It was cold!

A robin called Rosie showed him how to slide down the hill.

They played until the sun went down, then Max went home to his warm bed.`;

test("paragraphs are pages, and a short first line is the title", () => {
  const s = splitPages(MAX);
  assert.equal(s.title, "Max and the Big Snow");
  assert.equal(s.pages.length, 5);
  assert.equal(s.pages[2], "He ran outside and jumped in it. It was cold!");
  assert.deepEqual(s.notes, []);
});

test("the person's words are kept exactly: only split, never changed", () => {
  const s = splitPages(MAX);
  const words = t => t.replace(/\s+/g, " ").trim();
  assert.equal(words([s.title, ...s.pages].join(" ")), words(MAX));
});

test("one block of text is grouped into about six pages, at sentence ends", () => {
  const blob = "Once there was a cat named Luna. Luna lived in a tall tower. " +
    Array.from({ length: 14 }, (_, i) => `She watched bird number ${i + 1}.`).join(" ") + " The end.";
  const s = splitPages(blob);
  assert.ok(s.pages.length >= 5 && s.pages.length <= 7, `${s.pages.length} pages`);
  assert.ok(s.pages.every(p => /[.!?]$/.test(p)), "a page ended mid-sentence");
  assert.equal(s.title, "", "a sentence is not a title");
});

test("lines without blank lines between them are still paragraphs", () => {
  assert.equal(splitPages("Pip woke up.\nPip ate breakfast.\nPip went to the sea.").pages.length, 3);
});

test("too much for a book: eight pages kept, and said", () => {
  // Twelve short paragraphs fit a book when grouped: nothing is lost.
  const many = Array.from({ length: 12 }, (_, i) => `Page ${i + 1} is here.`).join("\n\n");
  const m = splitPages(many);
  assert.ok(m.pages.length <= OWN.pages);
  assert.equal(m.pages.join(" "), Array.from({ length: 12 }, (_, i) => `Page ${i + 1} is here.`).join(" "));
  assert.deepEqual(m.notes, []);
  // Thirty long ones do not: the first eight pages, and the book says so.
  const long = Array.from({ length: 30 }, (_, i) => `Part ${i + 1}. ` + "The dog ran on and on. ".repeat(12)).join("\n\n");
  const s = splitPages(long);
  assert.equal(s.pages.length, OWN.pages);
  assert.match(s.notes.join(), /first 8 pages/);
  const huge = "word ".repeat(400) + ".";
  const h = splitPages(huge);
  assert.ok(h.pages.every(p => p.length <= OWN.text), "a page over the share limit");
  assert.match(h.notes.join(), /longer than a page/);
});

test("the hero is found when the story says it plainly, and it is the one named most", () => {
  assert.deepEqual(guessHero(MAX), { name: "Max", kind: "dog" }, "a robin called Rosie is not the hero of Max's story");
  assert.deepEqual(guessHero("The dragon called Ember slept."), { name: "Ember", kind: "dragon" });
  assert.deepEqual(guessHero("Ellie, the elephant, was sad."), { name: "Ellie", kind: "elephant" });
  assert.deepEqual(guessHero("Zoe likes cake. Zoe is kind."), { name: "Zoe", kind: null }, "a name alone, when that is all");
  assert.equal(guessHero("Once upon a time. Then it rained. It was sad."), null, "sentence starters are not names");
  // A kind with no picture is not guessed: the person is asked instead.
  assert.deepEqual(guessHero("Lulu was a little llama. Lulu ran."), { name: "Lulu", kind: null });
});

test("the guide says what each page draws, and which pages draw nothing", () => {
  const story = storyFromText(MAX, guessHero(MAX));
  const c = checkPages(story);
  assert.deepEqual(c.map(x => x.nothing), [false, false, true, false, false]);
  assert.ok(c[3].draws.includes("robin") && c[3].draws.includes("hill"), c[3].draws.join());
  assert.deepEqual(c.map(x => x.heroNamed), [true, true, false, false, true]);
  assert.ok(!c[0].draws.includes("dog"), "the hero is drawn as the hero, not listed as a thing");
});

test("a person's book fits a share link, whoever the hero is", async () => {
  for (const hero of [{ name: "Max", kind: "dog" }, { name: "Kate", kind: "me" }, { name: "Lulu", kind: "llama" }, {}]) {
    const s = storyFromText(MAX, hero);
    const book = { title: s.title, cast: s.cast, voice: "", cover: [],
      pages: s.pages.map(text => ({ text, things: wordsOnlyPlan(text, s).entries })) };
    const back = await decodeBook(await encodeBook(book));
    assert.deepEqual(back.pages.map(p => p.text), s.pages);
    assert.deepEqual(back.cast, s.cast);
  }
  assert.match(storyFromText(MAX, { name: "Lulu", kind: "llama" }).notes.join(), /no llama picture/);
});
