// Film stage 0 probe (web/film-probe.html) on a touch screen: it loads the
// free CC0 people, movements and room; cuts by rule; makes a video WITH SOUND
// that plays back at the right length; and a run that never finished is
// reported on the next visit (the phone's tab dying is the thing being measured).
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… node tests/film-probe-browser.mjs
//
// SwiftShader draws the frames, so the speed numbers here mean nothing; they
// come from the owner's phone. This checks that the page works end to end.
import assert from "node:assert/strict";
import { serve } from "./serve.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const srv = await serve(new URL("../web", import.meta.url).pathname);
const browser = await chromium.launch({ headless: true, ...(process.env.SKETCH_CHROME ? { executablePath: process.env.SKETCH_CHROME } : {}),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
let navigations = 0;
page.on("framenavigated", f => { if (f === page.mainFrame()) navigations++; });

try {
  await page.goto(srv.url + "film-probe.html?seconds=3&fps=12&width=180");
  assert.equal(await page.isVisible("#lastrun"), false, "no earlier run, no warning");
  assert.equal(await page.textContent("#make"), "2. Make the 3-second video");

  await page.tap("#load");
  await page.waitForFunction(() => window.__probe.ready || window.__probe.report.loadError, null, { timeout: 240000 });
  const report = await page.evaluate(() => window.__probe.report);
  assert.equal(report.loadError, undefined, report.loadError);
  assert.equal(report.load.clips, 84, "both free animation libraries, T-poses dropped");
  assert.ok(report.load.triangles > 20000, "two people and a room were drawn");
  assert.ok(report.load.MB > 5 && report.load.MB < 9, `download ${report.load.MB} MB`);

  // The camera follows the rules: wide to open, then whoever speaks.
  const shots = await page.evaluate(() => [1, 4.5, 7, 11, 15, 18].map(t => window.__probe.still(t).shot));
  assert.deepEqual(shots, ["wide", "woman", "man", "man", "woman", "wide"]);
  // A drawn frame, not a blank one: many colours.
  const colours = await page.evaluate(() => {
    window.__probe.still(4.5);
    const c = document.getElementById("out"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 7) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3);
    return seen.size;
  });
  assert.ok(colours > 200, `the frame has ${colours} colours`);

  // The video: frames, sound, and a file that plays for as long as it should.
  await page.tap("#make");
  await page.waitForFunction(() => window.__probe.report.video, null, { timeout: 300000 });
  const video = await page.evaluate(() => window.__probe.report.video);
  assert.equal(video.ok, true, video.error);
  assert.equal(video.frames, 36);
  assert.notEqual(video.audio, "none (no encoder)", "the video has a soundtrack");
  assert.ok(video.MB > 0.01, `${video.MB} MB`);
  const played = await page.evaluate(async () => {
    const v = document.querySelector("#result video");
    if (v.readyState < 1) await new Promise(r => v.addEventListener("loadedmetadata", r, { once: true }));
    if (!isFinite(v.duration)) { v.currentTime = 1e9; await new Promise(r => v.addEventListener("durationchange", r, { once: true })); }
    const blob = await fetch(v.src).then(r => r.blob());
    const ctx = new OfflineAudioContext(1, 1, 48000);
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer()).then(b => b.duration, () => 0);
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight, audio };
  });
  assert.ok(Math.abs(played.duration - 3) < 0.35, `plays for ${played.duration} s`);
  assert.equal(played.width, 180); assert.equal(played.height, 320);
  assert.ok(played.audio > 2.5, `the sound decodes, ${played.audio} s`);

  // A finished run is not reported as a death.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sketchgpt.film.probe.run")));
  assert.equal(stored.finished, true);

  // A run that never finished is reported on the next visit.
  await page.evaluate(() => localStorage.setItem("sketchgpt.film.probe.run", JSON.stringify({ total: 2880, frame: 1200, fps: 24, elapsedMs: 185000, finished: false, hidden: true })));
  await page.reload();
  assert.equal(await page.isVisible("#lastrun"), true);
  assert.match(await page.textContent("#lastrun"), /frame 1200 of 2880 \(50\.0 s of video, 185 s in, the page had been in the background\)/);
  assert.equal((await page.evaluate(() => window.__probe.report.previousRunDied)).frame, 1200);

  assert.deepEqual(errors, []);
  assert.equal(navigations, 2, "only the load and the deliberate reload");
  console.log(`film-probe-browser: ok (video ${video.container}/${video.video}+${video.audio}, ${played.duration.toFixed(2)} s, ${video.MB} MB)`);
} finally {
  await browser.close();
  srv.close();
}
