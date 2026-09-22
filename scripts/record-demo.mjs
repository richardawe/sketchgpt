// Records short clips of sketch mode, one per thing you might want to say
// about it.
//
// No video framework needed: Playwright records the page natively, and one
// ffmpeg call turns each recording into an mp4 and a gif.
//
//   node scripts/record-demo.mjs                 # every clip
//   node scripts/record-demo.mjs offline svg     # just those
//   node scripts/record-demo.mjs --out /tmp
//
// Clips:
//   intro    type a request, get a drawing            — "no app, no account"
//   private  the same, with the network truly cut     — "nothing leaves your phone"
//   offline  reload with no network at all, then draw — "aeroplane mode"
//   svg      draw, then download the SVG              — "drop it into a worksheet"
//   charm    three sketches in a row                  — "it draws like a five-year-old"
//
// HONESTY, two parts, and both matter if you post these.
//
// 1. Every drawing is real output from a real model, lifted verbatim from
//    scripts/sketch-bench.mjs. None of it was drawn by hand for the camera.
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
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FONT = process.env.FONT || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
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
const PARTY = { t: "A house with a tree and a car", c: [
  "house 50 50 30", "tree-deciduous 50 52 30", "car 50 54 30"] };

// A real service worker needs a real origin: page.route() interception
// disables it, which is exactly the thing the offline clips are showing.
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript" };
const MOCK = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return { interruptGenerate() {},
 chat: { completions: { async create() { return (async function* () {
 await new Promise(r => setTimeout(r, 420));
 yield { choices: [{ delta: { content: window.result } }] }; })(); } } } }; }`;
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
const settled = async page => {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 20000 });
};

const CLIPS = {
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
    await page.selectOption("#output", "sketch");
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
    await page.goto(`${origin}/browser.html?lib=${origin}/mock.mjs&rough=${origin}/rough.mjs`);
    await page.waitForFunction(() => document.querySelector("#status").textContent === "ready to load");
    await page.click("#load");
    await page.selectOption("#output", "sketch");
    await page.waitForTimeout(500);
    await clip.run(page, context);
  } finally {
    await context.close();   // the video is only written when the context closes
    await browser.close();
  }

  const webm = (await readdir(dir)).find(f => f.endsWith(".webm"));
  if (!webm) throw new Error(`playwright wrote no video for ${name}`);
  const src = `${dir}/${webm}`;
  // A burnt-in caption, only where the clip is demonstrating something the
  // picture alone cannot show.
  const band = clip.caption
    ? `,drawbox=x=0:y=ih-46:w=iw:h=46:color=black@0.82:t=fill,` +
      `drawtext=fontfile='${FONT}':text='${clip.caption}':fontcolor=white:fontsize=21:x=(w-tw)/2:y=h-32`
    : "";
  await run(["-y", "-i", src, "-vf", `scale=700:-2:flags=lanczos,fps=25${band}`,
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
