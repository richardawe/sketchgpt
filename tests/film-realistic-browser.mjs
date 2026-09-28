// Film's "Realistic" style (Microsoft Rocketbox people acted by Film's moves) on a
// touch screen: the Style switch; who plays whom (by pronoun, and chosen);
// the person really follows the unseen driver (hand, feet, a held prop in their
// own hand); the jaw opens with the voice and the eyelids blink; the choice
// survives a reload and travels in a link; the video renders; and switching
// back to Stylised brings the made-on-the-page costumes back.
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… node tests/film-realistic-browser.mjs
import assert from "node:assert/strict";
import { serve } from "./serve.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const STORY = `Maya sat in the kitchen with a drink.

"You're late," she said.

Tom came in. "Traffic," he said.

"There's no traffic at two in the morning."`;

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
  assert.equal(await page.locator('select[data-real]').count(), 0, "Stylised by default");
  await page.tap('button[data-style="film"][data-value="realistic"]');
  // Realistic: who plays whom, by pronoun; no costume or hair controls.
  assert.equal(await page.locator('select[data-lk="costume"]').count(), 0);
  const offered = await page.evaluate(() => [...document.querySelectorAll('select[data-real="Tom"] option')].map(o => o.value));
  assert.ok(offered.length >= 4 && offered.every(id => /Male_/.test(id) && !/Female/.test(id)), `he: men only — ${offered}`);
  assert.match(await page.inputValue('select[data-real="Maya"]'), /Female/);
  await page.selectOption('select[data-real="Tom"]', "Police_Male_01");
  assert.match(await page.textContent('[data-person="Tom"] header'), /Police officer/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, "fits the phone");

  await load(page);
  const cast = await page.evaluate(() => {
    const c = window.__film.state.stage.world.cast, out = {};
    for (const [n, p] of Object.entries(c)) {
      let driverShown = false, personMeshes = 0;
      p.body.traverse(o => { if (o.isSkinnedMesh && o.visible) driverShown = true; });
      p.person?.traverse(o => { if (o.isSkinnedMesh) personMeshes++; });
      out[n] = { who: p.person?.children[0]?.name || p.person?.name, driverShown, personMeshes };
    }
    return out;
  });
  assert.equal(cast.Tom.driverShown, false, "the driver is never seen");
  assert.ok(cast.Tom.personMeshes > 0 && cast.Maya.personMeshes > 0, JSON.stringify(cast));
  assert.equal(cast.Tom.who, "Police_Male_01");

  // The person follows the driver: hands and feet land where the moves put them, at every moment.
  const film = await page.evaluate(() => window.__film.state.film);
  const follow = await page.evaluate(ts => ts.map(t => {
    window.__film.still(t);
    const st = window.__film.state.stage, T = st.T, gap = {};
    for (const [n, p] of Object.entries(st.world.cast)) {
      if (!p.holder.visible) continue;
      const bone = (root, name) => { let b = null; root.traverse(o => { if (o.isBone && o.name === name) b = o; }); return b.getWorldPosition(new T.Vector3()); };
      gap[n] = { hand: bone(p.body, "hand_r").distanceTo(bone(p.person, "Bip01_R_Hand")), foot: bone(p.body, "foot_l").distanceTo(bone(p.person, "Bip01_L_Foot")), hand_y: bone(p.person, "Bip01_R_Hand").y };
      const glass = p.held.glass;
      // Gripped as designed, in the person's own hand: exactly the grip's distance from that hand.
      if (glass?.visible) gap[n].glass = Math.abs(glass.getWorldPosition(new T.Vector3()).distanceTo(bone(p.person, "Bip01_R_Hand")) - glass.userData.grip.length());
    }
    return gap;
  }), [0.5, film.lines[0][0] + 0.3, film.lines[1][0] + 0.3, film.length - 0.3]);
  for (const g of follow) for (const [n, v] of Object.entries(g)) {
    assert.ok(v.hand < 0.2 && v.foot < 0.2, `${n} strays from the moves: ${JSON.stringify(v)}`);
    if (v.glass !== undefined) assert.ok(v.glass < 0.01, `${n}'s glass is off their hand's grip by ${v.glass}`);
  }
  assert.ok(follow.some(g => g.Maya?.glass !== undefined), "Maya holds her drink");
  const handYs = follow.map(g => g.Maya?.hand_y).filter(v => v !== undefined);
  assert.ok(Math.max(...handYs) - Math.min(...handYs) > 0.02, `Maya's hand moves: ${handYs}`);

  // The face: the speaker's jaw opens with the voice; eyelids blink.
  const face = await page.evaluate(line => {
    const st = window.__film.state.stage, p = st.world.cast[line[2]], T = st.T;
    let lip = null, head = null; p.person.traverse(o => { if (o.name === "Bip01_MBottomLip") lip = o; if (o.name === "Bip01_Head") head = o; });
    const drop = say => { st.speech = { 0: new Float32Array(9999).fill(say) }; st.speechCache = {}; window.__film.still((line[0] + line[1]) / 2); return head.getWorldPosition(new T.Vector3()).y - lip.getWorldPosition(new T.Vector3()).y; };
    const shut = drop(1) - drop(0);
    st.speech = {};
    // One pose held; only the blink clock moves, so a nod can't pass for a blink.
    window.__film.still(line[0] + 0.1);
    const ys = []; for (let t = 0; t < 4.2; t += 0.035) { p.after(0, t); ys.push(p.lidY()); }
    return { jaw: shut, lidTravel: Math.max(...ys) - Math.min(...ys) };
  }, film.lines[0]);
  assert.ok(face.jaw > 0.008, `the jaw opens ${face.jaw.toFixed(4)} m`);
  assert.ok(face.lidTravel > 0.0015, `the eyelids blink ${face.lidTravel.toFixed(4)} m`);

  // A held moment: the speaking head doesn't drift (the stylised bug, checked here too).
  const drift = await page.evaluate(([a, b, who]) => {
    const st = window.__film.state.stage; let head = null; st.world.cast[who].person.traverse(o => { if (o.name === "Bip01_Head") head = o; });
    window.__film.still((a + b) / 2); const q0 = head.getWorldQuaternion(new st.T.Quaternion());
    for (let i = 0; i < 40; i++) window.__film.still((a + b) / 2);
    return head.getWorldQuaternion(new st.T.Quaternion()).angleTo(q0);
  }, film.lines[0]);
  assert.ok(drift < 1e-3, `held head drifts ${drift}`);

  // The video.
  await page.evaluate(() => { window.__film.video = null; });
  await page.tap("#make");
  await page.waitForFunction(() => window.__film.video, null, { timeout: 300000 });
  const video = await page.evaluate(() => window.__film.video);
  assert.equal(video.ok, true, video.error);
  assert.equal(video.frames, Math.round(film.length * 4));

  // The choice is kept on this device, and travels in a link.
  await page.reload();
  await page.waitForFunction(() => window.__film.state.story);
  assert.equal(await page.evaluate(() => window.__film.state.style), "realistic");
  assert.equal(await page.evaluate(() => window.__film.state.people.Tom), "Police_Male_01");
  await show(page, "watch");
  await page.tap("#sharelink");
  await page.waitForFunction(() => window.__film.link);
  const link = await page.evaluate(() => window.__film.link);
  const other = await newPage();
  await other.goto(link);
  await other.tap("#enter");
  await other.waitForFunction(() => window.__film.state.fromLink);
  assert.equal(await other.evaluate(() => window.__film.state.style), "realistic");
  await show(other, "cast");
  assert.equal(await other.inputValue('select[data-real="Tom"]'), "Police_Male_01", "the link carries who plays whom");

  // Back to Stylised: the stage reloads with costumes.
  await show(page, "cast");
  await page.tap('button[data-style="film"][data-value="stylised"]');
  await load(page);
  const back = await page.evaluate(() => { let costumes = 0, people = 0; for (const p of Object.values(window.__film.state.stage.world.cast)) { if (p.person) people++; p.body.traverse(o => { if (/^costume/.test(o.name)) costumes++; }); } return { costumes, people }; });
  assert.ok(back.costumes > 0 && back.people === 0, JSON.stringify(back));

  assert.deepEqual(errors, []);
  console.log(`film-realistic-browser: ok (Tom as Police_Male_01, glass within ${Math.max(...follow.map(g => g.Maya?.glass ?? 0)).toFixed(4)} m of its grip, hands within ${Math.max(...follow.flatMap(g => Object.values(g).map(v => v.hand))).toFixed(3)} m, jaw ${face.jaw.toFixed(3)} m, blink ${face.lidTravel.toFixed(3)} m, video ${video.frames} frames)`);
} finally {
  await browser.close();
  srv.close();
}
