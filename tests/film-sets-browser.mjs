// Film stage 2 (web/film/stage.mjs + web/film.mjs SETS): a story across six
// places plays on six sets — each scene shows only its own set, in the light
// its words give it; props are in hands when the words put them there; a bar
// stool lifts whoever sits on it; and the whole film renders to video.
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… node tests/film-sets-browser.mjs
import assert from "node:assert/strict";
import { serve } from "./serve.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const STORY = `Maya sat in the kitchen with a drink.

"You're up early," said Tom.

That night, Tom waited in the bedroom. Maya sat on the bed.

"Well?" said Maya.

The next morning, Tom sat at his desk in the office.

"Who called?" Tom asked.

That evening, in the bar, Maya sat down with a drink.

"Another," said Maya.

Later, Tom walked down the street. He drew a gun.

"Stop," said Tom.

At dawn, Maya waited in the park. Her phone rang. She answered the phone.

"It's done," Maya whispered.`;

const srv = await serve(new URL("../web", import.meta.url).pathname);
const browser = await chromium.launch({ headless: true, ...(process.env.SKETCH_CHROME ? { executablePath: process.env.SKETCH_CHROME } : {}),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));

try {
  await page.goto(srv.url + "film.html?width=180&fps=4");
  await page.tap("#enter");
  await page.fill("#story", STORY);
  await page.waitForFunction(() => window.__film.state.story?.scenes.length === 6);
  await page.selectOption('select[data-pronoun="Maya"]', "she");
  await page.selectOption('select[data-pronoun="Tom"]', "he");
  const film = await page.evaluate(() => window.__film.state.film);
  assert.deepEqual(film.sets.map(s => `${s.set}/${s.light}`),
    ["kitchen/day", "bedroom/night", "office/day", "bar/evening", "street/evening", "park/dawn"]);
  assert.match(await page.textContent("#check"), /Scene 2 bedroom · night/);

  await page.tap("#play");
  await page.waitForFunction(() => window.__film.state.stage, null, { timeout: 240000 });
  await page.tap("#stop");
  await page.waitForFunction(() => !window.__film.state.playing);

  // Each scene: only its set is shown, in its light; the sky only outside, and not at night.
  const seen = await page.evaluate(sets => sets.map(({ start, set }) => {
    window.__film.still(start + 1);
    const w = window.__film.state.stage.world;
    const visible = Object.entries(w.sets).filter(([, s]) => s.group.visible).map(([n]) => n);
    const scene = w.key.parent;
    return { visible, sky: !!scene.background?.isTexture, env: +scene.environmentIntensity.toFixed(3) };
  }), film.sets);
  seen.forEach((s, i) => assert.deepEqual(s.visible, [film.sets[i].set], `scene ${i + 1} shows ${s.visible}`));
  assert.deepEqual(seen.map(s => s.sky), [false, false, false, false, true, true], "the sky shows outside (dimmed at evening and dawn), never in a room");
  assert.ok(seen[1].env < seen[0].env, "night is darker than day");

  // Props in hands, when the words say so; and the bar stool lifts Maya.
  const at = await page.evaluate(() => {
    const f = window.__film.state.film, w = window.__film.state.stage.world;
    const mid = text => { const l = f.lines.find(x => x[3] === text); return (l[0] + l[1]) / 2; };
    const shown = (who, t) => { window.__film.still(t); return Object.entries(w.cast[who].held).filter(([, o]) => o.visible).map(([k]) => k); };
    const phone = f.actions.find(a => a[3] === "phone");
    return {
      kitchen: shown("Maya", mid("You're up early")),
      bar: shown("Maya", mid("Another")), barLift: +w.cast.Maya.holder.position.y.toFixed(2),
      street: shown("Tom", mid("Stop")),
      park: shown("Maya", (phone[0] + phone[1]) / 2), parkAfter: shown("Maya", mid("It's done")),
      office: shown("Tom", mid("Who called?")), officeLift: (window.__film.still(mid("Who called?")), +w.cast.Tom.holder.position.y.toFixed(2)),
    };
  });
  assert.deepEqual(at.kitchen, ["glass"], "“sat … with a drink”");
  assert.deepEqual(at.bar, ["glass"]);
  assert.equal(at.barLift, 0.4, "lifted onto the bar stool");
  assert.equal(at.officeLift, 0, "an office chair is chair height");
  assert.deepEqual(at.street, ["gun"], "drawn, and still in hand");
  assert.deepEqual(at.park, ["phone"]);
  assert.deepEqual(at.parkAfter, [], "the phone is put away");
  assert.deepEqual(at.office, [], "a new scene empties hands");

  // Every set is drawn: a frame from each scene has plenty of colours.
  const colours = await page.evaluate(sets => sets.map(({ start }) => {
    window.__film.still(start + 1.5);
    const c = document.getElementById("out"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 5) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3);
    return seen.size;
  }), film.sets);
  colours.forEach((n, i) => assert.ok(n > 150, `scene ${i + 1} has ${n} colours`));

  await page.tap("#make");
  await page.waitForFunction(() => window.__film.video, null, { timeout: 600000 });
  const video = await page.evaluate(() => window.__film.video);
  assert.equal(video.ok, true, video.error);
  assert.equal(video.frames, Math.round(film.length * 4));

  assert.deepEqual(errors, []);
  console.log(`film-sets-browser: ok (6 scenes on 6 sets, ${film.length.toFixed(1)} s, props and lift right, video ${video.frames} frames)`);
} finally {
  await browser.close();
  srv.close();
}
