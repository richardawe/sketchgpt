// Scene mode in a real page: a desktop model gets the list prompt and the page
// composes the picture; a phone keeps the coordinate prompt proven on one.
//
//   node tests/scene-browser.mjs
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return { interruptGenerate() {},
 chat: { completions: { async create(req) { window.requests.push(req);
 return (async function* () { yield { choices: [{ delta: { content: window.result } }] }; })(); } } } }; }`;

const PLAN = JSON.stringify({ t: 'A cosy cabin in the woods at night',
  c: ['cabin x1', 'moon x1 sky', 'star x2 back', 'fire x1 front', 'tree x3 green', 'yeti'] });

const browser = await launch();
try {
  for (const [who, touch, query, wantScene] of [
    ['desktop', false, '', true], ['phone', true, '', false], ['desktop ?scene=0', false, '&scene=0', false]]) {
    const context = await browser.newContext(touch
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' }
      : { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(plan => {
      Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
        features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 } }) } });
      // A normal disk. Headless Chromium here offers ~0.9 GB, which makes the page
      // (correctly) pick a smaller model than a real desktop gets.
      if (navigator.storage) navigator.storage.estimate = async () => ({ quota: 50e9, usage: 0 });
      window.requests = []; window.result = plan;
      localStorage.setItem('sketchgpt.cfg', JSON.stringify({ output: 'sketch' }));
    }, PLAN);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/mock.mjs') return route.fulfill({ contentType: 'text/javascript', body: stub });
      const name = url.pathname.replace(/^.*\//, '');
      const file = /^(sketch|stamps|rough|book|story|picture|gif|video|scene|art|art-names)\.mjs$/.test(name) ? name : 'browser.html';
      await route.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
        body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
    });
    await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs&manual=1' + query);
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
    await page.click('#load');
    await page.waitForFunction(() => !document.querySelector('#send').disabled);
    const send = async text => {
      await page.fill('#input', text);
      await page.click('#send');
      await page.waitForFunction(() => !document.querySelector('#send').disabled &&
        !/generating/.test(document.querySelector('#status').textContent));
    };

    await send('Draw a cosy cabin in the woods at night');
    const system = await page.evaluate(() => window.requests.at(-1).messages[0].content);
    if (!wantScene) {
      assert.match(system, /^Draw the user's request/, `${who}: expected the coordinate prompt`);
      await context.close();
      continue;
    }
    assert.match(system, /^Plan the user's picture/, `${who}: expected the scene prompt`);
    const req = await page.evaluate(() => window.requests.at(-1));
    assert.ok(req.max_tokens <= 320, `a scene plan was given ${req.max_tokens} tokens`);

    // The page composed a picture from the list: a night sky, the ground,
    // and the things the model named, placed.
    const msg = page.locator('.msg.assistant').last();
    const commands = await msg.locator('details textarea').inputValue();
    assert.match(commands, /^sky night$/m);
    assert.match(commands, /^ground \d+/m);
    assert.match(commands, /^house [\d.]+ [\d.]+ [\d.]+/m, 'the cabin was not drawn');
    assert.equal((commands.match(/^tree-deciduous /gm) || []).length, 3, 'three trees were asked for');
    assert.match(commands, /^label .* yeti$/m, 'a thing with no drawing must stay a word');
    assert.ok(await msg.locator('svg path').count() > 40, 'the picture is nearly empty');
    // Drawn with the illustrations, and the CC-BY credit travels inside the
    // SVG, so a downloaded drawing carries it.
    assert.match(await msg.locator('svg desc').textContent(), /Twemoji .* CC-BY 4\.0/);
    const note = await msg.locator('.note').last().textContent();
    assert.match(note, /The model listed: cabin x1/);
    assert.match(note, /The page placed them/);
    assert.match(note, /No drawing for "yeti"/);

    // A revision is planned from the model's LIST, not from the page's
    // coordinates: the plan is the language the model wrote in.
    await send('add a dog');
    const seed = await page.evaluate(() => window.requests.at(-1).messages.map(m => m.content).join('\n'));
    assert.match(seed, /cabin x1/, 'the previous plan was not carried into the revision');
    assert.doesNotMatch(seed, /sky night|ground \d+/, 'the page\'s own coordinates leaked into the prompt');

    // A model that answers in coordinates anyway is drawn as it is.
    await page.evaluate(() => { window.result = JSON.stringify({ t: 'A house', c: ['house 25 55 40', 'tree 78 50 34'] }); });
    await send('Draw a house and a tree');
    const plain = await page.locator('.msg.assistant').last().locator('details textarea').inputValue();
    assert.match(plain, /^house 25 55 40$/m);
    assert.doesNotMatch(plain, /^sky /m);

    assert.deepEqual(errors, [], `${who}: page errors: ${errors.join('; ')}`);
    await context.close();
  }
  console.log('Scene checks passed: desktop gets the list prompt and a composed picture, unknown things ' +
    'stay words, revisions carry the plan, coordinate answers pass through, phones and ?scene=0 keep coordinates.');
} finally { await browser.close(); }
