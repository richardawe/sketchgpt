// Run with Playwright installed, or set PLAYWRIGHT_MODULE to its index.mjs.
// Rough.js is served from the local package when it is present; otherwise the
// run exercises the clean-SVG fallback, which is the path a visitor gets when
// the CDN is unreachable.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

// SKETCH_ROUGH=0 forces the fallback even when roughjs is installed, so both
// rendering paths can be checked from one machine.
let roughSource = null;
if (process.env.SKETCH_ROUGH === '0') console.log('note: rough.js disabled — checking the clean-SVG fallback');
else try {
  roughSource = await readFile(createRequire(import.meta.url)
    .resolve('roughjs/bundled/rough.esm.js'), 'utf8');
} catch { console.log('note: roughjs not installed — checking the clean-SVG fallback'); }

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
      features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 }
    }) } });
    window.requests = [];
    window.result = JSON.stringify({ t: 'A house beside a tree', c: [
      'house 25 55 40', 'tree 78 50 34', 'sun 15 15 14',
      'line 2 88 98 88', 'curve 40 88 50 78 60 88', 'circle 50 30 4',
      'box 60 70 12 10', 'label 30 96 <script>bad()</script>'
    ] });
  });
  const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return {
 interruptGenerate() { window.interrupted = true; },
 chat: { completions: { async create(req) {
 window.requests.push(req); window.interrupted = false;
 return (async function* () {
 const result = window.result;
 if (window.slow) { await new Promise(r => setTimeout(r, 200)); }
 if (!window.interrupted) yield { choices: [{ delta: { content: result } }] };
 })();
 } } }
}; }`;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/mock.mjs') return route.fulfill({ contentType: 'text/javascript', body: stub });
    if (url.pathname === '/rough.mjs') return route.fulfill({ contentType: 'text/javascript', body: roughSource || '' });
    const name = url.pathname.replace(/^.*\//, '');
    const file = /^(sketch|stamps)\.mjs$/.test(name) ? name : 'browser.html';
    await route.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
      body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
  });
  const open = async (query = '') => {
    await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs' + query);
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
    await page.click('#load');
  };
  await open(roughSource ? '&rough=/rough.mjs' : '&rough=0');
  await page.selectOption('#output', 'sketch');
  const send = async text => { await page.fill('#input', text); await page.click('#send');
    await page.waitForFunction(() => !document.querySelector('#send').disabled); };

  // A drawing arrives wrapped in reasoning, as Qwen builds prefill it.
  await page.evaluate(() => { window.drawing = window.result; window.result = '<think>Plan the shapes.</think>\n' + window.drawing; });
  await send('Draw a house beside a tree');
  assert.equal(await page.locator('.sketch svg').count(), 1);
  assert.equal(await page.locator('.sketch script').count(), 0);
  assert.equal(await page.locator('.sketch svg text').textContent(), '<script>bad()</script>');
  assert.equal(await page.locator('.sketch p').first().textContent(), 'A house beside a tree');

  // Three stamps became real geometry rather than three words.
  const stampPaths = await page.locator('.sketch svg g[transform] path').count();
  assert.ok(stampPaths >= 9, `stamps drew ${stampPaths} paths`);
  if (roughSource) {
    // Rough redraws each primitive as its own sketchy path set, so the
    // element count climbs well past the eight commands sent.
    const paths = await page.locator('.sketch svg path').count();
    assert.ok(paths > stampPaths, `rough.js added nothing: ${paths} paths`);
    // Nothing inside the drawing group is a plain primitive any more; the
    // white background rect outside it stays.
    assert.equal(await page.locator('.sketch svg g line, .sketch svg g rect, .sketch svg g circle').count(), 0);
  } else {
    assert.equal(await page.locator('.sketch svg g line').count(), 1);
    assert.equal(await page.locator('.sketch svg g circle').count(), 1);
  }
  assert.equal(await page.evaluate(() => requests[0].response_format.type), 'json_object');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  const downloadEvent = page.waitForEvent('download');
  await page.getByText('Download SVG', { exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'sketch.svg');
  const exported = await readFile(await download.path(), 'utf8');
  assert.match(exported, /&lt;script&gt;/);
  assert.doesNotMatch(exported, /<script>/);
  await page.screenshot({ path: '/tmp/sketch-preview.png' });

  // A revision: fenced this time, and the stored history must hold the
  // canonical source rather than the fences.
  await page.evaluate(() => { window.result = '</think>\n```json\n' + window.drawing + '\n```'; });
  await send('Make the tree bigger');
  assert.equal(await page.locator('.sketch svg').count(), 2);
  assert.equal(await page.evaluate(() =>
    requests.at(-1).messages.filter(m => m.role === 'assistant').every(m => m.content.startsWith('{"t"'))), true);

  // The prompt must not grow with the conversation.
  const sizeAfter = async () => page.evaluate(() =>
    requests.at(-1).messages.reduce((n, m) => n + m.content.length, 0));
  await send('Make it bigger again');
  const early = await sizeAfter();
  for (let i = 0; i < 6; i++) await send('Make it bigger again');
  const late = await sizeAfter();
  assert.equal(early, late, `prompt grew from ${early} to ${late} chars over six turns`);
  assert.ok(await page.evaluate(() => requests.at(-1).max_tokens > 0));

  // Output cut off mid-JSON still renders what arrived.
  await page.evaluate(() => { window.result = '{"t":"Cut off","c":["house 25 55 40","tree 78 5'; });
  await send('A long drawing');
  assert.equal(await page.locator('.msg.assistant').last().locator('svg').count(), 1);
  assert.match(await page.locator('.msg.assistant').last().textContent(), /ran out of room/);

  // Output that is not a drawing at all says so.
  await page.evaluate(() => { window.result = 'I cannot draw that.'; });
  await send('Broken drawing');
  assert.match(await page.locator('.msg.assistant').last().textContent(), /Could not finish a valid sketch/);

  // Chat mode is untouched: no schema, no sketch prompt, its own history.
  await page.evaluate(() => { window.result = 'Hello'; });
  await page.selectOption('#output', 'chat');
  await send('Hello');
  assert.equal(await page.evaluate(() => requests.at(-1).messages.filter(m => m.role === 'user').length), 1);
  assert.equal(await page.evaluate(() => requests.at(-1).response_format), undefined);

  await page.selectOption('#output', 'sketch');
  await page.evaluate(() => { window.slow = true; });
  await page.fill('#input', 'Stop this sketch'); await page.click('#send'); await page.click('#stop');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  assert.match(await page.locator('.msg.assistant').last().textContent(), /Drawing stopped/);
  assert.equal(await page.evaluate(() => requests.at(-1).messages.some(m => m.content === 'Broken drawing')), false);

  await page.reload();
  assert.equal(await page.locator('#output').inputValue(), 'sketch');
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed${roughSource ? ' with rough.js' : ' on the clean-SVG fallback'}:` +
    ' stamps, render, export, mobile width, flat prompt, truncation, invalid output, history, stop, saved mode.');
} finally { await browser.close(); }
