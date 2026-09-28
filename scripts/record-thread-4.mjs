// Records the GIFs for media/tweets/thread-4.md: Draw me, Star in a book, and Film.
//
//   PLAYWRIGHT_MODULE=... SKETCH_CHROME=... FFMPEG=<ffmpeg or ffmpeg-static> \
//     node scripts/record-thread-4.mjs [--out media/tweets] [--face photo.jpg] [clip …]
//
// Clips:
//   15-draw-me        selfie.html: a photo in, a moving caricature out, the slider (screen recording)
//   16-star-in-book   the same drawing as the hero of a rule-written book (screen recording)
//   17-film-write     film.html: the sample story, Cast (pronouns, clothes), Script's guess (screen recording)
//   18-film           the sample film as the page itself saved it (its own video, not a screen recording)
//   19-film-styles    the same film in Stylised, Realistic and Drawn, side by side (the page's own videos)
//
// HONESTY: headless Chromium on a CPU-only machine (SwiftShader draws the 3D), touch emulation at
// 390×844. No clip claims a speed. There is no model in any of these, so nothing is stubbed. The
// film videos are made at 360 px and 12 fps to keep the render short here; phones make 720 px at
// 24 fps. They are WebM because this Chromium has no H.264 encoder (the iPhone makes MP4). GIFs are
// silent, and so is the phone's voice in a saved video: a page can't record it.
// The default face is NASA's public-domain portrait of Kathleen Rubins (tests/fixtures). Pass
// --face with your own photo before posting: NASA's media rules say an astronaut's picture must
// not suggest endorsement.
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { serve } from "../tests/serve.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const FFMPEG = process.env.FFMPEG || "ffmpeg";
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i === -1 ? null : args[i + 1]; };
const out = opt("--out") || "media/tweets";
const FACE = opt("--face") || new URL("../tests/fixtures/face-rubins.jpg", import.meta.url).pathname;
const wanted = args.filter((a, i) => !a.startsWith("--") && !["--out", "--face"].includes(args[i - 1]));
const W = 390, H = 844;
const FILM = "film.html?width=360&fps=12";

const server = await serve(new URL("../web/", import.meta.url).pathname);
const browser = await chromium.launch({ headless: true, ...(process.env.SKETCH_CHROME ? { executablePath: process.env.SKETCH_CHROME } : {}),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const pause = ms => new Promise(r => setTimeout(r, ms));
const ffmpeg = a => new Promise((ok, no) => spawn(FFMPEG, ["-y", "-loglevel", "error", ...a], { stdio: "inherit" })
  .on("exit", c => c ? no(new Error("ffmpeg " + c)) : ok()));
const GIF = "split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";

// A caption drawn in the page, so the GIF says what it shows.
const caption = (page, text) => page.evaluate(t => {
  let c = document.getElementById("rec-caption");
  if (!c) {
    c = document.createElement("div"); c.id = "rec-caption";
    c.style.cssText = "position:fixed;left:10px;right:10px;bottom:14px;z-index:99;padding:10px 12px;border-radius:12px;" +
      "background:rgba(20,20,28,.86);color:#fff;font:600 15px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none";
    document.body.append(c);
  }
  c.textContent = t; c.style.display = t ? "" : "none";
}, text);
const center = (page, sel, smooth = true) => page.evaluate(([s, b]) => document.querySelector(s)?.scrollIntoView({ behavior: b ? "smooth" : "auto", block: "center" }), [sel, smooth]);
const showSheet = async (page, n, ms = 2000) => {
  await page.evaluate(n => { const b = document.querySelectorAll(".book"); b[b.length - 1].querySelectorAll(".sheet")[n].scrollIntoView({ behavior: "smooth", block: "center" }); }, n);
  await pause(ms);
};

async function drawMe(page) {
  await page.goto(server.url + "selfie.html");
  await page.waitForSelector("#file", { state: "attached" });
  await caption(page, "Draw me: a photo becomes a moving drawing");
  await pause(1800);
  await page.setInputFiles("#file", FACE);
  await page.waitForSelector("#stage svg", { timeout: 120000 });
  await caption(page, "Made on the phone. The photo is never uploaded");
  await pause(3500);
  await center(page, "#amount"); await pause(600);
  await caption(page, "How much caricature: you choose");
  for (const v of ["0", "2", "1"]) {
    await page.$eval("#amount", (el, v) => { el.value = v; el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); }, v);
    await pause(1900);
  }
  await center(page, "#stage"); await pause(400);
  await caption(page, "It blinks and moves. Save it as a GIF, sticker or SVG");
  await pause(3200);
}

// The film's own video, made by the page: returns the saved file's path.
async function makeFilm(style, { stylisedLooks } = {}) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(server.url + FILM);
  await page.tap("#enter");
  await page.tap("#sample");
  await page.waitForFunction(() => window.__film.state.story?.cast.length >= 2);
  await page.tap("#toCast");
  await page.tap('button[data-pronoun="Maya"][data-value="she"]');
  await page.tap('button[data-pronoun="Tom"][data-value="he"]');
  await page.tap(`button[data-style="film"][data-value="${style}"]`);
  if (stylisedLooks) await stylisedLooks(page);
  await page.tap('.tabs [data-tab="watch"]');
  const t0 = Date.now();
  // Play loads the people and places; the video can be made once they're in.
  await page.tap("#play");
  await page.waitForFunction(() => window.__film.state.stage && !document.querySelector("#make").disabled, null, { timeout: 600000 });
  if (await page.isVisible("#stop")) await page.tap("#stop");
  await page.tap("#make");
  await page.waitForFunction(() => window.__film.video, null, { timeout: 1800000 });
  const v = await page.evaluate(() => window.__film.video);
  if (!v.ok) throw new Error(`${style}: ${v.error}`);
  const d = page.waitForEvent("download");
  await page.tap("#result a.btn");
  const file = join(tmpdir(), `rec-film-${style}.${v.ext}`);
  await (await d).saveAs(file);
  console.log(`  ${style}: ${v.frames} frames, ${(v.bytes / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s here`);
  await context.close();
  return file;
}

