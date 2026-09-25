// Film stage 1 (web/film.html) on a touch screen: the adult notice, prose in,
// pronouns asked, guesses shown and correctable, the scene played on the
// shared stage with the camera on whoever speaks, and a video with sound out.
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… node tests/film-browser.mjs
//
// SwiftShader draws; speed means nothing here (film-probe.html measures phones).
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

const STORY = `Ruth sat on the sofa with a drink.

"You're late," she said.

Sam came in. "Traffic."

"There's no traffic at two in the morning."

Sam shook their head. "Then I walked."`;

try {
  await page.goto(srv.url + "film.html?width=180&fps=4");
  // The adult notice comes first, and once agreed is remembered.
  assert.equal(await page.isVisible("#gate"), true);
  assert.equal(await page.isVisible("#app"), false);
  await page.tap("#enter");
  assert.equal(await page.isVisible("#app"), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, "nothing wider than the phone");

  await page.fill("#story", STORY);
  await page.waitForFunction(() => window.__film.state.story?.cast.some(c => c.name === "Ruth"));
  // No pronouns yet: "she" is given to nobody, and the page says why.
  let s = await page.evaluate(() => window.__film.state.story);
  assert.deepEqual(s.cast.map(c => c.name).sort(), ["Ruth", "Sam"]);
  assert.equal(s.scenes[0].beats.find(b => b.kind === "line").speaker, null);
  assert.match(await page.textContent("#notes"), /Say who is “she”/);

  await page.selectOption('select[data-pronoun="Ruth"]', "she");
  await page.selectOption('select[data-pronoun="Sam"]', "they");
  s = await page.evaluate(() => window.__film.state.story);
  const lines = s.scenes.flatMap(x => x.beats).filter(b => b.kind === "line");
  assert.deepEqual(lines.map(l => [l.speaker, l.how]), [["Ruth", "tag"], ["Sam", "paragraph"], ["Ruth", "guessed"], ["Sam", "paragraph"]]);
  assert.deepEqual(s.scenes.flatMap(x => x.beats).filter(b => b.kind === "action").map(b => `${b.who}:${b.move}`), ["Ruth:sit", "Sam:enter", "Sam:no"]);
  // The guess is shown, highlighted, and can be changed; the change wins.
  assert.equal(await page.locator("tr.guessed").count(), 1);
  assert.match(await page.textContent("tr.guessed"), /There's no traffic.*guessed/);
  await page.selectOption("tr.guessed select", "Sam");
  s = await page.evaluate(() => window.__film.state.story);
  assert.deepEqual(s.scenes[0].beats.filter(b => b.kind === "line").map(l => [l.speaker, l.how])[2], ["Sam", "chosen"]);
  await page.selectOption('tr.beat-line:has-text("no traffic") select', "Ruth");
  assert.match(await page.textContent("#length"), /^0:\d\d$/);

  // Play: the stage loads, and every line is shot on its speaker.
  await page.tap("#play");
  await page.waitForFunction(() => window.__film.state.stage, null, { timeout: 240000 });
  await page.tap("#stop");
  await page.waitForFunction(() => !window.__film.state.playing);
  const film = await page.evaluate(() => window.__film.state.film);
  const shots = await page.evaluate(ls => ls.map(([a, b]) => window.__film.still((a + b) / 2)), film.lines);
  assert.deepEqual(shots, film.lines.map(l => l[2]));
  assert.equal(await page.evaluate(() => window.__film.still(0.5)), "wide");

  // The video: every frame of the film, with sound.
  await page.tap("#make");
  await page.waitForFunction(() => window.__film.video, null, { timeout: 300000 });
  const video = await page.evaluate(() => window.__film.video);
  assert.equal(video.ok, true, video.error);
  assert.equal(video.frames, Math.round(film.length * 4));
  assert.ok(video.audio, "with sound");
  const played = await page.evaluate(async () => {
    const v = document.querySelector("#result video");
    if (v.readyState < 1) await new Promise(r => v.addEventListener("loadedmetadata", r, { once: true }));
    if (!isFinite(v.duration)) { v.currentTime = 1e9; await new Promise(r => v.addEventListener("durationchange", r, { once: true })); }
    return v.duration;
  });
  assert.ok(Math.abs(played - film.length) < 0.6, `plays ${played} s of a ${film.length} s film`);

  // The draft survives a reload, and so does the notice.
  await page.reload();
  assert.equal(await page.isVisible("#app"), true);
  assert.equal(await page.inputValue("#story"), STORY);

  assert.deepEqual(errors, []);
  assert.equal(navigations, 2, "only the load and the deliberate reload");
  console.log(`film-browser: ok (${film.lines.length} lines, ${film.length.toFixed(1)} s, video ${video.ext}+${video.audio})`);
} finally {
  await browser.close();
  srv.close();
}
