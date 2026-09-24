// Records the Draw me clips (web/selfie.html) for the thread in
// media/tweets/thread-3.md: a phone-sized screen, one clip per claim.
//
//   PLAYWRIGHT_MODULE=... SKETCH_CHROME=... [PHOTO=my-selfie.jpg] \
//     node scripts/record-selfie.mjs [drawme slider hello gif star] [--out dir]
//
// Clips:
//   drawme  a photo in, a moving caricature out
//   slider  "How much caricature": 0 (a straight portrait) to 2
//   hello   Say hello: the mouth moves while the phone's voice speaks (silent — captioned)
//   gif     Save GIF: the GIF it makes, playing
//   star    Star in a book: the hero of the next book, on every page
//
// HONESTY, as in scripts/record-demo.mjs:
// - The drawing is the real page on the real photo: MediaPipe's models on
//   LiteRT.js, in the browser, nothing faked. PHOTO= swaps in any photo; the
//   default is a public-domain NASA portrait (tests/fixtures/face-rubins.jpg).
//   Posting a real, recognisable person's caricature in a promotion is a
//   different thing from testing with it — record with your own selfie.
// - The book's story is real model output captured by scripts/capture-book.mjs
//   (scripts/demo-books/seed.json, Qwen3-1.7B). A stub stands in for WebLLM,
//   so the clip shows what the model wrote, never how long it took.
import { mkdir, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { serve } from "../tests/serve.mjs";

const FFMPEG = process.env.FFMPEG || "ffmpeg";
const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = (outAt === -1 ? "." : args[outAt + 1]).replace(/\/$/, "");
const wanted = args.filter((a, i) => !a.startsWith("--") && i !== outAt + 1);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const PHOTO = process.env.PHOTO || new URL("../tests/fixtures/face-rubins.jpg", import.meta.url).pathname;
const BOOK = JSON.parse(readFileSync(new URL("./demo-books/seed.json", import.meta.url), "utf8"));

// The book's replies stream in pieces so the page's progress line moves.
const STUB = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => true;
export async function CreateMLCEngine() { return { interruptGenerate() {}, unload() {},
 chat: { completions: { async create() {
  const out = window.results && window.results.length ? window.results.shift() : "{}";
  return (async function* () {
   await new Promise(r => setTimeout(r, 400));
   const n = out.length > 400 ? 36 : 1;
   for (let i = 0; i < n; i++) { await new Promise(r => setTimeout(r, n > 1 ? 55 : 0));
     yield { choices: [{ delta: { content: out.slice(Math.floor(i * out.length / n), Math.floor((i + 1) * out.length / n)) } }] }; }
  })(); } } } }; }`;

const caption = (page, text) => page.evaluate(t => {
  document.querySelectorAll(".clip-caption").forEach(n => n.remove());
  if (!t) return;
  const b = document.createElement("div");
  b.className = "clip-caption"; b.textContent = t;
  b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99;padding:12px 10px;pointer-events:none;" +
    "background:rgb(0 0 0 / .84);color:#fff;font:600 15px system-ui,sans-serif;text-align:center";
  document.body.appendChild(b);
}, text);
const draw = async page => {
  await page.setInputFiles("#file", PHOTO);
  await page.waitForSelector("#stage svg", { timeout: 120000 });
  await page.evaluate(() => document.querySelector("#stage").scrollIntoView({ block: "start" }));
};
// The face finder downloads ~13 MB once; it is loaded before the clip starts
// and that time is cut, so a clip shows the drawing, not a download.
const warm = page => page.evaluate(async () => {
  const m = await import("./face-find.mjs?v=1"); await m.loadFinder();
});

const CLIPS = {
  drawme: { async run(page) {
    await caption(page, "your photo, drawn on your phone — never uploaded");
    await page.waitForTimeout(1200);
    await draw(page);
    await page.waitForTimeout(6500);   // it blinks, glances and sways
  } },

  slider: { async run(page) {
    await draw(page);
    await page.waitForTimeout(1200);
    for (const v of ["0", "0.5", "1", "1.5", "2", "1"]) {
      await caption(page, `How much caricature: ${v}`);
      await page.$eval("#amount", (el, x) => { el.value = x; el.dispatchEvent(new Event("change")); }, v);
      await page.evaluate(() => document.querySelector("#stage").scrollIntoView({ block: "start" }));
      await page.waitForTimeout(1300);
    }
  } },

  hello: { voice: true, async run(page) {
    await draw(page);
    await page.waitForTimeout(1000);
    await caption(page, "silent clip — your phone's own voice says hello");
    await page.tap("#hello");
    await page.waitForTimeout(4200);
  } },

  gif: { share: true, async run(page) {
    await draw(page);
    await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelector("#gif").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(600);
    await caption(page, "Save GIF — made on the phone");
    await page.tap("#gif");
    await page.waitForFunction(() => window.sharedFile, null, { timeout: 60000 });
    // Show the GIF the page just made, as the share sheet would receive it.
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;inset:0;z-index:98;background:rgb(20 20 18 / .82);display:grid;place-items:center";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(window.sharedFile);
      img.style.cssText = "width:78%;border-radius:12px;box-shadow:0 10px 40px rgb(0 0 0 / .5)";
      d.append(img); document.body.append(d);
    });
    await caption(page, "me-drawn.gif — ready for any chat");
    await page.waitForTimeout(5000);
  } },

  star: { async run(page) {
    await draw(page);
    await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelector("#name").scrollIntoView({ block: "center" }));
    await page.locator("#name").pressSequentially("Sam", { delay: 120 });
    await page.waitForTimeout(400);
    await caption(page, "Star in a book");
    await page.tap("#star");
    await page.waitForURL(u => !u.pathname.endsWith("selfie.html"));
    await page.waitForFunction(() => !document.querySelector("#send").disabled, null, { timeout: 60000 });
    await page.waitForSelector("#intro .me-note .me-thumb svg");
    await caption(page, null);
    await page.waitForTimeout(1600);
    await page.evaluate(r => { window.results = r; }, [BOOK.story, ...BOOK.plans]);
    await page.locator("#input").pressSequentially(BOOK.premise, { delay: 34 });
    await page.waitForTimeout(250);
    await page.tap("#send");
    await page.waitForFunction(() => document.querySelectorAll(".book .art svg").length >= 7, null, { timeout: 60000 });
    const sheets = await page.locator(".book .sheet").count();
    for (let i = 0; i < Math.min(sheets, 5); i++) {
      await page.locator(".book .sheet").nth(i).evaluate(s => s.scrollIntoView({ behavior: "smooth", block: "start" }));
      await page.waitForTimeout(1500);
    }
  } },
};

const run = a => new Promise((ok, no) => {
  const p = spawn(FFMPEG, a, { stdio: ["ignore", "ignore", "pipe"] });
  let err = ""; p.stderr.on("data", d => { err += d; });
  p.on("close", c => (c === 0 ? ok() : no(new Error(err.slice(-400)))));
});

const server = await serve(new URL("../web/", import.meta.url).pathname);
const size = { width: 390, height: 760 };
for (const name of wanted.length ? wanted : Object.keys(CLIPS)) {
  const clip = CLIPS[name];
  if (!clip) throw new Error(`no clip called "${name}" — have: ${Object.keys(CLIPS).join(", ")}`);
  const dir = `${out}/.frames-${name}`;
  await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  const exe = process.env.SKETCH_CHROME;
  const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe, args: ["--no-sandbox"] } : {}) });
  const context = await browser.newContext({ viewport: size, recordVideo: { dir, size }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 1, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" });
  await context.route(/cdn\.jsdelivr\.net\/npm\/@mlc-ai\/web-llm/, r => r.fulfill({ contentType: "text/javascript", body: STUB }));
  await context.addInitScript(({ voice, share }) => {
    Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => ({ features: new Set(["shader-f16"]), limits: { maxBufferSize: 1e9 } }) } });
    if (navigator.storage) navigator.storage.estimate = async () => ({ quota: 50e9, usage: 0 });
    if (voice) {   // headless Chrome has no voices: speak for as long as a person would
      let q = [], busy = false;
      const next = () => { const u = q.shift(); if (!u) { busy = false; return; } busy = true; u.onstart && u.onstart();
        setTimeout(() => { u.onend && u.onend(); next(); }, 500 + u.text.split(/\s+/).length * 330); };
      Object.defineProperty(window, "speechSynthesis", { value: { getVoices: () => [], speak(u) { q.push(u); if (!busy) next(); }, cancel() { q = []; } } });
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    }
    if (share) {
      Object.defineProperty(navigator, "canShare", { value: () => true });
      Object.defineProperty(navigator, "share", { value: async d => { window.sharedFile = d.files[0]; } });
    }
  }, { voice: !!clip.voice, share: !!clip.share });
  let skip = 0;
  try {
    const t0 = Date.now();
    const page = await context.newPage();
    await page.goto(server.url + "selfie.html");
    await warm(page);                        // cut from the video below
    skip = (Date.now() - t0) / 1000;
    await page.waitForTimeout(400);
    await clip.run(page);
  } finally { await context.close(); await browser.close(); }
  const webm = (await readdir(dir)).find(f => f.endsWith(".webm"));
  const src = `${dir}/${webm}`;
  await run(["-y", "-ss", skip.toFixed(2), "-i", src, "-vf", "fps=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart", `${out}/selfie-${name}.mp4`]);
  // X takes GIFs up to 15 MB: phone width, 10 fps, a small palette.
  await run(["-y", "-ss", skip.toFixed(2), "-i", src, "-filter_complex", `fps=10,scale=${size.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
    "-loop", "0", `${out}/selfie-${name}.gif`]);
  await rm(dir, { recursive: true, force: true });
  console.log(`  ${name}: ${out}/selfie-${name}.mp4 + .gif`);
}
server.close();
