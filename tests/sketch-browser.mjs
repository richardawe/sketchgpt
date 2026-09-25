// Run with Playwright installed, or set PLAYWRIGHT_MODULE to its index.mjs.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

// rough.js is vendored in web/, so these checks exercise the file that ships
// rather than a copy from node_modules. SKETCH_ROUGH=0 forces the clean-SVG
// fallback instead — the path a visitor gets if the module fails to load.
const withRough = process.env.SKETCH_ROUGH !== '0';
if (!withRough) console.log('note: rough.js disabled — checking the clean-SVG fallback');

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
      features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 }
    }) } });
      // A normal disk. Headless Chromium here offers ~0.9 GB, which makes the page
      // (correctly) pick a smaller model than a real desktop gets.
      if (navigator.storage) navigator.storage.estimate = async () => ({ quota: 50e9, usage: 0 });
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
    const name = url.pathname.replace(/^.*\//, '');
    const file = /^(sketch|stamps|rough|book|story|picture|gif|video|scene|art|art-names)\.mjs$/.test(name) ? name : 'browser.html';
    await route.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
      body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
  });
  const open = async (query = '') => {
    await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs&manual=1' + query);
    // The model is Sketch's: it is prepared when Sketch is opened.
    await page.click('#output [data-mode="sketch"]');
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
    await page.click('#load');
  };
  await open(withRough ? '' : '&rough=0');
  await page.click('#output [data-mode="sketch"]');
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
  if (withRough) {
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

  // The commands are recoverable from the page. On a device nobody here can
  // reach, a nearly-empty drawing is indistinguishable from a misparsed one
  // without them.
  assert.match(await page.locator('.sketch details summary').textContent(), /Show commands \(8\)/);
  // The model's own noun, not the resolved stamp name: it typed "tree", the
  // page drew tree-deciduous, and the panel has to report the former.
  assert.match(await page.locator('.sketch details textarea').inputValue(), /^house 25 55 40\ntree 78 50 34\n/);

  // The commands panel is editable: change a number, press Redraw.
  const panel = page.locator('.sketch details').last();
  await panel.locator('summary').click();
  const box = panel.locator('textarea');
  assert.match(await box.inputValue(), /^house 25 55 40\n/);
  await box.fill('house 50 50 60 red\ntree 20 30 20');
  await panel.getByText('Redraw', { exact: true }).click();
  const after = page.locator('.sketch details').last();
  assert.match(await after.locator('summary').textContent(), /Show commands \(2\)/);
  assert.equal(await after.locator('textarea').inputValue(), 'house 50 50 60 red\ntree 20 30 20');
  assert.equal(await page.locator('.sketch svg g[transform]').count(), 2, 'redraw did not redraw');
  assert.ok(await after.evaluate(d => d.open), 'the panel closed itself after a redraw');
  // A bad edit keeps the drawing and says so, rather than blanking the pane.
  await after.locator('textarea').fill('nonsense\nmore nonsense');
  await after.getByText('Redraw', { exact: true }).click();
  assert.match(await page.locator('.sketch .note').last().textContent(), /unchanged/);
  assert.equal(await page.locator('.sketch svg').last().locator('g[transform]').count(), 2);
  // Put it back so the checks below see the drawing they expect.
  await page.locator('.sketch details').last().locator('textarea')
    .fill('house 25 55 40\ntree 78 50 34\nsun 15 15 14\nline 2 88 98 88\ncurve 40 88 50 78 60 88\ncircle 50 30 4\nbox 60 70 12 10\nlabel 30 96 <script>bad()</script>');
  await page.locator('.sketch details').last().getByText('Redraw', { exact: true }).click();

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

  // A pile of stamps is spread by the page, and it says so rather than
  // quietly presenting its own coordinates as the model's.
  await page.evaluate(() => { window.result = JSON.stringify({ t: 'A house with a tree and a car',
    c: ['house 50 50 30', 'tree-deciduous 50 52 30', 'car 50 54 30'] }); });
  await send('Draw a house with a tree and a car');
  const piled = page.locator('.msg.assistant').last();
  assert.match(await piled.locator('details summary').textContent(), /2 moved apart/);
  assert.match(await piled.locator('details textarea').inputValue(), /^house 50 50 30\n/);
  assert.match(await piled.locator('details .note').textContent(), /spread them out/);
  const centres = await piled.locator('svg g[transform]').evaluateAll(nodes =>
    nodes.map(n => n.getAttribute('transform').match(/translate\(([\d.-]+) ([\d.-]+)\)/).slice(1).map(Number)));
  assert.equal(centres.length, 3);
  assert.equal(new Set(centres.map(c => c.join(','))).size, 3, 'stamps still drawn on top of each other');

  // Colour reaches the SVG as a stroke, and only where it was asked for.
  await page.evaluate(() => { window.result = JSON.stringify({ t: 'A red house', c: [
    'house 25 55 40 red', 'tree 78 50 34 green', 'circle 50 18 8 yellow', 'sun 12 12 10'] }); });
  await send('Draw a red house with a green tree');
  const painted = page.locator('.msg.assistant').last();
  // With the illustrations (web/art.mjs) a colour word repaints the picture's
  // main colour; with only the line icons it colours the stroke. Either way
  // the colour must arrive, and only on the things it was asked for.
  const paint = await painted.locator('svg').evaluate(svg => {
    const colours = el => [...el.querySelectorAll('*')].flatMap(n => [n.getAttribute('fill'), n.getAttribute('stroke')])
      .concat([el.getAttribute('fill'), el.getAttribute('stroke')]).filter(Boolean);
    const groups = [...svg.querySelectorAll('g[transform]')];   // one per stamp, in command order
    return groups.map(colours);
  });
  const [house, tree, sun] = paint;
  assert.ok(house.includes('#c0392b'), `the house was asked to be red: ${[...new Set(house)]}`);
  assert.ok(tree.includes('#2e7d4f'), `the tree was asked to be green: ${[...new Set(tree)]}`);
  assert.ok(!sun.includes('#c0392b') && !sun.includes('#2e7d4f'), 'a colour leaked onto the uncoloured sun');
  assert.match(await painted.locator('details textarea').inputValue(), /house 25 55 40 red/);
  await page.screenshot({ path: '/tmp/sketch-colour.png', fullPage: true });

  // Output cut off mid-JSON still renders what arrived.
  await page.evaluate(() => { window.result = '{"t":"Cut off","c":["house 25 55 40","tree 78 5'; });
  await send('A long drawing');
  assert.equal(await page.locator('.msg.assistant').last().locator('svg').count(), 1);
  assert.match(await page.locator('.msg.assistant').last().textContent(), /ran out of room/);

  // Output that is not a drawing at all says so — and keeps the evidence.
  await page.evaluate(() => { window.result = 'I cannot draw that.'; });
  await send('Broken drawing');
  assert.match(await page.locator('.msg.assistant').last().textContent(), /Could not finish a valid sketch/);
  assert.equal(await page.locator('.msg.assistant').last().locator('details.raw pre').textContent(), 'I cannot draw that.');

  await page.evaluate(() => { window.result = window.drawing; });
  await page.click('#output [data-mode="sketch"]');
  await page.evaluate(() => { window.slow = true; });
  await page.fill('#input', 'Stop this sketch'); await page.click('#send'); await page.click('#stop');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  assert.match(await page.locator('.msg.assistant').last().textContent(), /Drawing stopped/);
  assert.equal(await page.evaluate(() => requests.at(-1).messages.some(m => m.content === 'Broken drawing')), false);

  await page.reload();
  assert.equal(await page.locator('#output').getAttribute('data-value'), 'sketch');
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed${withRough ? ' with the vendored rough.js' : ' on the clean-SVG fallback'}:` +
    ' stamps, render, export, mobile width, flat prompt, truncation, invalid output, history, stop, saved mode.');
} finally { await browser.close(); }
