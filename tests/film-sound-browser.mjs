// Film stage 4 (web/film/sound.mjs, film.mjs soundCues/ambience/envelopes):
// on a touch screen, the preview plays the story's own sounds and the place's
// sound; the video carries a gunshot where the gun fires, background sound
// only when it's switched on, silence when both are off; and a speaking head
// moves with the voice.
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… node tests/film-sound-browser.mjs
import assert from "node:assert/strict";
import { serve } from "./serve.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const STORY = `Tom and Maya stood in the street.

"Why?" said Tom.

Maya shot him. He fell.

"Because," Maya whispered.`;

const srv = await serve(new URL("../web", import.meta.url).pathname);
const browser = await chromium.launch({ headless: true, ...(process.env.SKETCH_CHROME ? { executablePath: process.env.SKETCH_CHROME } : {}),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
// A phone voice that answers at once, so the preview isn't held by a real one.
await context.addInitScript(() => {
  const fake = { speaking: false, getVoices: () => [], addEventListener() {}, cancel() { this.speaking = false; },
    speak(u) { setTimeout(() => { u.onstart?.(); setTimeout(() => u.onend?.(), 100); }, 5); } };
  Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { Object.assign(this, { text, pitch: 1, rate: 1, volume: 1 }); } };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));

// Loudness (RMS) of the last video's sound, in windows [from, to] seconds.
const levels = windows => page.evaluate(async ws => {
  const blob = await fetch(document.querySelector("#result video").src).then(r => r.blob());
  const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  return ws.map(([a, b]) => { let s = 0, n = 0; for (let i = Math.floor(a * sr); i < Math.min(d.length, Math.floor(b * sr)); i++) { s += d[i] * d[i]; n++; } return Math.sqrt(s / Math.max(1, n)); });
}, windows);
const make = async ({ fx, amb }) => {
  await page.setChecked("#fx", fx); await page.setChecked("#amb", amb);
  await page.evaluate(() => { window.__film.video = null; });
  await page.tap("#make");
  await page.waitForFunction(() => window.__film.video, null, { timeout: 300000 });
  const v = await page.evaluate(() => window.__film.video);
  assert.equal(v.ok, true, v.error);
};

try {
  await page.goto(srv.url + "film.html?width=180&fps=8");
  await page.tap("#enter");
  await page.fill("#story", STORY);
  await page.waitForFunction(() => window.__film.state.story?.cast.some(c => c.name === "Maya"));
  await page.selectOption('select[data-pronoun="Maya"]', "she");
  await page.selectOption('select[data-pronoun="Tom"]', "he");
  assert.equal(await page.isChecked("#fx"), true, "sound effects are on by default");
  assert.equal(await page.isChecked("#amb"), false, "background sound is off by default");

  // The preview: the gunshot, the fall, and the street, as the scene reaches them.
  await page.setChecked("#amb", true);
  await page.tap("#play");
  await page.waitForFunction(() => window.__film.state.stage, null, { timeout: 240000 });
  await page.waitForFunction(() => window.__film.state.playing === false && window.__film.heard, null, { timeout: 120000 });
  const heard = await page.evaluate(() => window.__film.heard.filter(h => h.how === "cue" || h.how === "place").map(h => h.kind));
  assert.deepEqual(heard.filter(k => k !== "step"), ["street", "gunshot", "thud"]);

  // The head moves with the voice: loud and silent envelopes pose it differently.
  const heads = await page.evaluate(() => {
    const st = window.__film.state.stage, l = st.film.lines[0], head = st.world.cast.Tom.head;
    const q = v => { st.speech = { 0: new Float32Array(600).fill(v) }; window.__film.still((l[0] + l[1]) / 2); return head.quaternion.toArray(); };
    return { silent: q(0), loud: q(1) };
  });
  const diff = heads.silent.reduce((s, v, i) => s + Math.abs(v - heads.loud[i]), 0);
  assert.ok(diff > 0.02, `the head moved by ${diff.toFixed(3)}`);

  const film = await page.evaluate(() => window.__film.state.film);
  const shot = film.actions.find(a => a[3] === "shoot"), gun = shot[0] + 0.3;
  const quiet = [film.lines[0][0], film.lines[0][1]];        // "Why?": nothing happens but talk

  // Effects on, background off: a gunshot where the gun fires, quiet elsewhere.
  await make({ fx: true, amb: false });
  const [bang, calm] = await levels([[gun - 0.02, gun + 0.2], quiet]);
  assert.ok(bang > 0.05 && bang > 10 * calm, `gunshot ${bang.toFixed(4)} vs ${calm.toFixed(4)}`);

  // Background on, effects off: the street is heard throughout, and no gunshot.
  await make({ fx: false, amb: true });
  const [bang2, street] = await levels([[gun - 0.02, gun + 0.2], quiet]);
  assert.ok(street > 0.002, `street ${street.toFixed(4)}`);
  assert.ok(bang2 < 3 * street + 0.01, `no gunshot without effects: ${bang2.toFixed(4)}`);

  // Both off (and no recordings, no music): silence.
  await make({ fx: false, amb: false });
  const [all] = await levels([[0, film.length]]);
  assert.ok(all < 0.001, `silent: ${all}`);

  assert.deepEqual(errors, []);
  console.log(`film-sound-browser: ok (gunshot ${bang.toFixed(3)} over ${calm.toFixed(4)}; street ${street.toFixed(4)}; silent ${all.toExponential(1)}; head moved ${diff.toFixed(3)})`);
} finally {
  await browser.close();
  srv.close();
}
