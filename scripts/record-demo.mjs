// Records short clips of Book and Sketch mode, one per thing you might want
// to say about them.
//
// No video framework needed: Playwright records the page natively, and one
// ffmpeg call turns each recording into an mp4 and a gif.
//
//   node scripts/record-demo.mjs                 # every clip
//   node scripts/record-demo.mjs offline svg     # just those
//   node scripts/record-demo.mjs --out /tmp
//
// Clips:
//   book        an idea in, a six-page picture book out (desktop, Qwen3-1.7B)
//   bookphone   the same on a phone (Qwen3-0.6B, pictures from each page's words)
//   bookprivate a book written with the network cut
//   bookmade    "How this picture was made", then the print view
//   intro    type a request, get a drawing            — "no app, no account"
//   private  the same, with the network truly cut     — "nothing leaves your phone"
//   offline  reload with no network at all, then draw — "aeroplane mode"
//   svg      draw, then download the SVG              — "drop it into a worksheet"
//   charm    three sketches in a row                  — "it draws like a five-year-old"
//   edit     change the numbers, press Redraw         — "a picture is a few shapes"
//
// HONESTY, two parts, and both matter if you post these.
//
// 1. Every drawing is real output from a real model, lifted verbatim from
//    scripts/sketch-bench.mjs, and every book is a real model's story and
//    page plans, captured by scripts/capture-book.mjs into scripts/demo-books/.
//    None of it was written or drawn by hand for the camera.
// 2. The waiting is NOT real. A stub engine stands in for WebLLM so the
//    recording is deterministic, so a clip shows what the model produced and
//    never how long it took. Measured, if you need it: Qwen3-1.7B took 4.0s
//    for the boat scene on four CPUs, and a phone on WebGPU is another number
//    again.
//
// The offline clips are genuinely offline — the browser is put in offline mode
// and the local server is answering nothing — because that is a claim worth
// being able to defend. They carry a burnt-in caption saying so.
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const FFMPEG = process.env.FFMPEG || "ffmpeg";
const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = (outAt === -1 ? "." : args[outAt + 1]).replace(/\/$/, "");
const wanted = args.filter((a, i) => !a.startsWith("--") && i !== outAt + 1);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

// Real drawings, verbatim from the bench.
const BOAT = { t: "A boat and two birds", c: [
  "sun 82 14 16", "sailboat 48 60 30", "line 5 78 95 78",
  "bird 28 26 10", "bird 44 20 10"] };
const HOUSE = { t: "A red house with a green tree", c: [
  "house 25 55 40 red", "tree 75 55 34 green", "sun 82 14 16 yellow",
  "line 5 82 95 82"] };
const CAT = { t: "A cat", c: ["cat 50 52 34", "line 5 82 95 82"] };
const PLAIN = { t: "A house with a tree", c: ["house 30 60 30", "tree 72 60 28"] };
const PARTY = { t: "A house with a tree and a car", c: [
  "house 50 50 30", "tree-deciduous 50 52 30", "car 50 54 30"] };

