// Records the GIFs for media/tweets/thread-3.md: Book without the model.
//
//   PLAYWRIGHT_MODULE=... SKETCH_CHROME=... FFMPEG=<ffmpeg or ffmpeg-static> \
//     node scripts/record-thread-3.mjs [--out media/tweets] [clip …]
//
// Clips (each a real run of the page at phone size, 390×844):
//   10-no-download   open the app: no download; hero, place, wish → a book
//   11-own-story     write your own: the guide, then the book, words unchanged
//   12-your-picture  a child's drawing: the paper taken away, the drawing is the hero
//   13-scenery       one story that travels: farm, forest at night, snow, town, bed
//   14-video         save the whole book as a video, then play it
//
// HONESTY: there is no model in any of these, so nothing is stubbed and the
// waiting is real — but no clip claims a speed, because it is headless Chromium on a CPU-only machine with
// touch emulation, not a phone. The drawing in 12 is made by this script (a
// cat drawn on "paper" with canvas calls), not a child's. The video in 14 is
// WebM, because this Chromium has no H.264 encoder; Chrome and Safari make MP4.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launch } from "../tests/browser.mjs";
import { serve } from "../tests/serve.mjs";

const FFMPEG = process.env.FFMPEG || "ffmpeg";
const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt === -1 ? "media/tweets" : args[outAt + 1];
const wanted = args.filter((a, i) => !a.startsWith("--") && i !== outAt + 1);
const W = 390, H = 844;

const server = await serve(new URL("../web/", import.meta.url).pathname);
const browser = await launch();
const pause = ms => new Promise(r => setTimeout(r, ms));

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
const showSheet = async (page, n, ms = 2200) => {
  await page.evaluate(n => document.querySelectorAll(".book")[document.querySelectorAll(".book").length - 1]
    .querySelectorAll(".sheet")[n].scrollIntoView({ behavior: "smooth", block: "center" }), n);
  await pause(ms);
};
const tapChips = async (page, picks) => { for (const [id, v] of picks) { await page.tap(`#${id} [data-value="${v}"]`); await pause(350); } };
const waitBook = page => page.waitForFunction(() => {
  const b = document.querySelectorAll(".book"); return b.length && b[b.length - 1].querySelector(".book-actions");
}, null, { timeout: 60000 });

