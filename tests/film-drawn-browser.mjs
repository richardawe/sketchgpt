// Film's "Drawn" style (Open Peeps, drawn on a 2D canvas) on a touch screen: the
// Style switch and the drawn Cast card; the people are drawn in the outfit and
// hair chosen, sit when the story says so and hold what it gives them; the
// speaker's mouth opens on loud syllables and eyes blink; two people talking face
// each other across the cut; nothing needs WebGL; the video renders; the choice
// survives a reload and travels in a link; and switching back to Stylised
// brings the 3D stage back.
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… node tests/film-drawn-browser.mjs
import assert from "node:assert/strict";
import { serve } from "./serve.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const STORY = `Maya sat in the kitchen with a drink.

"You're late," she said.

Tom came in. "Traffic," he said.

"There's no traffic at two in the morning."

"I stopped for a drink."`;

const SOFA = `Maya sat on the sofa. Tom sat down next to her.

"Well," she said.

"Well what?" he said.

"You know what."

"I don't."

"You do."`;

const srv = await serve(new URL("../web", import.meta.url).pathname);
const browser = await chromium.launch({ headless: true, ...(process.env.SKETCH_CHROME ? { executablePath: process.env.SKETCH_CHROME } : {}),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const errors = [];
const newPage = async () => {
  const ctx = await browser.newContext(phone);
  await ctx.addInitScript(() => {
    const fake = { speaking: false, getVoices: () => [], addEventListener() {}, cancel() {}, speak(u) { setTimeout(() => { u.onstart?.(); setTimeout(() => u.onend?.(), 30); }, 5); } };
    Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
    window.SpeechSynthesisUtterance = class { constructor(text) { Object.assign(this, { text, pitch: 1, rate: 1, volume: 1 }); } };
    // Count WebGL contexts: a drawn film must not need one.
    const get = HTMLCanvasElement.prototype.getContext;
    window.__webgl = 0;
    HTMLCanvasElement.prototype.getContext = function (kind, ...a) { if (/webgl/.test(kind)) window.__webgl++; return get.call(this, kind, ...a); };
  });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(String(e)));
  return p;
};
const show = (p, tab) => p.evaluate(t => window.__film.show(t), tab);
const load = async p => {
  await show(p, "watch");
  await p.tap("#play");
  await p.waitForFunction(() => window.__film.state.playing, null, { timeout: 240000 });
  await p.tap("#stop");
  await p.waitForFunction(() => !window.__film.state.playing);
};

try {
  const page = await newPage();
  await page.goto(srv.url + "film.html?width=180&fps=4");
  await page.tap("#enter");
  await page.fill("#story", STORY);
  await page.waitForFunction(() => window.__film.state.story?.cast.some(c => c.name === "Tom"));
  await show(page, "cast");
  await page.tap('button[data-pronoun="Maya"][data-value="she"]');
  await page.tap('button[data-pronoun="Tom"][data-value="he"]');
  await page.tap('button[data-style="film"][data-value="drawn"]');
  // The drawn card: hair, outfit, face, beard, glasses; none of the other styles' controls.
  assert.equal(await page.locator('select[data-lk="costume"]').count(), 0);
  assert.equal(await page.locator('select[data-real]').count(), 0);
  assert.notEqual(await page.inputValue('select[data-dk="hair"][data-who="Maya"]'), await page.inputValue('select[data-dk="hair"][data-who="Tom"]'), "two people, two looks");
  await page.selectOption('select[data-dk="hair"][data-who="Maya"]', "Hijab");
  await page.tap('button[data-outfit="Tom"][data-value="WB"]');
  assert.match(await page.textContent('[data-person="Maya"] header'), /Hijab/);
  assert.equal(await page.getAttribute('button[data-outfit="Tom"][data-value="WB"]', "aria-pressed"), "true");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, "fits the phone");

  await load(page);
  const stage = await page.evaluate(() => ({ drawn: window.__film.state.stage.drawn, webgl: window.__webgl, world: !!window.__film.state.stage.world }));
  assert.deepEqual(stage, { drawn: true, webgl: 0, world: false }, "drawn: a 2D canvas, no WebGL");

  // Who is drawn how, across the film.
  const film = await page.evaluate(() => window.__film.state.film);
  const frames = await page.evaluate(n => Array.from({ length: n }, (_, i) => {
    const t = 0.3 + i * (window.__film.state.film.length - 0.6) / (n - 1);
    window.__film.still(t);
    const st = window.__film.state.stage, c = st.ctx.getImageData(0, 0, st.ctx.canvas.width, st.ctx.canvas.height).data;
    let ink = 0; for (let k = 0; k < c.length; k += 4) if (c[k] + c[k + 1] + c[k + 2] < 90) ink++;
    return { t, shot: st.last.shot, people: st.last.people, ink };
  }), 40);
  const seen = frames.flatMap(f => Object.entries(f.people));
  assert.ok(seen.filter(([n]) => n === "Maya").every(([, p]) => p.hair === "Hijab"), "Maya's hair as chosen, on every frame");
  assert.ok(seen.filter(([n]) => n === "Tom").every(([, p]) => p.outfit === "WB" && (/WB$/.test(p.pose) || p.pose === "CrossedLegs")), "Tom's light top in every drawing");
  assert.ok(seen.some(([n, p]) => n === "Maya" && /^(CrossedLegs|OneLegUp)/.test(p.pose)), "Maya sits");
  assert.ok(seen.some(([n, p]) => n === "Maya" && p.prop === "glass"), "Maya holds her drink");
  assert.ok(frames.filter(f => f.ink > 200).length > 30, "frames are drawn, in ink");
  // …and the hair really is drawn: the same close shot with other hair is a different picture.
  const hairDiff = await page.evaluate(line => {
    const st = window.__film.state.stage, snap = () => { window.__film.still((line[0] + line[1]) / 2); return st.ctx.getImageData(0, 0, st.ctx.canvas.width, st.ctx.canvas.height).data; };
    const a = snap(), keep = st.looks.Maya.hair; st.looks.Maya.hair = "Short"; const b = snap(); st.looks.Maya.hair = keep;
    let n = 0; for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k] - b[k]) > 40) n++;
    return n;
  }, film.lines.find(l => l[2] === "Maya"));
  assert.ok(hairDiff > 100, `a hijab and short hair draw differently (${hairDiff} pixels)`);

  // Talking: the mouth opens on a loud syllable and shuts on a quiet one; eyes blink when quiet.
  const face = await page.evaluate(line => {
    const st = window.__film.state.stage, mid = (line[0] + line[1]) / 2;
    const at = say => { st.speech = { 0: new Float32Array(9999).fill(say) }; st.speechCache = {}; window.__film.still(mid); return st.last.people[line[2]].face; };
    const open = at(1), shut = at(0);
    // With every voice silent, across the whole film: a blink every few seconds.
    st.speech = Object.fromEntries(window.__film.state.film.lines.map((l, i) => [i, new Float32Array(9999)])); st.speechCache = {};
    const blinks = []; for (let t = 0.6; t < window.__film.state.film.length; t += 0.04) { window.__film.still(t); blinks.push(st.last.people[line[2]]?.face); }
    st.speech = {};
    return { open, shut, blinks: blinks.filter(f => f === "EyesClosed").length };
  }, film.lines[0]);
  assert.equal(face.open, "Explaining", "a loud syllable opens the mouth");
  assert.notEqual(face.shut, "Explaining", "a quiet one shuts it");
  assert.ok(face.blinks > 0, "eyes blink");

  // Across the cut: each speaker, in their own close shot, faces the other's side.
  const turns = await page.evaluate(lines => lines.map(l => { window.__film.still((l[0] + l[1]) / 2 + 0.1); const st = window.__film.state.stage; return [l[2], st.last.shot, st.last.people[l[2]]?.flip]; }), film.lines);
  const maya = turns.find(([n, s]) => n === "Maya" && s === "Maya"), tom = turns.find(([n, s]) => n === "Tom" && s === "Tom");
  assert.ok(maya && tom, JSON.stringify(turns));
  assert.notEqual(maya[2], tom[2], `they face each other across the cut: ${JSON.stringify(turns)}`);
  // Side by side on a sofa both face the camera, so which way a drawing looks can't come from
  // where they face: at every cut from one to the other, they still look at each other
  // (both looked right before the rule).
  const sofa = await newPage();
  await sofa.goto(srv.url + "film.html?width=180&fps=4");
  await sofa.tap("#enter");
  await sofa.fill("#story", SOFA);
  await sofa.waitForFunction(() => window.__film.state.story?.cast.length >= 2);
  await show(sofa, "cast");
  for (const [n, pr] of [["Maya", "she"], ["Tom", "he"]]) await sofa.tap(`button[data-pronoun="${n}"][data-value="${pr}"]`);
  await sofa.tap('button[data-style="film"][data-value="drawn"]');
  await load(sofa);
  const cuts = await sofa.evaluate(() => {
    const f = window.__film.state.film, st = window.__film.state.stage, shots = [];
    for (const l of f.lines) { window.__film.still((l[0] + l[1]) / 2 + 0.1); if (st.last.shot === l[2]) shots.push([l[2], st.last.people[l[2]].flip]); }
    // Every cut from one speaker's close shot to the other's.
    const pairs = shots.slice(1).map((s, i) => [shots[i], s]).filter(([a, b]) => a[0] !== b[0]);
    return { pairs: pairs.length, opposite: pairs.filter(([a, b]) => a[1] !== b[1]).length };
  });
  assert.ok(cuts.pairs >= 4 && cuts.opposite === cuts.pairs, `on the sofa, at every cut between the two, they face each other: ${JSON.stringify(cuts)}`);

  // The video.
  await page.evaluate(() => { window.__film.video = null; });
  await page.tap("#make");
  await page.waitForFunction(() => window.__film.video, null, { timeout: 300000 });
  const video = await page.evaluate(() => window.__film.video);
  assert.equal(video.ok, true, video.error);
  assert.equal(video.frames, Math.round(film.length * 4));
  assert.equal(await page.evaluate(() => window.__webgl), 0, "still no WebGL");

  // Kept on this device, and carried by a link.
  await page.reload();
  await page.waitForFunction(() => window.__film.state.story);
  assert.equal(await page.evaluate(() => window.__film.state.style), "drawn");
  await show(page, "cast");
  assert.equal(await page.inputValue('select[data-dk="hair"][data-who="Maya"]'), "Hijab");
  await show(page, "watch");
  await page.tap("#sharelink");
  await page.waitForFunction(() => window.__film.link);
  const other = await newPage();
  await other.goto(await page.evaluate(() => window.__film.link));
  await other.tap("#enter");
  await other.waitForFunction(() => window.__film.state.fromLink);
  assert.equal(await other.evaluate(() => window.__film.state.style), "drawn");
  await show(other, "cast");
  assert.equal(await other.inputValue('select[data-dk="hair"][data-who="Maya"]'), "Hijab", "the link carries the drawn looks");
  assert.equal(await other.getAttribute('button[data-outfit="Tom"][data-value="WB"]', "aria-pressed"), "true");

  // Back to Stylised: the 3D stage.
  await show(page, "cast");
  await page.tap('button[data-style="film"][data-value="stylised"]');
  await load(page);
  assert.equal(await page.evaluate(() => !!window.__film.state.stage.world && !window.__film.state.stage.drawn), true);

  assert.deepEqual(errors, []);
  console.log(`film-drawn-browser: ok (${frames.length} frames drawn, blink on ${face.blinks} frames, faces ${maya[2]}/${tom[2]} across the cut, video ${video.frames} frames, no WebGL)`);
} finally {
  await browser.close();
  srv.close();
}
