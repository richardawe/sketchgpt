// Run with Playwright installed, or set PLAYWRIGHT_MODULE to its index.mjs.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
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
    window.result = JSON.stringify({ title: 'House', commands: [
      { tool: 'rectangle', args: [100, 160, 200, 170], text: '' },
      { tool: 'line', args: [80, 160, 200, 60], text: '' },
      { tool: 'line', args: [200, 60, 320, 160], text: '' },
      { tool: 'circle', args: [200, 210, 20], text: '' },
      { tool: 'path', args: [180, 330, 160, 360, 200, 390], text: '' },
      { tool: 'text', args: [140, 40], text: '<script>bad()</script>' }
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
    const file = url.pathname.endsWith('sketch.mjs') ? 'sketch.mjs' : 'browser.html';
    await route.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
      body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
  });
  await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
  await page.click('#load');
  await page.selectOption('#output', 'sketch');
  const send = async text => { await page.fill('#input', text); await page.click('#send');
    await page.waitForFunction(() => !document.querySelector('#send').disabled); };
  await page.evaluate(() => { window.drawing = window.result; window.result = '<think>Plan the shapes.</think>\n' + window.drawing; });
  await send('Draw a house');
  assert.equal(await page.locator('.sketch svg').count(), 1);
  assert.equal(await page.locator('.sketch script').count(), 0);
  assert.equal(await page.locator('.sketch svg text').textContent(), '<script>bad()</script>');
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
  await page.evaluate(() => { window.result = '</think>\n```json\n' + window.drawing + '\n```'; });
  await send('Draw the house again');
  assert.equal(await page.locator('.sketch svg').count(), 2);
  assert.equal(await page.evaluate(() => requests.at(-1).messages.filter(m => m.role === 'assistant').every(m => m.content.startsWith('{'))), true);
  await page.evaluate(() => { window.result = '{'; });
  await send('Broken drawing');
  assert.match(await page.locator('.msg.assistant').last().textContent(), /Could not finish a valid sketch/);
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
  console.log('Browser checks passed: render, export, mobile width, invalid output, history, stop, saved mode.');
} finally { await browser.close(); }