// A real service worker needs a real origin: page.route() interception
// disables it, which is exactly the thing the offline clips are showing.
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript" };
// Replies come from window.results in order when it is set (a book is one
// story then one plan per page), else window.result. A long reply streams in
// pieces so the page's own progress line moves as it does live — at a pace
// chosen for the camera, not measured.
const MOCK = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return { interruptGenerate() {},
 chat: { completions: { async create() {
 const out = window.results && window.results.length ? window.results.shift() : window.result;
 return (async function* () {
 await new Promise(r => setTimeout(r, 420));
 const n = out.length > 400 ? 36 : 1;
 for (let i = 0; i < n; i++) {
   await new Promise(r => setTimeout(r, n > 1 ? 55 : 0));
   yield { choices: [{ delta: { content: out.slice(Math.floor(i * out.length / n), Math.floor((i + 1) * out.length / n)) } }] };
 } })(); } } } }; }`;
const BOOK = name => {
  const b = JSON.parse(readFileSync(new URL(`./demo-books/${name}.json`, import.meta.url), "utf8"));
  return { premise: b.premise, results: [b.story, ...b.plans] };
};
const server = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  const name = path === "/" || path === "/browser.html" ? "browser.html" : path.slice(1);
  if (name === "mock.mjs") {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "max-age=600" });
    return res.end(MOCK);
  }
  try {
    const body = await readFile(new URL("../web/" + name, import.meta.url));
    res.writeHead(200, { "content-type": TYPES[name.slice(name.lastIndexOf("."))] || "application/octet-stream",
      "cache-control": "max-age=600" });
    res.end(body);
  } catch { res.writeHead(404); res.end("no"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const type = (page, text) =>
  page.locator("#input").pressSequentially(text, { delay: 34 });
const ask = async (page, text, drawing) => {
  await page.evaluate(d => { window.result = JSON.stringify(d); }, drawing);
  await type(page, text);
  await page.waitForTimeout(220);
  await page.click("#send");
  await page.waitForFunction(() => !document.querySelector("#send").disabled);
  await page.evaluate(() => document.querySelector("#log").scrollTo(0, 1e6));
};
// Write a book, then turn its pages: scroll the log a sheet at a time.
const writeBook = async (page, book) => {
  await page.evaluate(r => { window.results = r; }, book.results);
  await type(page, book.premise);
  await page.waitForTimeout(250);
  await page.click("#send");
  await page.waitForFunction(() => document.querySelector(".book .sheet"), { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector("#send").disabled, { timeout: 60000 });
};
const turnPages = async (page, pause = 1300) => {
  const sheets = await page.locator(".book .sheet").count();
  for (let i = 0; i < sheets; i++) {
    await page.locator(".book .sheet").nth(i).evaluate(s => s.scrollIntoView({ behavior: "smooth", block: "start" }));
    await page.waitForTimeout(pause);
  }
};
const settled = async page => {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 20000 });
};

const CLIPS = {
  book: { caption: null, mode: "book", size: { width: 600, height: 820 }, async run(page) {
    await writeBook(page, BOOK("dog"));
    await turnPages(page);
  } },

  bookphone: { caption: null, mode: "book", mobile: true, size: { width: 390, height: 760 }, async run(page) {
    await writeBook(page, BOOK("dragon"));
    await turnPages(page, 1200);
  } },

  bookprivate: { caption: "network off — nothing is being sent anywhere", mode: "book",
    size: { width: 600, height: 820 }, async run(page, context) {
    await settled(page);
    await context.setOffline(true);
    await page.waitForTimeout(600);
    await writeBook(page, BOOK("seed"));
    await turnPages(page, 900);
  } },

  // The working under each picture, then what Print puts on paper (the page's
  // own print stylesheet; the browser's print dialog cannot be recorded).
  bookmade: { caption: null, mode: "book", size: { width: 600, height: 820 }, async run(page) {
    await writeBook(page, BOOK("dog-copied"));
    const i = await page.evaluate(() => {
      const m = [...document.querySelectorAll(".book .made")];
      const k = m.findIndex(d => /copied example removed/.test(d.textContent));
      return k === -1 ? 0 : k;
    });
    const made = page.locator(".book .made").nth(i);
    await made.evaluate(d => d.closest(".sheet").scrollIntoView({ behavior: "smooth", block: "start" }));
    await page.waitForTimeout(1200);
    await made.locator("summary").click();
    await made.evaluate(d => d.scrollIntoView({ behavior: "smooth", block: "end" }));
    await page.waitForTimeout(3200);
    await page.evaluate(() => {
      document.body.classList.add("printing");
      document.querySelector(".book").classList.add("print-me");
    });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(800);
    for (let y = 0; y < 5; y++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(700); }
  } },

  intro: { caption: null, async run(page) {
    await ask(page, "a boat on the sea with two birds", BOAT);
    await page.waitForTimeout(2200);
  } },

  private: { caption: "network off — nothing is being sent anywhere", async run(page, context) {
    await settled(page);
    await context.setOffline(true);
    await page.waitForTimeout(600);
    await ask(page, "a cat", CAT);
    await page.waitForTimeout(2200);
  } },

  offline: { caption: "aeroplane mode — reloaded with no connection", async run(page, context) {
    await settled(page);
    await context.setOffline(true);
    await page.waitForTimeout(400);
    await page.reload();                    // the page itself, with no network
    await page.waitForFunction(() => document.querySelector("#status") !== null);
    await page.click("#load");
    await page.click(`#output [data-mode="sketch"]`);
    await page.waitForTimeout(600);
    await ask(page, "a red house with a green tree", HOUSE);
    await page.waitForTimeout(2200);
  } },

  svg: { caption: null, async run(page) {
    await ask(page, "a red house with a green tree", HOUSE);
    await page.waitForTimeout(900);
    const download = page.waitForEvent("download").catch(() => null);
    await page.getByText("Download SVG", { exact: true }).last().click();
    await download;
    await page.waitForTimeout(2000);
  } },

  // The commands panel is the point here, so this one needs a taller frame:
  // the drawing alone is 400px and the editor sits under it.
  edit: { caption: null, size: { width: 640, height: 940 }, async run(page) {
    await ask(page, "a house with a tree", PLAIN);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const d = [...document.querySelectorAll(".sketch details")].pop();
      if (d) { d.open = true; d.scrollIntoView({ block: "end" }); }
    });
    await page.waitForTimeout(800);
    const box = page.locator(".sketch textarea").last();
    await box.click();
    await box.fill("");
    await box.pressSequentially("house 30 60 60 red\ntree 75 55 40 green\nsun 15 15 12 yellow",
      { delay: 34 });
    await page.waitForTimeout(400);
    await page.getByText("Redraw", { exact: true }).last().click();
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const d = [...document.querySelectorAll(".sketch details")].pop();
      if (d) d.scrollIntoView({ block: "end" });
    });
    await page.waitForTimeout(2200);
  } },

  charm: { caption: null, async run(page) {
    await ask(page, "a cat", CAT);
    await page.waitForTimeout(700);
    await ask(page, "a boat on the sea with two birds", BOAT);
    await page.waitForTimeout(700);
    await ask(page, "a house with a tree and a car", PARTY);
    await page.waitForTimeout(1800);
  } },
};

