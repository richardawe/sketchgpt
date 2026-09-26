// Film (web/film.html) on a touch screen: the adult notice; four tabs (Write,
// Cast, Script, Watch); prose in; pronouns asked with a tap; guesses shown and
// correctable; a look and a costume chosen; no voice recorder anywhere; the
// scene played on the shared stage with the camera on whoever speaks and every
// line in the phone's voice (a stand-in speechSynthesis that records what it
// was asked to say); real garments on the people, the skin under them hidden,
// a skirt that moves with the legs; and a video with subtitles.
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… node tests/film-browser.mjs
//
// SwiftShader draws; speed means nothing here (film-probe.html measures phones).
import assert from "node:assert/strict";
import { serve } from "./serve.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const srv = await serve(new URL("../web", import.meta.url).pathname);
const browser = await chromium.launch({ headless: true, ...(process.env.SKETCH_CHROME ? { executablePath: process.env.SKETCH_CHROME } : {}),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
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

const tab = name => page.tap(`.tabs [data-tab="${name}"]`);
const pane = () => page.evaluate(() => [...document.querySelectorAll(".pane")].filter(p => getComputedStyle(p).display !== "none").map(p => p.dataset.pane));

try {
  await page.goto(srv.url + "film.html?width=180&fps=4");
  // The adult notice comes first, and once agreed is remembered.
  assert.equal(await page.isVisible("#gate"), true);
  assert.equal(await page.isVisible("#app"), false);
  await page.tap("#enter");
  assert.equal(await page.isVisible("#app"), true);
  assert.deepEqual(await pane(), ["write"], "one tab at a time on a phone");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, "nothing wider than the phone");
  // No recorder: the phone's voices are the only voices.
  assert.equal(await page.locator("text=/Record/").count(), 0);
  assert.equal(await page.evaluate(() => /getUserMedia|MediaRecorder/.test(document.documentElement.innerHTML)), false);

  await page.fill("#story", STORY);
  await page.waitForFunction(() => window.__film.state.story?.cast.some(c => c.name === "Ruth"));
  // No pronouns yet: "she" is given to nobody, the page says why, and Cast shows how many to answer.
  let s = await page.evaluate(() => window.__film.state.story);
  assert.deepEqual(s.cast.map(c => c.name).sort(), ["Ruth", "Sam"]);
  assert.equal(s.scenes[0].beats.find(b => b.kind === "line").speaker, null);
  assert.equal(await page.textContent("#castDot"), "2");
  await page.tap("#toCast");
  assert.deepEqual(await pane(), ["cast"]);
  await page.tap('button[data-pronoun="Ruth"][data-value="she"]');
  await page.tap('button[data-pronoun="Sam"][data-value="they"]');
  assert.equal(await page.isVisible("#castDot"), false, "every pronoun answered");
  assert.equal(await page.getAttribute('button[data-pronoun="Ruth"][data-value="she"]', "aria-pressed"), "true");
  s = await page.evaluate(() => window.__film.state.story);
  const lines = s.scenes.flatMap(x => x.beats).filter(b => b.kind === "line");
  assert.deepEqual(lines.map(l => [l.speaker, l.how]), [["Ruth", "tag"], ["Sam", "paragraph"], ["Ruth", "guessed"], ["Sam", "paragraph"]]);
  assert.deepEqual(s.scenes.flatMap(x => x.beats).filter(b => b.kind === "action").map(b => `${b.who}:${b.move}`), ["Ruth:sit", "Ruth:hold", "Sam:enter", "Sam:no"]);

  // The script: the guess is shown, highlighted, and can be changed; the change wins.
  await tab("script");
  assert.equal(await page.locator(".line.guessed").count(), 1);
  assert.match(await page.textContent(".line.guessed"), /guess.*There's no traffic/s);
  await page.selectOption(".line.guessed select", "Sam");
  s = await page.evaluate(() => window.__film.state.story);
  assert.deepEqual(s.scenes[0].beats.filter(b => b.kind === "line").map(l => [l.speaker, l.how])[2], ["Sam", "chosen"]);
  await page.selectOption('.line:has-text("no traffic") select', "Ruth");
  assert.match(await page.textContent("#check"), /Ruth sits/);

  // Ruth's own look: skin, hair, the dress's colour. The menu says it's her own now.
  await tab("cast");
  assert.equal(await page.inputValue('select[data-lk="costume"][data-who="Ruth"]'), "dress", "she: the first woman's look, in a dress");
  await page.tap('details[data-lookof="Ruth"] summary');
  await page.selectOption('select[data-lk="skin"][data-who="Ruth"]', "light");
  await page.selectOption('select[data-lk="hair"][data-who="Ruth"]', "buzzed-female");
  await page.fill('input[data-lk="top"][data-who="Ruth"]', "#d8b12a");
  assert.equal(await page.evaluate(() => document.querySelector('select[data-look="Ruth"]').selectedOptions[0].textContent), "Your own look");
  assert.deepEqual(await page.evaluate(() => { const l = window.__film.state.looks.Ruth; return [l.skin, l.hair, l.outfit.top, l.costume]; }), ["light", "buzzed-female", "#d8b12a", "dress"]);
  // Sam's clothes: a suit.
  await page.selectOption('select[data-lk="costume"][data-who="Sam"]', "suit");
  assert.equal(await page.evaluate(() => window.__film.state.looks.Sam.costume), "suit");
  assert.match(await page.textContent('[data-person="Sam"] header'), /Suit/);

  // Voices: each person a different phone voice by default; a pitch per person, heard when chosen.
  const ruthVoice = await page.inputValue('select[data-voice="Ruth"]'), samVoice = await page.inputValue('select[data-voice="Sam"]');
  assert.ok(ruthVoice && samVoice && ruthVoice !== samVoice, `${ruthVoice} / ${samVoice}`);
  await page.tap('button[data-pitch="Sam"][data-value="deeper"]');
  assert.match((await page.evaluate(() => window.__said.at(-1))).text, /This is Sam/, "choosing a pitch lets you hear it");
  await page.tap('button[data-try="Ruth"]');
  assert.match((await page.evaluate(() => window.__said.at(-1))).text, /This is Ruth/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, "the cast fits the phone");

  // Watch: the stage loads, every line is shot on its speaker, and heard in the phone's voice.
  await tab("watch");
  assert.equal(await page.isChecked("#music"), false, "music is off unless asked for");
  assert.match(await page.textContent("#length"), /^0:\d\d \/ 2:00$/);
  await page.evaluate(() => { window.__said.length = 0; });
  await page.tap("#play");
  await page.waitForFunction(() => window.__film.state.stage, null, { timeout: 240000 });
  await page.waitForFunction(() => window.__film.state.playing === false && window.__film.heard, null, { timeout: 180000 });
  const film = await page.evaluate(() => window.__film.state.film);
  const heard = await page.evaluate(() => window.__film.heard.filter(h => h.how === "voice"));
  const said = await page.evaluate(() => window.__said.filter(x => x.volume !== 0));
  assert.equal(heard.length, film.lines.length, "every line is spoken");
  assert.deepEqual(said.map(x => x.text), film.lines.map(l => l[3]), "every line, in order, in the phone's voice");
  film.lines.forEach((l, i) => {
    assert.equal(heard[i].voice, l[2] === "Sam" ? samVoice : ruthVoice, `${l[2]}'s voice`);
    assert.equal(heard[i].pitch, l[2] === "Sam" ? 0.75 : 1, `${l[2]}'s pitch`);
  });
  assert.equal(await page.evaluate(() => window.__film.state.ttsBlocked), false);
  const shots = await page.evaluate(ls => ls.map(([a, b]) => window.__film.still((a + b) / 2)), film.lines);
  assert.deepEqual(shots, film.lines.map(l => l[2]));
  assert.equal(await page.evaluate(() => window.__film.still(0.5)), "wide");

  // The costumes are real garments: Ruth's dress (a top, a skirt that hangs, shoes), Sam's suit
  // (shirt, jacket, trousers, shoes); the skin under them isn't drawn; her skin is lighter.
  const dressed = await page.evaluate(() => {
    const out = {};
    for (const [name, p] of Object.entries(window.__film.state.stage.world.cast)) {
      const cloth = [], drape = [];
      let gain = null, covered = 0, bare = 0;
      p.body.traverse(o => {
        if (o.name === "costume") cloth.push(o.geometry.attributes.position.count);
        if (o.name === "costume-drape") drape.push(o);
        const c = o.isSkinnedMesh && o.geometry.attributes.cover;
        if (c) { gain = o.material.color.r; for (let i = 0; i < c.count; i++) c.getX(i) < -0.02 ? covered++ : bare++; }
      });
      out[name] = { cloth, drapes: drape.length, gain, covered, bare };
    }
    return out;
  });
  assert.equal(dressed.Ruth.cloth.length, 3, "dress top, briefs, shoes");
  assert.equal(dressed.Ruth.drapes, 1, "and a skirt");
  assert.equal(dressed.Sam.cloth.length, 4, "shirt, jacket, trousers, shoes");
  assert.equal(dressed.Sam.drapes, 0);
  assert.ok(dressed.Ruth.cloth.every(n => n > 50) && dressed.Sam.cloth.every(n => n > 50), JSON.stringify(dressed));
  // (Counted in vertices, where a head and hands are dense.)
  const share = p => p.covered / (p.covered + p.bare);
  assert.ok(share(dressed.Sam) > 0.3 && share(dressed.Sam) > share(dressed.Ruth) + 0.1, `a suit covers more than a sleeveless dress: ${share(dressed.Sam).toFixed(2)} vs ${share(dressed.Ruth).toFixed(2)}`);
  assert.ok(dressed.Ruth.gain > 1.3, `skin gain ${dressed.Ruth.gain}`);
  // The skirt moves with her: posed at two moments, it isn't in the same place.
  const skirt = await page.evaluate(ts => ts.map(t => { window.__film.still(t); let p = null; window.__film.state.stage.world.cast.Ruth.body.traverse(o => { if (o.name === "costume-drape") p = Array.from(o.geometry.attributes.position.array); }); return p; }), [0.3, film.lines[0][0], film.length - 0.5]);
  const moved = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  assert.ok(Math.max(moved(skirt[0], skirt[1]), moved(skirt[1], skirt[2])) > 0.01, `the skirt follows the pose: ${moved(skirt[0], skirt[1])}, ${moved(skirt[1], skirt[2])}`);

  // Subtitles are drawn into the picture: bright text at the bottom during a line, none after the last.
  const bright = await page.evaluate(ts => ts.map(t => {
    window.__film.still(t);
    const c = document.getElementById("out"), d = c.getContext("2d").getImageData(0, Math.round(c.height * 0.8), c.width, Math.round(c.height * 0.15)).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) n++; return n;
  }), [(film.lines[0][0] + film.lines[0][1]) / 2, film.length - 0.3]);
  assert.ok(bright[0] > 20 && bright[1] < bright[0] / 4, `subtitle pixels ${bright}`);

  // The video: every frame of the film, with a sound track.
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

  // The draft survives a reload, and so do the looks.
  await page.reload();
  assert.equal(await page.isVisible("#app"), true);
  assert.equal(await page.inputValue("#story"), STORY);
  await page.waitForFunction(() => window.__film.state.looks.Ruth);
  assert.equal(await page.evaluate(() => window.__film.state.looks.Ruth.hair), "buzzed-female", "her look is kept on this device");
  assert.equal(await page.evaluate(() => window.__film.state.looks.Sam.costume), "suit");

  assert.deepEqual(errors, []);
  assert.equal(navigations, 2, "only the load and the deliberate reload");
  console.log(`film-browser: ok (${film.lines.length} lines in the phone's voice, ${film.length.toFixed(1)} s; Ruth ${dressed.Ruth.cloth.length}+1 garments, Sam ${dressed.Sam.cloth.length}; subtitles ${bright[0]} px; video ${video.ext}+${video.audio})`);
} finally {
  await browser.close();
  srv.close();
}
