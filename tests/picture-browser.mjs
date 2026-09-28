// Your own picture as the hero — a drawing, and a photo cut out — in the real
// page, on a touch screen, with no model and nothing leaving the site.
//
//   PLAYWRIGHT_MODULE=... SKETCH_CHROME=... node tests/picture-browser.mjs
//
// Holds the page to: the picture is drawn on every page and the cover in
// place of the hero's illustration; a drawing loses its paper; a photo's
// person is cut out; the book asks what the picture is before writing; the
// share link never carries the picture, and whoever opens it sees the drawn
// hero; nothing is requested outside the site.
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { serve } from "./serve.mjs";

const server = await serve(new URL("../web/", import.meta.url).pathname);
const browser = await launch();
const dir = await mkdtemp(join(tmpdir(), "pic-"));
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const outside = [], errors = [];
const open = async () => {
  const context = await browser.newContext(phone);
  await context.route("**/*", r => {
    const u = r.request().url();
    if (!u.startsWith(server.url) && !/^(data|blob):/.test(u)) { outside.push(u); return r.abort(); }
    return r.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  return { context, page };
};

try {
  // A child's drawing: a black cat-ish outline on cream paper, made here.
  const { context, page } = await open();
  await page.goto(server.url + "browser.html?seed=3");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 300; c.height = 240;
    const x = c.getContext("2d");
    x.fillStyle = "#f7f3e8"; x.fillRect(0, 0, 300, 240);
    x.fillStyle = "#e8a33d"; x.strokeStyle = "#222"; x.lineWidth = 8;
    x.beginPath(); x.ellipse(150, 140, 70, 60, 0, 0, 7); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(95, 100); x.lineTo(105, 50); x.lineTo(130, 88); x.moveTo(170, 88); x.lineTo(195, 50); x.lineTo(205, 100); x.stroke();
    return c.toDataURL("image/png").split(",")[1];
  });
  const file = join(dir, "drawing.png");
  await writeFile(file, Buffer.from(png, "base64"));
  await page.setInputFiles("#pic-file", file);
  await page.waitForSelector(".me-note .pic-thumb");
  assert.equal(await page.getAttribute('#pic-how [aria-pressed="true"]', "data-value"), "paper", "a drawing on paper was not seen as one");
  // The paper is gone: the picture's corner is transparent.
  const corner = await page.evaluate(async () => {
    const img = document.querySelector(".pic-thumb"); await img.decode();
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, 1, 1).data[3];
  });
  assert.equal(corner, 0, "the paper was not taken away");

  // Writing without saying what it is: the page asks.
  await page.tap('#places [data-value="garden"]');
  await page.tap("#write");
  assert.match(await page.textContent(".me-note .ask"), /What is your picture/);
  assert.equal(await page.locator(".book").count(), 0);

  // A cat: the picture is the hero on every page and the cover.
  await page.tap('#kinds [data-value="cat"]');
  await page.fill("#hero-name", "Tigger");
  await page.tap("#write");
  await page.waitForFunction(() => document.querySelector(".book .book-actions") && !document.querySelector("#write").disabled, null, { timeout: 30000 });
  const arts = await page.$$eval(".book .art", as => as.map(a => !!a.querySelector('[data-figure] image')));
  assert.equal(arts.length, 7);
  assert.ok(arts.every(Boolean), `the picture is not on every page: ${arts}`);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("sketchgpt.pic") !== null), true, "kept for this tab");
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("data:image")), false, "the picture was stored for good");

  // Share: the link has no picture in it, and says so.
  await page.evaluate(() => { navigator.share = async d => { window.shared = d; }; });
  await page.tap(".book .share");
  await page.waitForFunction(() => window.shared);
  const link = await page.evaluate(() => window.shared.url);
  assert.ok(link.length < 4000, `the link is ${link.length} characters: is the picture in it?`);
  assert.match(await page.textContent(".book .share-note"), /Your picture stays on this device: they see a drawn cat/);

  // Someone else opens it: the drawn cat, not the picture.
  const other = await open();
  await other.page.goto(link);
  await other.page.waitForFunction(() => document.querySelectorAll(".book .art svg").length === 7, null, { timeout: 30000 });
  assert.equal(await other.page.locator(".book [data-figure]").count(), 0, "the picture travelled in the link");
  assert.ok(await other.page.locator('.book .art [data-thing="cat"]').count() >= 6, "the drawn cat is not there instead");
  await other.context.close();

  // A photo: the person is cut out, and is a child unless the reader says otherwise.
  await page.tap(".me-note button");                          // Not this picture
  await page.tap('#kinds [data-value=""]');
  await page.setInputFiles("#pic-file", new URL("./fixtures/face-rubins.jpg", import.meta.url).pathname);
  await page.waitForSelector(".me-note .pic-thumb");
  assert.equal(await page.getAttribute('#pic-how [aria-pressed="true"]', "data-value"), "keep", "a photo is kept as it is at first");
  await page.tap('#pic-how [data-value="person"]');
  await page.waitForFunction(() => document.querySelector('#pic-how [aria-pressed="true"]')?.dataset.value === "person", null, { timeout: 120000 });
  assert.equal(await page.getAttribute('#kinds [aria-pressed="true"]', "data-value"), "child");
  const cut = await page.evaluate(async () => {
    const img = document.querySelector(".pic-thumb"); await img.decode();
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let clear = 0; for (let i = 3; i < d.length; i += 4) if (d[i] === 0) clear++;
    return clear / (d.length / 4);
  });
  assert.ok(cut > 0.05, `nothing was cut away (${cut})`);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

  assert.deepEqual(outside, [], "requests outside the site");
  assert.deepEqual(errors, [], "page errors");
  await context.close();
  console.log("picture-browser: ok — a drawing loses its paper and is the hero on every page, the page asks what a picture " +
    "is, the link never carries it, a photo's person is cut out, nothing leaves the site");
} finally { await browser.close(); server.close(); }