const run = args => new Promise((ok, no) => {
  const p = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", d => { err += d; });
  p.on("close", c => (c === 0 ? ok() : no(new Error(err.slice(-400)))));
});
await run(["-hide_banner", "-encoders"]).catch(() => {
  throw new Error(`no usable ffmpeg (tried "${FFMPEG}"). apt-get install -y ffmpeg. ` +
    `Playwright bundles one, but it is a recording-only build and cannot encode.`);
});

const names = wanted.length ? wanted : Object.keys(CLIPS);
for (const name of names) {
  const clip = CLIPS[name];
  if (!clip) throw new Error(`no clip called "${name}" — have: ${Object.keys(CLIPS).join(", ")}`);
  const dir = `${out}/.frames-${name}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const exe = process.env.SKETCH_CHROME;
  const browser = await chromium.launch({ headless: true,
    ...(exe ? { executablePath: exe, args: ["--no-sandbox"] } : {}) });
  const size = clip.size || { width: 700, height: 700 };
  const context = await browser.newContext({ viewport: size, recordVideo: { dir, size },
    ...(clip.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" } : {}) });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => ({
        features: new Set(["shader-f16"]), limits: { maxBufferSize: 1e9 } }) } });
      window.result = "{}";
    });
    // manual=1: the page would otherwise start its model download by itself.
    await page.goto(`${origin}/browser.html?lib=${origin}/mock.mjs&rough=${origin}/rough.mjs&manual=1`);
    await page.waitForFunction(() => document.querySelector("#status").textContent === "ready to load");
    await page.click("#load");
    await page.waitForFunction(() => !document.querySelector("#send").disabled);
    await page.click(`#output [data-mode="${clip.mode || "sketch"}"]`);
    await page.waitForTimeout(500);
    // The caption is drawn in the page, so any ffmpeg will do — the static
    // builds on npm have no drawtext filter.
    if (clip.caption) await page.evaluate(text => {
      const b = document.createElement("div");
      b.textContent = text;
      b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99;padding:12px 10px;pointer-events:none;" +
        "background:rgb(0 0 0 / .84);color:#fff;font:600 17px system-ui,sans-serif;text-align:center";
      document.body.appendChild(b);
    }, clip.caption);
    await clip.run(page, context);
  } finally {
    await context.close();   // the video is only written when the context closes
    await browser.close();
  }

  const webm = (await readdir(dir)).find(f => f.endsWith(".webm"));
  if (!webm) throw new Error(`playwright wrote no video for ${name}`);
  const src = `${dir}/${webm}`;
  // Captions are already in the frames (see above), only where the clip is
  // demonstrating something the picture alone cannot show.
  const band = "";
  await run(["-y", "-i", src, "-vf", `scale=${size.width}:-2:flags=lanczos,fps=25${band}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart",
    `${out}/sketchgpt-${name}.mp4`]);
  await run(["-y", "-i", src, "-filter_complex",
    `fps=12,scale=560:-1:flags=lanczos${band},split[a][b];` +
    `[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
    "-loop", "0", `${out}/sketchgpt-${name}.gif`]);
  await rm(dir, { recursive: true, force: true });
  console.log(`  ${name}: ${out}/sketchgpt-${name}.mp4 + .gif`);
}
await new Promise(r => server.close(r));
