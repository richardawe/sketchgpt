// Film stages 5 and 6 (web/film.html) on a touch screen:
//   5 — a full two-minute story renders to a video two minutes long, with sound;
//       "For sharing" asks the encoder for less; a video that died is reported on
//       the next visit, once; a failed video leaves a copyable report.
//   6 — Share as a link opens on a second device with no storage of its own:
//       the same words, pronouns, looks, pitch, chosen speakers and switches, and
//       the recipient's own draft is left alone; a screenplay downloads, and a
//       pasted screenplay is read as one.
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… node tests/film-share-browser.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serve } from "./serve.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const srv = await serve(new URL("../web", import.meta.url).pathname);
const browser = await chromium.launch({ headless: true, ...(process.env.SKETCH_CHROME ? { executablePath: process.env.SKETCH_CHROME } : {}),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const voices = () => {
  const list = [{ name: "Alex", lang: "en-US", voiceURI: "Alex", localService: true, default: true }, { name: "Daniel", lang: "en-GB", voiceURI: "Daniel", localService: true }];
  const fake = { speaking: false, getVoices: () => list, addEventListener() {}, cancel() {}, speak(u) { setTimeout(() => { u.onstart?.(); setTimeout(() => u.onend?.(), 30); }, 5); } };
  Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { Object.assign(this, { text, pitch: 1, rate: 1, volume: 1, voice: null }); } };
};
const errors = [];
const open = async (context, url) => {
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(url);
  if (await page.isVisible("#gate")) await page.tap("#enter");
  return page;
};
const lines = page => page.evaluate(() => window.__film.state.story.scenes.flatMap(s => s.beats).filter(b => b.kind === "line").map(b => [b.speaker, b.how]));

const STORY = `Ruth and Sam sat in the kitchen.

"You sold it," Ruth said.

"I had to."

"You had to?"

That night, Ruth stood in the street. Sam ran.`;

try {
  // ---------------------------------------------------------------- 6: the link
  const a = await browser.newContext({ ...phone, permissions: ["clipboard-read", "clipboard-write"] });
  await a.addInitScript(voices);
  const pa = await open(a, srv.url + "film.html?width=180&fps=4");
  await pa.fill("#story", STORY);
  await pa.waitForFunction(() => window.__film.state.story?.cast.some(c => c.name === "Sam"));
  await pa.selectOption('select[data-pronoun="Ruth"]', "she");
  await pa.selectOption('select[data-pronoun="Sam"]', "they");
  await pa.selectOption('select[data-look="Sam"]', "3");
  await pa.selectOption('select[data-pitch="Sam"]', "deeper");
  await pa.selectOption('select[data-voice="Sam"]', { label: await pa.textContent('select[data-voice="Sam"] option:first-child') });
  await pa.selectOption('tr.beat-line:has-text("You had to?") select', "Sam");
  await pa.setChecked("#fx", false); await pa.setChecked("#amb", true);
  const before = await pa.evaluate(() => ({ lines: null, look: window.__film.state.looks.Sam, pitch: window.__film.state.pitch.Sam, voice: document.querySelector('select[data-voice="Sam"]')?.selectedOptions[0]?.textContent }));
  before.lines = await lines(pa);
  await pa.tap("#sharelink");
  await pa.waitForFunction(() => window.__film.link);
  const link = await pa.evaluate(() => window.__film.link);
  assert.match(link, /film\.html#film=z/);
  assert.match(await pa.textContent("#shared"), /Recordings aren't/);
  assert.equal(await pa.evaluate(() => navigator.clipboard.readText()), link, "the link is on the clipboard");

  // A second phone, its own draft saved, opens the link.
  const b = await browser.newContext(phone);
  await b.addInitScript(voices);
  await b.addInitScript(() => { if (!sessionStorage.seeded) { localStorage.setItem("sketchgpt.film.draft", "My own story."); sessionStorage.seeded = 1; } });
  const pb = await open(b, link.replace(/^.*film\.html/, srv.url + "film.html"));
  await pb.waitForFunction(() => window.__film.state.fromLink);
  assert.equal(await pb.inputValue("#story"), STORY);
  assert.match(await pb.textContent("#opened"), /Opened from a link/);
  assert.equal(await pb.inputValue('select[data-pronoun="Sam"]'), "they");
  assert.deepEqual(await lines(pb), before.lines, "the chosen speaker travelled");
  const after = await pb.evaluate(() => ({ look: window.__film.state.looks.Sam, pitch: window.__film.state.pitch.Sam, voice: document.querySelector('select[data-voice="Sam"]')?.selectedOptions[0]?.textContent }));
  assert.deepEqual(after, { look: before.look, pitch: before.pitch, voice: before.voice });
  assert.deepEqual([await pb.isChecked("#fx"), await pb.isChecked("#amb")], [false, true]);
  assert.equal(await pb.evaluate(() => localStorage.getItem("sketchgpt.film.draft")), "My own story.", "opening a link keeps the recipient's draft");
  await pb.type("#story", " ");
  await pb.waitForFunction(() => localStorage.getItem("sketchgpt.film.draft") !== "My own story.");

  // A damaged link says so and leaves the page usable.
  const pc = await open(b, srv.url + "film.html#film=zAAAA");
  await pc.waitForFunction(() => !document.getElementById("opened").hidden);
  assert.match(await pc.textContent("#opened"), /damaged/);

  // ---------------------------------------------------------------- 6: screenplay out and in
  const [dl] = await Promise.all([pa.waitForEvent("download"), pa.tap("#fountain")]);
  assert.equal(dl.suggestedFilename(), "film.fountain");
  const fountain = readFileSync(await dl.path(), "utf8");
  assert.match(fountain, /^INT\. KITCHEN - DAY$/m);
  assert.match(fountain, /^EXT\. STREET - NIGHT$/m);
  assert.match(fountain, /^SAM\nYou had to\?$/m, "the chosen speaker is in the screenplay");
  await pa.fill("#story", fountain);
  await pa.waitForFunction(() => /Read as a screenplay/.test(document.getElementById("notes").textContent));
  assert.deepEqual((await lines(pa)).map(([w]) => w), before.lines.map(([w]) => w), "the screenplay reads back as the same speakers");
  assert.deepEqual(await pa.evaluate(() => window.__film.state.story.scenes.map(s => s.set)), ["kitchen", "street"]);

  // ---------------------------------------------------------------- 5: a video that died
  await pa.evaluate(() => localStorage.setItem("sketchgpt.film.run", JSON.stringify({ total: 2880, frame: 480, fps: 24, elapsedMs: 9000, hidden: true, finished: false })));
  await pa.reload(); if (await pa.isVisible("#gate")) await pa.tap("#enter");
  assert.equal(await pa.isVisible("#lastrun"), true);
  assert.match(await pa.textContent("#lastrun"), /stopped at 0:20 of 2:00 \(9 s in\), after the page went to the background/);
  await pa.reload();
  assert.equal(await pa.isVisible("#lastrun"), false, "said once");

  // ---------------------------------------------------------------- 5: a whole two minutes, "For sharing"
  // (FILM_SHORT=1 skips it: it renders 480 frames, several minutes under SwiftShader.)
  let length = 0, dur = 0, v = { ext: "-", bytes: 0, bitrate: 0 };
  if (!process.env.FILM_SHORT) {
  const LONG = Array.from({ length: 15 }, (_, i) => i % 2
    ? `"I waited for you at the station all evening, and then I walked home in the rain," Sam said. Ruth sat down.`
    : `"We should have left the city years ago, before any of this started," Ruth said. Sam stood up and walked to the window.`).join("\n\n");
  await pa.fill("#story", "Ruth and Sam sat in the kitchen.\n\n" + LONG);
  await pa.waitForFunction(() => window.__film.state.film?.length > 100);
  length = await pa.evaluate(() => window.__film.state.film.length);
  assert.ok(length >= 110 && length <= 120, `the fixture is ${length} s`);
  await pa.bringToFront();
  await pa.tap("#play");
  await pa.waitForFunction(() => window.__film.state.playing, null, { timeout: 240000 });
  await pa.tap("#stop");
  await pa.selectOption("#quality", "1200000");
  await pa.setChecked("#fx", true);
  await pa.evaluate(() => { window.__film.video = null; });
  await pa.waitForFunction(() => !document.getElementById("make").disabled, null, { timeout: 240000 });
  await pa.tap("#make");
  // While it renders, how far it got is written down.
  await pa.waitForFunction(() => JSON.parse(localStorage.getItem("sketchgpt.film.run") || "{}").frame > 0, null, { timeout: 600000 });
  await pa.waitForFunction(() => window.__film.video, null, { timeout: 900000 });
  v = await pa.evaluate(() => window.__film.video);
  assert.equal(v.ok, true, v.error);
  assert.equal(v.bitrate, 1.2e6, "For sharing asks the encoder for 1.2 Mbps");
  assert.equal(v.frames, Math.round(length * 4));
  assert.ok(v.audio, "with sound");
  dur = await pa.evaluate(async () => { const el = document.querySelector("#result video"); if (!(el.duration > 0)) await new Promise(r => el.addEventListener("loadedmetadata", r, { once: true })); return el.duration; });
  assert.ok(Math.abs(dur - length) < 1, `the video is ${dur} s for a ${length} s film`);
  assert.equal(JSON.parse(await pa.evaluate(() => localStorage.getItem("sketchgpt.film.run"))).finished, true, "a finished video is not reported as died");
  }

  // ---------------------------------------------------------------- 5: a video that fails
  await b.close();
  const d = await browser.newContext(phone);
  await d.addInitScript(voices);
  await d.addInitScript(() => { delete window.VideoEncoder; delete window.AudioEncoder; });
  const pd = await open(d, srv.url + "film.html?width=180&fps=4");
  await pd.bringToFront();
  await pd.fill("#story", STORY);
  await pd.tap("#play");             // at once: the page reads the typing before it plays
  await pd.waitForFunction(() => window.__film.state.playing, null, { timeout: 240000 });
  await pd.tap("#stop");
  await pd.waitForFunction(() => window.__film.state.stage && !document.getElementById("make").disabled, null, { timeout: 240000 });
  await pd.evaluate(() => { window.__film.video = null; });
  await pd.tap("#make");
  await pd.waitForFunction(() => window.__film.video, null, { timeout: 120000 });
  assert.equal(await pd.evaluate(() => window.__film.video.ok), false);
  assert.equal(await pd.isVisible("#failure"), true);
  const report = JSON.parse(await pd.textContent("#failure"));
  assert.ok(report.error && report.ua && report.seconds > 0 && report.webcodecs === false, JSON.stringify(report));
  assert.equal(await pd.isVisible("#copyfail"), true);

  assert.equal(await pa.evaluate(() => document.documentElement.scrollWidth), 390, "nothing wider than the phone");
  assert.deepEqual(errors, []);
  console.log(`film-share-browser: ok (link ${link.length} chars; 2:00 fixture ${length} s → ${dur.toFixed(1)} s ${v.ext}, ${(v.bytes / 1e6).toFixed(1)} MB at ${v.bitrate / 1e6} Mbps)`);
} finally {
  await browser.close();
  srv.close();
}
