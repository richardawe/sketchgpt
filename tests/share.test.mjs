// A book in a link, and a person's edits to it (web/share.mjs).
//
//   node --test tests/share.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { wordsOnlyPlan, coverPlan } from "../web/book.mjs";
import { encodeBook, decodeBook, cleanBook, changeCharacter, replaceName, thingsFrom, LIMITS, rewriteMessages, readRewrite } from "../web/share.mjs";

// A real Qwen3-1.7B book (scripts/demo-books/dog-shaped.json), shortened.
const BOOK = {
  title: "The Little Dog and the Sea",
  cast: [{ name: "Lucky", is: "dog" }, { name: "Mr. Gull", is: "bird" }],
  pages: [
    { text: "Lucky is a curious little dog living in a cozy little house by the woods.", things: ["big dog front", "house", "tree x3"] },
    { text: "Mr. Gull flies down and shows Lucky the way. Gull is kind.", things: ["big dog front", "bird x1"] },
    { text: "Lucky follows the light and finally reaches the sea. He swims in the water.", things: ["big dog front", "sea"] },
  ],
  cover: ["big dog front", "house", "tree x3"],
  voice: "Ava (Enhanced)",
};

test("a book survives the link exactly", async () => {
  const frag = await encodeBook(BOOK);
  assert.match(frag, /^book=z[A-Za-z0-9_-]+$/, "compressed, URL-safe, no padding");
  assert.deepEqual(await decodeBook("#" + frag), BOOK);
  assert.deepEqual(await decodeBook(frag), BOOK);
});

test("a six-page book fits in a message", async () => {
  const six = { ...BOOK, pages: Array.from({ length: 6 }, (_, i) => ({ ...BOOK.pages[i % 3] })) };
  const frag = await encodeBook(six);
  assert.ok(frag.length < 1500, `${frag.length} characters`);
});

test("without CompressionStream the link is plain, and still opens", async () => {
  const saved = globalThis.CompressionStream;
  globalThis.CompressionStream = undefined;
  try {
    const frag = await encodeBook(BOOK);
    assert.match(frag, /^book=j/);
    assert.deepEqual(await decodeBook(frag), BOOK);
  } finally { globalThis.CompressionStream = saved; }
});

test("a damaged, foreign or empty link says so rather than drawing nonsense", async () => {
  const frag = await encodeBook(BOOK);
  await assert.rejects(decodeBook("#" + frag.slice(0, frag.length / 2)), /damaged/);
  await assert.rejects(decodeBook("#page=2"), /does not hold a book/);
  await assert.rejects(decodeBook("#book=z!!!"), /does not hold a book/);
  const empty = "book=j" + Buffer.from(JSON.stringify({ v: 1, t: "x", p: [] })).toString("base64url");
  await assert.rejects(decodeBook(empty), /does not hold a book/);
  const future = "book=j" + Buffer.from(JSON.stringify({ v: 2 })).toString("base64url");
  await assert.rejects(decodeBook(future), /newer version/);
});

test("whatever a link says, the page gets strings of bounded size", () => {
  const wild = cleanBook({ title: 7, cast: [{ name: "<img src=x onerror=alert(1)>", is: "DOG" }, { name: "", is: "cat" }, 5],
    pages: [{ text: "x".repeat(5000), things: ["house", 3, "y".repeat(500), ...Array(50).fill("tree")] }, { text: "" }, null],
    cover: "house", voice: { a: 1 } });
  assert.equal(wild.title, "A story");
  assert.deepEqual(wild.cast, [{ name: "<img src=x onerror=alert(1)>", is: "dog" }], "kept as text; the page shows it as text");
  assert.equal(wild.pages.length, 1);
  assert.equal(wild.pages[0].text.length, LIMITS.text);
  assert.equal(wild.pages[0].things.length, LIMITS.things);
  assert.ok(wild.pages[0].things.every(t => typeof t === "string" && t.length <= LIMITS.thing));
  assert.deepEqual(wild.cover, []);
  assert.equal(wild.voice, "");
  assert.equal(cleanBook({ pages: Array(20).fill({ text: "a" }) }).pages.length, LIMITS.pages);
});