const CLIPS = {
  async "10-no-download"(page) {
    await page.goto(server.url + "browser.html?seed=0");
    await page.waitForSelector("#write");
    await caption(page, "Open the app: no AI model, nothing to download");
    await pause(2200);
    await caption(page, "Pick a hero, where they live, what they wish for");
    await page.evaluate(() => document.querySelector("#kinds").scrollIntoView({ block: "center" }));
    await tapChips(page, [["kinds", "dog"], ["places", "farm"], ["wishes", "sea"]]);
    await page.fill("#hero-name", "Pip"); await pause(500);
    await page.evaluate(() => document.querySelector("#write").scrollIntoView({ block: "center" })); await pause(500);
    await page.tap("#write");
    await caption(page, "The page writes the story and draws it. No AI model");
    await waitBook(page);
    for (const n of [0, 1, 3, 5]) await showSheet(page, n, 2000);
    await caption(page, "Privacy meter: 0 requests. Nothing left the phone");
    await page.evaluate(() => document.querySelector("#log").scrollTo({ top: 0, behavior: "smooth" }));
    await pause(2200);
  },

  async "11-own-story"(page) {
    await page.goto(server.url + "browser.html");
    await page.waitForSelector("#write");
    await caption(page, "Or write your own story");
    await page.tap("#mode-own"); await pause(800);
    await page.evaluate(() => document.querySelector("#own-text").scrollIntoView({ block: "center" }));
    await page.type("#own-text", "Luna and the Night Walk\n\nLuna was a little cat who lived on a farm.\n\n" +
      "One night, Luna crept out into the dark woods.\n\nAn owl called Hoot showed her the way home.\n\n" +
      "Luna curled up in her warm bed and fell asleep.", { delay: 12 });
    await caption(page, "It finds the hero, and shows what each page will draw");
    await page.evaluate(() => document.querySelector("#guide").scrollIntoView({ behavior: "smooth", block: "center" }));
    await pause(3200);
    await page.tap("#write");
    await caption(page, "Your words stay exactly as you wrote them");
    await waitBook(page);
    for (const n of [1, 2, 3, 4]) await showSheet(page, n, 2000);
  },

  async "12-your-picture"(page) {
    await page.goto(server.url + "browser.html?seed=5");
    await page.waitForSelector("#write");
    // A cat drawn on cream paper, made here with canvas calls.
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 300;
      const x = c.getContext("2d");
      x.fillStyle = "#f5efe0"; x.fillRect(0, 0, 320, 300);
      x.lineWidth = 7; x.strokeStyle = "#2a2a2a"; x.lineJoin = "round";
      x.fillStyle = "#f39c3d";
      x.beginPath(); x.ellipse(160, 210, 80, 62, 0, 0, 7); x.fill(); x.stroke();          // body
      x.beginPath(); x.arc(160, 120, 58, 0, 7); x.fill(); x.stroke();                     // head
      x.beginPath(); x.moveTo(112, 92); x.lineTo(118, 40); x.lineTo(148, 72); x.closePath(); x.fill(); x.stroke();
      x.beginPath(); x.moveTo(208, 92); x.lineTo(202, 40); x.lineTo(172, 72); x.closePath(); x.fill(); x.stroke();
      x.fillStyle = "#2a2a2a";
      x.beginPath(); x.arc(140, 115, 7, 0, 7); x.fill(); x.beginPath(); x.arc(180, 115, 7, 0, 7); x.fill();
      x.beginPath(); x.moveTo(152, 138); x.lineTo(168, 138); x.lineTo(160, 147); x.closePath(); x.fill();
      x.lineWidth = 4; x.beginPath(); x.moveTo(100, 140); x.lineTo(60, 132); x.moveTo(100, 150); x.lineTo(58, 156);
      x.moveTo(220, 140); x.lineTo(260, 132); x.moveTo(220, 150); x.lineTo(262, 156); x.stroke();
      x.lineWidth = 9; x.beginPath(); x.moveTo(236, 220); x.quadraticCurveTo(300, 200, 280, 140); x.stroke();
      return c.toDataURL("image/png").split(",")[1];
    });
    const file = join(tmpdir(), "rec-drawing.png");
    await writeFile(file, Buffer.from(png, "base64"));
    await caption(page, "Use a picture: a pet, a photo, or a child's drawing");
    await pause(1800);
    await page.setInputFiles("#pic-file", file);
    await page.waitForSelector(".me-note .pic-thumb");
    await caption(page, "The paper is taken away on your device. Never uploaded");
    await pause(2600);
    await tapChips(page, [["kinds", "cat"], ["places", "garden"], ["wishes", "lost"]]);
    await page.fill("#hero-name", "Tigger"); await pause(400);
    await page.evaluate(() => document.querySelector("#write").scrollIntoView({ block: "center" }));
    await page.tap("#write");
    await caption(page, "The drawing is the hero on every page");
    await waitBook(page);
    for (const n of [0, 2, 3, 5]) await showSheet(page, n, 2000);
  },

  async "13-scenery"(page) {
    await page.goto(server.url + "browser.html");
    await page.waitForSelector("#write");
    await page.tap("#mode-own");
    await page.fill("#own-text", "Max's Big Day\n\nMax was a little dog who lived on a farm.\n\n" +
      "That night, Max ran into the dark forest.\n\nBy morning, snow covered everything.\n\n" +
      "Max walked all the way into the busy town.\n\nAt last Max went home to his warm bed.");
    await page.tap("#write");
    await waitBook(page);
    await caption(page, "The scenery follows the words");
    for (const [n, say] of [[1, "A farm: fields, a path, a fence"], [2, "Night in the forest"], [3, "Snow"],
      [4, "A town: lamps, a pavement, rooftops"], [5, "Home, indoors"]]) {
      await caption(page, say); await showSheet(page, n, 2300);
    }
  },

  async "14-video"(page) {
    await page.goto(server.url + "browser.html?seed=2");
    await page.waitForSelector("#write");
    await tapChips(page, [["kinds", "fox"], ["places", "forest"], ["wishes", "dark"]]);
    await page.tap("#write");
    await waitBook(page);
    await caption(page, "Save the whole book as a video");
    await page.evaluate(() => document.querySelector("#log").scrollTo({ top: document.querySelector(".book").offsetTop - 60 }));
    await pause(900);
    await page.tap(".book-bar .more-btn"); await pause(900);
    const done = page.waitForEvent("download", { timeout: 240000 });
    await page.tap(".more-panel button.video");
    await caption(page, "Made on your own device. No server, nothing uploaded");
    const d = await done;
    const b64 = (await (await import("node:fs/promises")).readFile(await d.path())).toString("base64");
    await caption(page, "");
    await page.evaluate(b64 => {
      const v = document.createElement("video"); v.muted = true; v.autoplay = true; v.playsInline = true;
      v.src = "data:video/webm;base64," + b64;
      v.style.cssText = "position:fixed;inset:0;margin:auto;width:360px;z-index:98;box-shadow:0 10px 40px rgba(0,0,0,.4);border-radius:10px;background:#fbf6ea";
      const shade = document.createElement("div"); shade.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:97";
      document.body.append(shade, v);
    }, b64);
    await caption(page, "The video it made (silent: a browser can't record the device's voice)");
    await pause(9000);
  },
};

await mkdir(out, { recursive: true });
for (const [name, run] of Object.entries(CLIPS)) {
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
  await new Promise((ok, no) => spawn(FFMPEG, ["-y", "-loglevel", "error", "-ss", "0.4", "-i", join(dir, webm), "-vf",
    "fps=10,scale=390:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    gif], { stdio: "inherit" }).on("exit", c => c ? no(new Error("ffmpeg " + c)) : ok()));
  const { size } = await (await import("node:fs/promises")).stat(gif);
  console.log(`${gif}: ${(size / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s recorded`);
}
await browser.close(); server.close();
