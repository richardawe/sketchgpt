// Records a short clip of sketch mode for posting.
//
// No video framework needed: Playwright records the page natively and ships
// its own ffmpeg, so this is a browser drive plus one conversion.
//
//   node scripts/record-demo.mjs            # writes demo.mp4 and demo.gif
//   node scripts/record-demo.mjs --out /tmp # somewhere else
//
// HONESTY: every drawing in the clip is real output from a real model —
// captured from scripts/sketch-bench.mjs running Qwen3 through Ollama, and
// pasted in below. What is NOT real is the waiting: the page is driven by a
// stub engine so the recording is deterministic, so the clip shows what the
// model produced, never how long it took. Any post using it should say so.
// Measured latencies, if you need them: Qwen3-1.7B took 4.0s for the boat
// scene on four CPUs; a phone on WebGPU is a different number entirely.
import { mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";


// Playwright bundles an ffmpeg, but it is a recording-only build: VP8 encoder,
// `scale` filter, nothing else. Encoding needs a real one (apt-get install
// ffmpeg), so prefer that and say so clearly if it is missing.
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const out = (process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1] : ".").replace(/\/$/, "");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

// Real drawings, verbatim from the bench. Nothing here was written by hand.
const SCENES = [
  { ask: "a boat on the sea with two birds",
    by: "Qwen3-1.7B",
    drawing: { t: "A boat and two birds", c: [
      "sun 82 14 16", "sailboat 48 60 30", "line 5 78 95 78",
      "bird 28 26 10", "bird 44 20 10"] } },
  { ask: "a red house with a green tree",
    by: "Qwen3-1.7B",
    drawing: { t: "A red house with a green tree", c: [
      "house 25 55 40 red", "tree 75 55 34 green", "sun 82 14 16 yellow",
      "line 5 82 95 82"] } },
  { ask: "a house with a tree and a car",
    by: "Qwen3-0.6B, on a phone",   // the pile the page has to fix
    drawing: { t: "A house with a tree and a car", c: [
      "house 50 50 30", "tree-deciduous 50 52 30", "car 50 54 30"] } },
];

const dir = `${out}/.demo-frames`;
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 700, height: 700 },
  recordVideo: { dir, size: { width: 700, height: 700 } },
});
try {
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => ({
      features: new Set(["shader-f16"]), limits: { maxBufferSize: 1e9 } }) } });
    window.result = "{}";
  });
  const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return { interruptGenerate() {},
 chat: { completions: { async create() { return (async function* () {
 await new Promise(r => setTimeout(r, 450));
 yield { choices: [{ delta: { content: window.result } }] }; })(); } } } }; }`;
  await page.route("**/*", async route => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/mock.mjs") return route.fulfill({ contentType: "text/javascript", body: stub });
    const name = p.replace(/^.*\//, "");
    const file = /\.mjs$/.test(name) ? name : "browser.html";
    route.fulfill({ contentType: file.endsWith(".mjs") ? "text/javascript" : "text/html",
      body: await readFile(new URL("../web/" + file, import.meta.url), "utf8") });
  });

  await page.goto("http://localhost:8080/browser.html?lib=/mock.mjs");
  await page.waitForFunction(() => document.querySelector("#status").textContent === "ready to load");
  await page.click("#load");
  await page.selectOption("#output", "sketch");
  await page.waitForTimeout(700);

  for (const scene of SCENES) {
    await page.evaluate(d => { window.result = JSON.stringify(d); }, scene.drawing);
    // Type it out, so the clip reads as someone using the thing.
    // pressSequentially, not fill(): fill() selects the whole field on every
    // keystroke, and the recording shows a flickering blue highlight.
    await page.locator("#input").pressSequentially(scene.ask, { delay: 32 });
    await page.waitForTimeout(250);
    await page.click("#send");
    await page.waitForFunction(() => !document.querySelector("#send").disabled);
    await page.waitForTimeout(1400);
    await page.evaluate(() => document.querySelector("#log").scrollTo(0, 1e6));
  }
  // Finish on the commands panel: the point is that you can see what it said.
  await page.evaluate(() => {
    const d = [...document.querySelectorAll(".sketch details")].pop();
    if (d) { d.open = true; d.scrollIntoView({ block: "center" }); }
  });
  await page.waitForTimeout(1800);
} finally {
  await context.close();   // the video is only flushed on context close
  await browser.close();
}

const webm = (await (await import("node:fs/promises")).readdir(dir))
  .find(f => f.endsWith(".webm"));
if (!webm) throw new Error("playwright wrote no video");

const run = (args) => new Promise((ok, no) => {
  const p = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", d => { err += d; });
  p.on("close", c => c === 0 ? ok() : no(new Error(err.slice(-400))));
});

await run(["-hide_banner", "-encoders"]).catch(() => {
  throw new Error(`no usable ffmpeg (tried "${FFMPEG}"). apt-get install -y ffmpeg, ` +
    `or set FFMPEG=. Playwright's bundled build cannot encode.`);
});
const src = `${dir}/${webm}`;
// MP4 for X: yuv420p and an even width or it will not play everywhere.
await run(["-y", "-i", src, "-vf", "scale=700:-2:flags=lanczos,fps=25",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart",
  `${out}/sketchgpt-demo.mp4`]);
// GIF via a palette, or it bands badly on flat white.
await run(["-y", "-i", src, "-filter_complex",
  "fps=12,scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
  "-loop", "0", `${out}/sketchgpt-demo.gif`]);
await rm(dir, { recursive: true, force: true });
console.log(`wrote ${out}/sketchgpt-demo.mp4 and ${out}/sketchgpt-demo.gif`);
