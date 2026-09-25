// Film stage 1 (web/film.html) on a touch screen: the adult notice, prose in,
// pronouns asked, guesses shown and correctable, a line recorded in "your"
// voice (Chromium's fake microphone), the scene played on the shared stage
// with the camera on whoever speaks and every other line in the phone's voice
// (a stand-in speechSynthesis that records what it was asked to say), and a
// video whose sound is the recording, at its line, and silence elsewhere.
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… node tests/film-browser.mjs
//
// SwiftShader draws; speed means nothing here (film-probe.html measures phones).
import assert from "node:assert/strict";
import { serve } from "./serve.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const srv = await serve(new URL("../web", import.meta.url).pathname);
const browser = await chromium.launch({ headless: true, ...(process.env.SKETCH_CHROME ? { executablePath: process.env.SKETCH_CHROME } : {}),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ["microphone"] });
// A phone voice that says what it was asked, and takes about as long as speech would.
await context.addInitScript(() => {
  const voices = [{ name: "Alex", lang: "en-US", voiceURI: "Alex", localService: true, default: true }, { name: "Samantha", lang: "en-US", voiceURI: "Samantha", localService: true }, { name: "Daniel", lang: "en-GB", voiceURI: "Daniel", localService: true }];
  const said = window.__said = [];
  const fake = { speaking: false, getVoices: () => voices, addEventListener() {}, cancel() { this.speaking = false; },
    speak(u) {
      said.push({ text: u.text, voice: u.voice?.name || null, pitch: u.pitch, volume: u.volume });
      this.speaking = true;
      setTimeout(() => { u.onstart?.(); setTimeout(() => { this.speaking = false; u.onend?.(); }, Math.max(50, u.text.split(" ").length * 250)); }, 10);
    } };
  Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { Object.assign(this, { text, pitch: 1, rate: 1, volume: 1, voice: null, lang: "" }); } };
});
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
  assert.deepEqual(s.scenes.flatMap(x => x.beats).filter(b => b.kind === "action").map(b => `${b.who}:${b.move}`), ["Ruth:sit", "Ruth:hold", "Sam:enter", "Sam:no"]);
  // The guess is shown, highlighted, and can be changed; the change wins.
  assert.equal(await page.locator("tr.guessed").count(), 1);
  assert.match(await page.textContent("tr.guessed"), /There's no traffic.*guessed/);
  await page.selectOption("tr.guessed select", "Sam");
  s = await page.evaluate(() => window.__film.state.story);
  assert.deepEqual(s.scenes[0].beats.filter(b => b.kind === "line").map(l => [l.speaker, l.how])[2], ["Sam", "chosen"]);
  await page.selectOption('tr.beat-line:has-text("no traffic") select', "Ruth");

  // Voices: each person a different phone voice by default; a pitch per person.
  const ruthVoice = await page.inputValue('select[data-voice="Ruth"]'), samVoice = await page.inputValue('select[data-voice="Sam"]');
  assert.ok(ruthVoice && samVoice && ruthVoice !== samVoice, `${ruthVoice} / ${samVoice}`);
  await page.selectOption('select[data-pitch="Sam"]', "deeper");
  assert.match((await page.evaluate(() => window.__said.at(-1))).text, /This is Sam/, "choosing a voice lets you hear it");

  // Record Ruth's first line in "your" voice.
  const lengthBefore = await page.evaluate(() => window.__film.state.film.lines[0][1] - window.__film.state.film.lines[0][0]);
  await page.tap('tr.beat-line:has-text("late") button.rec');
  await page.waitForFunction(() => window.__film.state.recording);
  await page.waitForTimeout(2500);
  await page.tap('tr.beat-line:has-text("late") button.rec.on');
  await page.waitForFunction(() => Object.keys(window.__film.state.takes).length === 1, null, { timeout: 15000 });
  const take = await page.evaluate(() => { const [k, v] = Object.entries(window.__film.state.takes)[0]; return { key: k, seconds: v.buffer.duration }; });
  assert.match(take.key, /late/);
  assert.ok(take.seconds > 0.1, `${take.seconds} s recorded`);
  assert.equal(await page.locator('tr.beat-line:has-text("late") [data-listen]').count(), 1, "the take can be heard back");
  const lengthAfter = await page.evaluate(() => window.__film.state.film.lines[0][1] - window.__film.state.film.lines[0][0]);
  assert.ok(Math.abs(lengthAfter - take.seconds - 0.15) < 0.01 && lengthAfter !== lengthBefore, `the line now lasts as long as the take (${lengthAfter})`);
  assert.equal(await page.isChecked("#music"), false, "music is off unless asked for");
  assert.match(await page.textContent("#length"), /^0:\d\d$/);

  // Play: the stage loads, and every line is shot on its speaker, and heard.
  await page.evaluate(() => { window.__said.length = 0; });
  await page.tap("#play");
  await page.waitForFunction(() => window.__film.state.stage, null, { timeout: 240000 });
  await page.waitForFunction(() => window.__film.state.playing === false && window.__film.heard, null, { timeout: 180000 });
  const film = await page.evaluate(() => window.__film.state.film);
  const heard = await page.evaluate(() => window.__film.heard);
  const said = await page.evaluate(() => window.__said.filter(x => x.volume !== 0));
  assert.deepEqual(heard.map(h => h.how), ["recording", "voice", "voice", "voice"]);
  assert.deepEqual(said.map(x => x.text), film.lines.slice(1).map(l => l[3]), "every other line, in order, in the phone's voice");
  const byName = Object.fromEntries(film.lines.map((l, i) => [i, l[2]]));
  heard.slice(1).forEach((h, i) => {
    const who = byName[i + 1];
    assert.equal(h.voice, who === "Sam" ? samVoice : ruthVoice, `${who}'s voice`);
    assert.equal(h.pitch, who === "Sam" ? 0.75 : 1, `${who}'s pitch`);
  });
  assert.equal(await page.evaluate(() => window.__film.state.ttsBlocked), false);
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
  // The sound: the recording where Ruth's first line is, silence elsewhere (music is off).
  assert.deepEqual(video.voices, [film.lines[0][0]]);
  const levels = await page.evaluate(async ([a, b]) => {
    const blob = await fetch(document.querySelector("#result video").src).then(r => r.blob());
    const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
    const d = buf.getChannelData(0), sr = buf.sampleRate;
    const rms = (x, y) => { let s = 0, n = 0; for (let i = Math.floor(x * sr); i < Math.min(d.length, Math.floor(y * sr)); i++) { s += d[i] * d[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };
    return { line: rms(a, b), after: rms(b + 0.5, buf.duration) };
  }, [film.lines[0][0], film.lines[0][1]]);
  assert.ok(levels.line > 0.005 && levels.line > 20 * levels.after, JSON.stringify(levels));

  // The draft survives a reload, and so does the notice.
  await page.reload();
  assert.equal(await page.isVisible("#app"), true);
  assert.equal(await page.inputValue("#story"), STORY);

  assert.deepEqual(errors, []);
  assert.equal(navigations, 2, "only the load and the deliberate reload");
  console.log(`film-browser: ok (${film.lines.length} lines, 1 recorded, 3 in the phone's voice, ${film.length.toFixed(1)} s, video ${video.ext}+${video.audio})`);
} finally {
  await browser.close();
  srv.close();
}