// Recorded from the screen: returns nothing; the harness turns the recording into a GIF.
const SCREEN = {
  async "15-draw-me"(page) { await drawMe(page); },

  async "16-star-in-book"(page) {
    await page.goto(server.url + "selfie.html");
    await page.setInputFiles("#file", FACE);
    await page.waitForSelector("#stage svg", { timeout: 120000 });
    await center(page, "#name", false);
    await caption(page, "Star in a book: your drawing becomes the hero");
    await page.fill("#name", "Kate"); await pause(1200);
    await page.tap("#star");
    await page.waitForSelector("#intro .me-note .me-thumb svg", { timeout: 60000 });
    await caption(page, "Only the drawing goes across, for this tab only");
    await center(page, "#intro .me-note"); await pause(2600);
    for (const [id, v] of [["places", "forest"], ["wishes", "sea"]]) { await page.tap(`#${id} [data-value="${v}"]`); await pause(400); }
    await center(page, "#write", false);
    await page.tap("#write");
    await page.waitForFunction(() => document.querySelectorAll(".book .art svg").length >= 7, null, { timeout: 60000 });
    await caption(page, "You're on every page. No AI model, nothing uploaded");
    for (const n of [0, 2, 3, 5]) await showSheet(page, n, 2100);
    await caption(page, "A share link never carries your face: others see a stand-in");
    await pause(2400);
  },

  async "17-film-write"(page) {
    await page.goto(server.url + FILM);
    await caption(page, "Film: write a scene, get a short film. No AI");
    await pause(2200);
    await page.tap("#enter");
    await page.fill("#story", "");
    await page.tap("#sample");
    await caption(page, "Plain prose. Quotes are what people say");
    await pause(2600);
    await page.tap("#toCast");
    await caption(page, "The page finds the people and asks who's who");
    await pause(1600);
    await page.tap('button[data-pronoun="Maya"][data-value="she"]'); await pause(700);
    await page.tap('button[data-pronoun="Tom"][data-value="he"]'); await pause(900);
    await caption(page, "Choose how they look and what they wear");
    await page.selectOption('select[data-lk="costume"][data-who="Tom"]', "suit"); await pause(1400);
    await center(page, '[data-person="Tom"]'); await pause(1800);
    await page.tap('.tabs [data-tab="script"]');
    await caption(page, "Script: what the page understood. Guesses are marked");
    await pause(1500);
    await center(page, ".line.guessed, #check"); await pause(2600);
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
    await caption(page, "Actions become stage directions: sits, stands, answers the phone");
    await pause(2800);
  },
};

// Made from the page's own videos.
const MADE = {
  async "18-film"(gif) {
    const f = await makeFilm("stylised");
    await ffmpeg(["-ss", "2", "-t", "24", "-i", f, "-vf", `fps=10,scale=300:-1:flags=lanczos,${GIF}`, gif]);
  },
  async "19-film-styles"(gif) {
    const files = [];
    for (const s of ["stylised", "realistic", "drawn"]) files.push(await makeFilm(s));
    // Labels drawn by the browser (the static ffmpeg builds have no drawtext).
    const labels = [];
    const page = await browser.newPage();
    for (const t of ["Stylised", "Realistic", "Drawn"]) {
      await page.setContent(`<span style="display:inline-block;padding:4px 10px;border-radius:8px;background:rgba(0,0,0,.65);color:#fff;font:600 16px system-ui,sans-serif">${t}</span>`);
      const png = join(tmpdir(), `rec-label-${t}.png`);
      await page.locator("span").screenshot({ path: png, omitBackground: true });
      labels.push(png);
    }
    await page.close();
    const label = i => `[${i}:v]scale=240:-1:flags=lanczos[s${i}];[s${i}][${i + 3}:v]overlay=(W-w)/2:8[v${i}]`;
    await ffmpeg([...files.flatMap(f => ["-ss", "4", "-t", "16", "-i", f]), ...labels.flatMap(p => ["-i", p]), "-filter_complex",
      `${label(0)};${label(1)};${label(2)};[v0][v1][v2]hstack=inputs=3,fps=10,${GIF}`, gif]);
  },
};

await mkdir(out, { recursive: true });
for (const [name, run] of Object.entries(SCREEN)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const dir = join(tmpdir(), "rec-" + name);
  await rm(dir, { recursive: true, force: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 1, recordVideo: { dir, size: { width: W, height: H } } });
  const page = await context.newPage();
  const t0 = Date.now();
  await run(page);
  await context.close();
  const [webm] = (await readdir(dir)).filter(f => f.endsWith(".webm"));
  const gif = join(out, name + ".gif");
  await ffmpeg(["-ss", "0.4", "-i", join(dir, webm), "-vf", `fps=10,scale=390:-1:flags=lanczos,${GIF}`, gif]);
  console.log(`${gif}: ${((await stat(gif)).size / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s recorded`);
}
for (const [name, run] of Object.entries(MADE)) {
  if (wanted.length && !wanted.includes(name)) continue;
  const gif = join(out, name + ".gif");
  await run(gif);
  console.log(`${gif}: ${((await stat(gif)).size / 1e6).toFixed(1)} MB`);
}
await browser.close(); server.close();