test("renaming a character reaches the title and every page, and nothing else", () => {
  const b = changeCharacter(BOOK, 0, { name: "Biscuit", is: "dog" });
  assert.equal(b.pages[0].text, "Biscuit is a curious little dog living in a cozy little house by the woods.");
  assert.equal(b.pages[1].text, "Mr. Gull flies down and shows Biscuit the way. Gull is kind.");
  assert.equal(b.cast[0].name, "Biscuit");
  assert.deepEqual(b.pages[0].things, BOOK.pages[0].things, "same kind of character, same picture");
  // A lone word of a longer name is them too.
  const g = changeCharacter(BOOK, 1, { name: "Mrs. Puffin", is: "bird" });
  assert.equal(g.pages[1].text, "Mrs. Puffin flies down and shows Lucky the way. Puffin is kind.");
  // Whole words only: "Luckyness" is not Lucky.
  assert.equal(replaceName("Lucky and Luckyness", "Lucky", "Pip"), "Pip and Luckyness");
});

test("changing what a character is redraws them on every page", () => {
  const b = changeCharacter(BOOK, 0, { name: "Lucky", is: "Cat" });
  assert.deepEqual(b.pages.map(p => p.things[0]), ["big cat front", "big cat front", "big cat front"]);
  assert.equal(b.cover[0], "big cat front");
  assert.equal(b.cast[0].is, "cat");
  assert.equal(b.pages[0].text, BOOK.pages[0].text, "the words are the person's to change");
});

test("a picture's list is edited one thing per line", () => {
  assert.deepEqual(thingsFrom("big dog front\n\n  sea \nboat, sun"), ["big dog front", "sea", "boat", "sun"]);
});

test("a rewrite is asked with the page's job and its neighbour, and read back as text", () => {
  const m = rewriteMessages(BOOK, 1, "Mr. Gull flies down.");
  assert.match(m[1].content, /page 2 of 3/);
  assert.match(m[1].content, /The page before says: "Lucky is a curious/);
  assert.match(m[1].content, /This page is for: what the hero wants/);
  assert.match(m[1].content, /Lucky \(dog\), Mr\. Gull \(bird\)/);
  assert.equal(readRewrite('{"text": "Mr. Gull swoops down."}'), "Mr. Gull swoops down.");
  assert.equal(readRewrite('</think>{"text": "He says \\"hi\\" and'), 'He says "hi" and', "cut off: keep what came");
  assert.equal(readRewrite("I cannot do that."), null);
});

test("what the page can rebuild is left out of the link, and rebuilt the same", async () => {
  // A phone's book: every picture comes from its page's words.
  const phone = { ...BOOK, pages: BOOK.pages.map(p => ({ text: p.text, things: wordsOnlyPlan(p.text, BOOK).entries })) };
  phone.cover = coverPlan(phone, phone.pages[0].things);
  const lean = await encodeBook(phone);
  const full = "book=j" + Buffer.from(JSON.stringify({ v: 1, t: phone.title, c: phone.cast.map(c => [c.name, c.is]),
    p: phone.pages.map(p => [p.text, p.things]), k: phone.cover, s: phone.voice })).toString("base64url");
  assert.deepEqual(await decodeBook(lean), phone);
  assert.deepEqual(await decodeBook(full), phone, "a link that spells everything out still opens");
  const bare = JSON.parse(Buffer.from((await encodeBookPlain(phone)).slice(6), "base64url").toString());
  assert.ok(bare.p.every(p => p.length === 1) && !("k" in bare), "lists and cover were not left out");
  // An edited list is the person's, and always travels.
  const edited = { ...phone, pages: [{ ...phone.pages[0], things: ["rocket"] }, ...phone.pages.slice(1)] };
  assert.deepEqual((await decodeBook(await encodeBook(edited))).pages[0].things, ["rocket"]);
  // An empty page in a link does not shift the pictures onto the wrong pages.
  const gap = "book=j" + Buffer.from(JSON.stringify({ v: 1, t: "x", c: [], p: [["   "], ["Pip swims."], ["Pip sleeps.", ["moon"]]] })).toString("base64url");
  assert.deepEqual((await decodeBook(gap)).pages.map(p => p.text), ["Pip swims.", "Pip sleeps."]);
  assert.deepEqual((await decodeBook(gap)).pages[1].things, ["moon"]);
});

async function encodeBookPlain(b) {
  const saved = globalThis.CompressionStream; globalThis.CompressionStream = undefined;
  try { return await encodeBook(b); } finally { globalThis.CompressionStream = saved; }
}
