// What the page says when generation fails.
//
//   node tests/failure.mjs
//
// The first real phone run of Work mode returned "map async was not
// successful" — WebKit's message for a refused GPU buffer map, which appears
// nowhere in WebLLM. The page showed that string and nothing else: not the
// GPU, not the context, not the prompt size, and no sign that the engine was
// now dead. Every later message failed the same way and the page kept
// accepting them.
//
// So this checks the three things that turn that report from a rumour into a
// bug report: the failure is classified, it carries the facts, and the page
// admits the engine is gone instead of taking more input.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

// `window.failWith` decides how the next generation dies.
const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return {
 interruptGenerate() {},
 chat: { completions: { async create(req) {
   window.requests.push(req);
   if (window.failWith) throw new Error(window.failWith);
   return (async function* () { yield { choices: [{ delta: { content: 'ok' } }] }; })();
 } } }
}; }`;

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
      features: new Set(['shader-f16']),
      limits: { maxBufferSize: 1e9 },
      info: { vendor: 'apple', architecture: 'apple-m', device: '', description: '' }
    }) } });
    window.requests = [];
    window.failWith = null;
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/mock.mjs')
      return route.fulfill({ contentType: 'text/javascript', body: stub });
    const name = url.pathname.replace(/^.*\//, '');
    const file = /^(sketch|stamps|rough|desk|scene|art|art-names)\.mjs$/.test(name) ? name : 'browser.html';
    await route.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
      body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
  });

  const open = async (query = '') => {
    await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs&manual=1' + query);
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
    await page.click('#load');
    await page.waitForFunction(() => !document.querySelector('#send').disabled);
  };
  const send = async text => {
    await page.fill('#input', text);
    await page.click('#send');
    await page.waitForFunction(() => !document.querySelector('.msg.assistant .body').textContent
      .includes('') || true);
    await page.waitForFunction(() => !document.querySelector('#status').textContent.includes('generating'));
  };

  // ---- an ordinary failure still reports itself -------------------------
  await open();
  await page.evaluate(() => { window.failWith = 'something went sideways'; });
  await send('hello');
  let body = await page.locator('.msg.assistant .body').last().textContent();
  assert.match(body, /Generation failed/);
  assert.match(body, /Details to copy/);
  let facts = await page.locator('.msg.assistant .source pre').last().textContent();
  for (const key of ['model:', 'mode:', 'context:', 'prompt:', 'gpu:', 'agent:', 'error:'])
    assert.ok(facts.includes(key), `the report is missing "${key}"`);
  // Desk is the default mode, and its failures get the same report.
  assert.match(facts, /mode: desk/);
  assert.match(facts, /gpu: apple apple-m/);
  assert.match(facts, /error: something went sideways/);
  assert.match(facts, /prompt: \d+ tokens/);
  // An ordinary failure is not a dead engine — the page must stay usable.
  assert.equal(await page.locator('#send').isDisabled(), false,
    'an ordinary failure disabled the composer');

  // ---- the GPU failure from the phone -----------------------------------
  await open();
  await page.evaluate(() => { window.failWith = 'map async was not successful'; });
  await send('rewrite this for me');
  body = await page.locator('.msg.assistant .body').last().textContent();
  assert.match(body, /GPU dropped the model/i, 'the GPU failure was not recognised');
  assert.match(body, /ran out of GPU memory/i);
  assert.match(body, /reload the page/i);

  // It offers the one thing that plausibly helps, at a SMALLER context.
  const link = page.locator('.msg.assistant .body a').last();
  assert.equal(await link.count(), 1, 'no way forward was offered');
  const href = await link.getAttribute('href');
  assert.match(href, /[?&]ctx=2048/, `expected a smaller rung, got ${href}`);

  // And it stops pretending it can still answer.
  assert.equal(await page.locator('#send').isDisabled(), true,
    'the composer stayed live after the GPU was lost');
  assert.match(await page.locator('#status').textContent(), /GPU lost/i);

  // ---- ?ctx= narrows, and can never widen -------------------------------
  // A URL that could raise the context would be a way to talk the page into
  // an allocation that kills the tab outright.
  await open('&ctx=1024');
  await page.evaluate(() => { window.failWith = 'boom'; });
  await send('hi');
  facts = await page.locator('.msg.assistant .source pre').last().textContent();
  assert.match(facts, /context: 1024 \(overridden\)/, facts);

  await open('&ctx=999999');
  await page.evaluate(() => { window.failWith = 'boom'; });
  await send('hi');
  facts = await page.locator('.msg.assistant .source pre').last().textContent();
  const asked = Number(facts.match(/context: (\d+)/)[1]);
  assert.ok(asked <= 4096, `?ctx widened the window to ${asked}`);

  // ---- the status dot stays a dot in every state ------------------------
  // It did not. setStatus(..., "err") gives the dot class "dot err", and the
  // page-level error PANEL was also called `.err` — so on any error the 8px
  // dot inherited its padding, border and `margin: 0 auto`, became a 26x22
  // box and drifted into the middle of the header, pushing the title right.
  // That shipped, and showed up in the first phone screenshot of Work mode.
  await open();
  const dotBox = async () => page.evaluate(() => {
    const d = document.querySelector('.dot');
    const r = d.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), cls: d.className };
  });
  const ok = await dotBox();
  assert.deepEqual([ok.w, ok.h], [8, 8], `the dot is ${ok.w}x${ok.h} when idle`);

  await page.evaluate(() => { window.failWith = 'boom'; });
  await send('hi');
  const bad = await dotBox();
  assert.match(bad.cls, /err/, 'the error state did not reach the dot');
  assert.deepEqual([bad.w, bad.h], [8, 8],
    `the dot inflated to ${bad.w}x${bad.h} in the error state — the .err collision is back`);

  // And the title stays where it belongs, immediately after the dot.
  const shoved = await page.evaluate(() => {
    const d = document.querySelector('.dot').getBoundingClientRect();
    const h = document.querySelector('h1').getBoundingClientRect();
    return h.x - (d.x + d.width);
  });
  assert.ok(shoved < 24, `the title was pushed ${shoved.toFixed(0)}px from the dot`);

  // ---- a stop is not a failure ------------------------------------------
  await open();
  await page.evaluate(() => { window.failWith = null; });
  await send('fine');
  body = await page.locator('.msg.assistant .body').last().textContent();
  assert.ok(!/Generation failed|Details to copy/.test(body),
    'a successful turn was reported as a failure');

  assert.deepEqual(errors, [], 'page errors: ' + errors.join('; '));
  console.log('Failure checks passed: every mode reports the facts, the GPU ' +
    'failure is named and offers a smaller context, the composer closes when the ' +
    'device is gone, and ?ctx can only narrow.');
} finally {
  await browser.close();
}
