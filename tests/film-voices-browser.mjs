// Film's "Voices in the video" (web/film.html + web/film/voices.mjs) on a touch
// screen, with the real Kokoro model running in the tab:
//   - off by default, and while off nothing is fetched from Hugging Face or jsdelivr
//     and the saved video is silent where people speak;
//   - on: each person gets a different video voice, by pronoun, shown in Cast;
//   - the lines are spoken before the video, each line lasts as long as its voice,
//     and the saved video's sound is loud where every line is;
//   - the voices move the mouths (the stage's speech envelopes come from them);
//   - only GETs of the model's own files leave the tab, never the words;
//   - the switch survives a reload.
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… node tests/film-voices-browser.mjs
//
// Kokoro's files (~115 MB) are fetched once with curl into KOKORO_MIRROR (see
// tests/kokoro-mirror.mjs). Speed here means nothing: one CPU core, no phone.
import assert from "node:assert/strict";
import { serve } from "./serve.mjs";
import { fetchMirror, mirror } from "./kokoro-mirror.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const dir = fetchMirror();
const srv = await serve(new URL("../web", import.meta.url).pathname);
const browser = await chromium.launch({ headless: true, ...(process.env.SKETCH_CHROME ? { executablePath: process.env.SKETCH_CHROME } : {}),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const asked = await mirror(context, dir);
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));

const STORY = `Ruth sat on the sofa with a drink.

"You're late," she said.

Sam came in. "Traffic."

"There's no traffic at two in the morning," Ruth said.

"Then I walked," Sam said.`;
const tab = name => page.tap(`.tabs [data-tab="${name}"]`);

// Loudness of the saved video's sound in each line's middle, and the line windows.
const loudness = () => page.evaluate(async () => {
  const src = document.querySelector("#result video").src;
  const data = await (await fetch(src)).arrayBuffer();
  const buf = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(data);
  const d = buf.getChannelData(0), rate = buf.sampleRate;
  const rms = (a, b) => { let s = 0, n = 0; for (let i = Math.floor(a * rate); i < Math.min(d.length, Math.floor(b * rate)); i++) { s += d[i] * d[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };
  return window.__film.state.film.lines.map(([a, b]) => rms(a + 0.15, Math.max(a + 0.3, b - 0.3)));
});
const makeVideo = async () => {
  await page.evaluate(() => { window.__film.video = null; });
  await page.tap("#make");
  await page.waitForFunction(() => window.__film.video, null, { timeout: 900000 });
  const v = await page.evaluate(() => window.__film.video);
  assert.equal(v.ok, true, v.error);
  return v;
};

try {
  await page.goto(srv.url + "film.html?width=180&fps=4");
  await page.tap("#enter");
  await page.fill("#story", STORY);
  await page.waitForFunction(() => window.__film.state.story?.cast.length === 2);
  await tab("cast");
  await page.tap('button[data-pronoun="Ruth"][data-value="she"]');
  await page.tap('button[data-pronoun="Sam"][data-value="he"]');

  // 1. Off by default: no video-voice rows, the note says so, and nothing is fetched.
  assert.equal(await page.locator("select[data-aivoice]").count(), 0);
  await tab("watch");
  assert.equal(await page.isChecked("#aivoice"), false);
  assert.match(await page.textContent("#aistate"), /without voices/);
  await page.uncheck("#fx");
  await page.tap("#play");
  await page.waitForFunction(() => window.__film.state.stage && !document.querySelector("#make").disabled, null, { timeout: 300000 });
  if (await page.isVisible("#stop")) await page.tap("#stop");
  await page.waitForFunction(() => !window.__film.state.playing);
  const silent = await makeVideo();
  assert.deepEqual(silent.voices, []);
  const quiet = await loudness();
  assert.equal(asked.length, 0, "nothing fetched while the switch is off: " + asked.join(", "));
  const lengthBefore = await page.evaluate(() => window.__film.state.film.length);

  // 2. On: a different voice for each, by pronoun, in Cast.
  await page.check("#aivoice");
  assert.match(await page.textContent("#aistate"), /voices/);
  await tab("cast");
  const ruth = await page.inputValue('select[data-aivoice="Ruth"]'), sam = await page.inputValue('select[data-aivoice="Sam"]');
  assert.ok(ruth.startsWith("af_") || ruth.startsWith("bf_"), ruth);
  assert.ok(sam.startsWith("am_") || sam.startsWith("bm_"), sam);
  await page.selectOption('select[data-aivoice="Sam"]', "bm_george");
  assert.equal(await page.evaluate(() => window.__film.state.story.aiVoices.Sam), "bm_george", "a chosen voice wins");

  // 3. The video: every line spoken first, the film re-timed to the voices, the voices in its sound.
  await tab("watch");
  const v = await makeVideo();
  const film = await page.evaluate(() => window.__film.state.film);
  const named = film.lines.filter(l => l[2]);
  assert.equal(v.voices.length, named.length, "every line has its voice in the video");
  const clips = await page.evaluate(() => window.__film.state.film.lines.map(l => {
    const c = window.__film.state.clips[window.__film.state.story.aiVoices[l[2]] + "\n" + l[3]];
    return c && c.buffer.duration;
  }));
  film.lines.forEach((l, i) => assert.ok(Math.abs(l[1] - l[0] - (clips[i] + 0.15)) < 0.02, `line ${i} lasts its voice: ${(l[1] - l[0]).toFixed(2)} vs ${clips[i]}`));
  assert.notEqual(film.length, lengthBefore, "the film is re-timed to the voices");
  const loud = await loudness();
  loud.forEach((x, i) => assert.ok(x > 0.02 && x > quiet[i] * 5, `line ${i}: ${x.toFixed(3)} with voices, ${quiet[i]?.toFixed(3)} without`));

  // 4. The voices move the mouths: one speech envelope per spoken line, from the audio.
  const env = await page.evaluate(() => Object.values(window.__film.state.stage.speech).map(e => [e.length, Math.max(...e)]));
  assert.equal(env.length, named.length);
  assert.ok(env.every(([n, peak]) => n > 10 && peak === 1), JSON.stringify(env));

  // 5. Only the model's own files were fetched, with GET, and never the words.
  assert.ok(asked.length > 0);
  assert.ok(asked.every(a => /^GET (huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/|cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@3\.5\.1\/dist\/)/.test(a)), asked.join("\n"));
  assert.ok(!asked.some(a => /late|traffic|walked/i.test(a)));

  const voicesMs = await page.evaluate(() => window.__film.voicesMs || 0);

  // 6. Kept on this device.
  await page.reload();
  await page.waitForFunction(() => window.__film.state.story?.cast.length === 2);
  assert.equal(await page.isChecked("#aivoice"), true);
  assert.equal(await page.evaluate(() => window.__film.state.story.aiVoices.Sam), "bm_george");

  assert.deepEqual(errors, []);
  console.log(`film-voices-browser: ok (${named.length} lines spoken, voices ${ruth}/${sam}→bm_george, film ${lengthBefore.toFixed(1)} → ${film.length.toFixed(1)} s, voice loudness ${loud.map(x => x.toFixed(2))} vs ${quiet.map(x => x.toFixed(3))}; voices made in ${(voicesMs / 1000).toFixed(0)} s here)`);
} finally {
  asked.close();
  await browser.close();
  srv.close();
}
