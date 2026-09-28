// Selfie mode in a real browser, on a touch screen: a photo in, a moving
// caricature out, a GIF made — and the photo never leaves the tab.
//
//   PLAYWRIGHT_MODULE=... SKETCH_CHROME=... node tests/selfie-browser.mjs
//
// What it holds the page to (docs/selfie.md):
//   - no request goes anywhere but the page's own site, and nothing is POSTed;
//     a blocked attempt (a CSP violation) counts as a failure too, so the
//     Content-Security-Policy cannot hide a page that tries;
//   - nothing lands in localStorage, sessionStorage or IndexedDB, and no cached
//     response is an image;
//   - the photo is off the screen once the drawing is made;
//   - the drawing moves, and the GIF is a real, looping GIF;
//   - a photo with no face says so, and keeps the photo on screen.
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { launch } from "./browser.mjs";
import { serve } from "./serve.mjs";

const server = await serve(new URL("../web/", import.meta.url).pathname);
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const outside = [], posts = [], errors = [];
page.on("request", r => {
  if (!r.url().startsWith(server.url) && !/^(data|blob):/.test(r.url())) outside.push(r.url());
  if (r.method() !== "GET") posts.push(`${r.method()} ${r.url()}`);
});
page.on("pageerror", e => errors.push(e.message));
await page.addInitScript(() => {
  window.__violations = [];
  document.addEventListener("securitypolicyviolation", e => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
});
await page.goto(server.url + "selfie.html");

// 1. A face
await page.setInputFiles("#file", new URL("./fixtures/face-rubins.jpg", import.meta.url).pathname);
await page.waitForFunction(() => document.querySelector("#stage svg") || getComputedStyle(document.querySelector("#errbox")).display !== "none", null, { timeout: 120000 });
assert.ok(await page.$("#stage svg"), "a portrait is drawn: " + await page.$eval("#report", e => e.textContent));
assert.equal(await page.$eval("#photo", e => e.getAttribute("src")), null, "the photo is off the screen once drawn");
assert.equal(await page.$eval("#photo", e => getComputedStyle(e).display), "none");
const report = await page.evaluate(() => window.__selfie.report);
assert.equal(report.faces, 1);

// It moves: the head sways continuously, so two moments differ.
const t1 = await page.$eval('[data-part="head"]', g => g.getAttribute("transform"));
await page.waitForTimeout(400);
const t2 = await page.$eval('[data-part="head"]', g => g.getAttribute("transform"));
assert.notEqual(t1, t2, "the drawing moves");
// And it blinks within a few seconds.
await page.waitForFunction(() => [...document.querySelectorAll('[data-part="eye-right"] > [data-state]')]
  .some(g => g.getAttribute("data-state") !== "open" && g.style.display !== "none"), null, { timeout: 8000 });

// The slider redraws; the page never overrides it.
await page.$eval("#amount", el => { el.value = "2"; el.dispatchEvent(new Event("change")); });
assert.equal(await page.$eval("#amount", el => el.value), "2");

// 2. A GIF: header, a loop, and one image per frame.
const gif = await page.evaluate(async () => {
  const blob = await window.__selfie.makeGif({ width: 120, frames: 6 });
  return { type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
});
const bytes = Buffer.from(gif.bytes);
assert.equal(gif.type, "image/gif");
assert.equal(bytes.subarray(0, 6).toString(), "GIF89a");
assert.ok(bytes.includes(Buffer.from("NETSCAPE2.0")), "it loops");
let frames = 0;
for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
assert.equal(frames, 6, "one frame per pose");

// 3. Nothing stored, nothing sent.
const stored = await page.evaluate(async () => {
  const dbs = indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : [];
  const images = [];
  for (const key of await caches.keys()) {
    const c = await caches.open(key);
    for (const req of await c.keys()) {
      const res = await c.match(req);
      if (/^image\//.test(res.headers.get("content-type") || "")) images.push(req.url);
    }
  }
  return { local: localStorage.length, session: sessionStorage.length, dbs, images };
});
assert.deepEqual(stored, { local: 0, session: 0, dbs: [], images: [] }, "nothing stored");

// 4. Forget
await page.tap("#forget");
assert.equal(await page.$("#stage svg"), null);
assert.equal(await page.evaluate(() => window.__selfie.data), null);

// 5. No face: a plain grey picture.
const png = (w, h) => {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]); const o = Buffer.alloc(12 + d.length);
    o.writeUInt32BE(d.length, 0); b.copy(o, 4); o.writeUInt32BE(crc(b), 8 + d.length); return o; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 128); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
await page.setInputFiles("#file", { name: "wall.png", mimeType: "image/png", buffer: png(200, 200) });
await page.waitForFunction(() => getComputedStyle(document.querySelector("#errbox")).display !== "none", null, { timeout: 60000 });
assert.match(await page.$eval("#errmsg", e => e.textContent), /No face found/);
assert.notEqual(await page.$eval("#photo", e => getComputedStyle(e).display), "none", "the photo stays, so the person can see why");

const violations = await page.evaluate(() => window.__violations);
assert.deepEqual(outside, [], "requests outside the site");
assert.deepEqual(posts, [], "requests that send something");
assert.deepEqual(violations, [], "blocked attempts to connect elsewhere");
assert.deepEqual(errors, [], "page errors");
console.log(`selfie-browser: ok (face found in ${report.totalMs} ms, GIF ${bytes.length} bytes)`);
await browser.close(); server.close();
