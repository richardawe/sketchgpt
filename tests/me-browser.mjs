// "Star in a book": a photo drawn on selfie.html becomes the hero of the next
// book made on the main page — on a touch screen. Books are written by rules
// (web/story.mjs), so no model is involved at all.
//
//   PLAYWRIGHT_MODULE=... SKETCH_CHROME=... node tests/me-browser.mjs
//
// Holds the page to:
//   - only the drawing travels (after the "#", cleared from the address bar at
//     once), and only for this tab: a new tab has no hero;
//   - the builder starts with the reader as the hero, under their name, and
//     their figure is on the cover and on every page of the book;
//   - a shared book never shows the reader's face: "me" there is a stand-in;
//   - nothing goes anywhere but the site.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { serve } from "./serve.mjs";

const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => true;
export async function CreateMLCEngine() { return { interruptGenerate() {}, unload() {},
 chat: { completions: { async create(req) { window.requests.push(req);
  return (async function* () { yield { choices: [{ delta: { content: window.story } }] }; })(); } } } }; }`;
const STORY = JSON.stringify({ title: "Lila and the Egg", cast: [{ name: "Lila", is: "girl" }, { name: "Spark", is: "dragon" }],
  pages: ["Lila lived in a small house by the woods.", "One day Lila found a big egg under a tree.",
    "She tried to keep it warm, but it was too cold.", "Her friend Spark the dragon came to help.",
    "Spark breathed on the egg and it cracked open.", "Lila and Spark played in the garden until the sun set."] });

const server = await serve(new URL("../web/", import.meta.url).pathname);
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const outside = [], errors = [];
let lib = 0;
await context.route("**/*", r => {
  const u = r.request().url();
  if (/cdn\.jsdelivr\.net\/npm\/@mlc-ai\/web-llm/.test(u)) { lib++; return r.fulfill({ contentType: "text/javascript", body: stub }); }
  if (!u.startsWith(server.url) && !/^(data|blob):/.test(u)) { outside.push(u); return r.abort(); }
  return r.continue();
});
await context.addInitScript(story => {
  Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => ({ features: new Set(["shader-f16"]), limits: { maxBufferSize: 1e9 } }) } });
  if (navigator.storage) navigator.storage.estimate = async () => ({ quota: 50e9, usage: 0 });
  window.requests = []; window.story = story;
}, STORY);
const page = await context.newPage();
page.on("pageerror", e => errors.push(e.message));

// 1. Draw a photo, name the hero, star.
await page.goto(server.url + "selfie.html");
await page.setInputFiles("#file", new URL("./fixtures/face-rubins.jpg", import.meta.url).pathname);
await page.waitForSelector("#stage svg", { timeout: 120000 });
await page.fill("#name", "Kate");
await page.tap("#star");
await page.waitForURL(u => !u.pathname.endsWith("selfie.html"));
await page.waitForFunction(() => !location.hash);
assert.ok(await page.evaluate(() => sessionStorage.getItem("sketchgpt.me")), "the drawing is kept for this tab");
assert.equal(await page.evaluate(() => location.hash), "", "the drawing is cleared from the address bar");

// 2. The builder says who the hero is, and starts with them.
await page.waitForSelector("#intro .me-note .me-thumb svg", { timeout: 60000 });
assert.match(await page.textContent("#intro .me-note"), /hero of your next book, as Kate/);
assert.equal(await page.getAttribute("#kinds [aria-pressed=true]", "data-value"), "me");
assert.equal(await page.inputValue("#hero-name"), "Kate");

// 3. Make a book: Kate on every page, in words and as her drawing.
await page.tap("#write");
await page.waitForFunction(() => document.querySelectorAll(".book .art svg").length >= 7, null, { timeout: 60000 });
const words = await page.$$eval(".book .page-text", ps => ps.slice(0, 6).map(p => p.textContent));
assert.ok(words.every(t => /\bKate\b/.test(t)), words.join(" | "));
assert.equal(lib, 0, "a book fetched the model library");
const arts = await page.$$eval(".book .art", as => as.map(a => !!a.querySelector('[data-thing="me"][data-figure] [data-part="head"]')));
assert.equal(arts.length, 7);
assert.ok(arts.every(Boolean), `the reader is on every page and the cover: ${arts}`);
assert.equal(await page.$$eval('.book .art [data-thing="girl"]', n => n.length), 0, "the stand-in girl is replaced, not doubled");
// The figure blinks now and then.
await page.waitForFunction(() => [...document.querySelectorAll('[data-figure] [data-part="eye-right"] > [data-state="closed"]')]
  .some(g => g.style.display !== "none"), null, { timeout: 10000 });
if (process.env.DEBUG) console.log(JSON.stringify(await page.$$eval(".book .art", as => as.slice(0, 3).map(a => [...a.querySelectorAll("[data-thing]")].map(g => { const b = g.getBoundingClientRect(); const cs = getComputedStyle(g);
  return [g.getAttribute("data-thing"), g.getAttribute("transform")?.slice(0, 60), Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), cs.opacity, cs.visibility, g.style.cssText.slice(0, 80)]; })))));
// SHOT=<dir> saves the cover and two pages, to look at.
if (process.env.SHOT) for (const i of [0, 2, 5]) {
  const sheet = page.locator(".book .sheet").nth(i);
  await sheet.scrollIntoViewIfNeeded(); await page.waitForTimeout(2500);   // things pop in one by one
  await sheet.screenshot({ path: `${process.env.SHOT}/book-${i}.png` });
}

// 4. A new tab has no hero.
const other = await context.newPage();
await other.goto(server.url);
await other.waitForSelector("#intro .me-note", { timeout: 60000 });
assert.match(await other.textContent("#intro .me-note"), /Use a photo of me/);
assert.equal(await other.locator('#kinds [data-value="me"]').count(), 0, "a new tab offered a drawing it does not have");
assert.equal(await other.evaluate(() => sessionStorage.getItem("sketchgpt.me")), null);

// 5. A shared book with "me" in it, opened in the tab that has a hero: a stand-in.
const link = await page.evaluate(async story => {
  const s = await import("./share.mjs?v=11");
  const b = JSON.parse(story);
  return s.encodeBook({ title: b.title, cast: [{ name: "Kate", is: "me" }, { name: "Spark", is: "dragon" }],
    pages: b.pages.map(text => ({ text, things: ["big me front", "tree"] })), cover: ["big me front"], voice: "" });
}, STORY);
await page.goto(server.url + "browser.html#" + link);   // a real load, not just a hash change
await page.waitForFunction(() => document.querySelectorAll(".book").length === 1);
await page.waitForFunction(() => document.querySelectorAll(".book .art svg").length >= 7, null, { timeout: 60000 });
assert.equal(await page.$$eval('.book [data-figure]', n => n.length), 0, "a shared book showed the reader's face");
assert.ok(await page.$$eval('.book .art [data-thing="child"]', n => n.length) >= 6, "the stand-in is drawn instead");

assert.deepEqual(outside, [], "requests outside the site");
assert.deepEqual(errors, [], "page errors");
console.log("me-browser: ok — the drawing travels only in this tab, the builder starts with Kate, she is on every page with no model, a shared book shows a stand-in");
await browser.close(); server.close();
