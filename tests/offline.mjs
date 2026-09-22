// Proves the page opens with the network off.
//
// This is the claim the README makes twice, and before the service worker it
// was false: WebLLM's weights persisted, but GitHub Pages expires index.html
// after ten minutes, so a visit with no signal got a browser error instead of
// the app. Playwright can actually cut the network, so this is checkable
// rather than assumed.
//
//   node tests/offline.mjs      (needs a real HTTP server — file:// and route
//                                interception both disable service workers)
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' };
// The engine stub lives here rather than in web/, so nothing that only exists
// for a test can ever be deployed.
const MOCK = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return { interruptGenerate() {},
 chat: { completions: { async create() { return (async function* () {
 yield { choices: [{ delta: { content: window.result } }] }; })(); } } } }; }`;
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  const name = path === '/' || path === '/browser.html' ? 'browser.html' : path.slice(1);
  if (name === 'mock.mjs') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'max-age=600' });
    return res.end(MOCK);
  }
  try {
    const body = await readFile(new URL('../web/' + name, import.meta.url));
    const ext = name.slice(name.lastIndexOf('.'));
    // Exactly what GitHub Pages sends: ten minutes, no service worker needed
    // to pass while online, which is the point.
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream',
      'cache-control': 'max-age=600' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
try {
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('  [page]', m.text()); });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
      features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 } }) } });
    window.result = JSON.stringify({ t: 'A cat', c: ['cat 50 52 34'] });
  });
  // The WebLLM import is the one thing a real visitor pulls from a CDN, so
  // serve it from this origin and let the worker cache it like any asset.
  await page.goto(`${origin}/browser.html?lib=${origin}/mock.mjs&rough=${origin}/rough.mjs`);
  const reg = await page.evaluate(async () => {
    try { const r = await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready;
          return { scope: r.scope, active: !!r.active, installing: !!r.installing, waiting: !!r.waiting }; }
    catch (e) { return { error: e.message }; }
  });
  assert.ok(!reg.error && reg.active, `service worker did not activate: ${JSON.stringify(reg)}`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');

  // Now cut it off entirely — server down AND the browser offline.
  await context.setOffline(true);
  await new Promise(r => server.close(r));

  await page.reload();
  assert.match(await page.title(), /sketchgpt/, 'the page did not survive going offline');
  await page.waitForFunction(() => document.querySelector('#status') !== null);
  assert.equal(await page.locator('#input').count(), 1, 'the composer is missing offline');
  assert.equal(await page.locator('#output').count(), 1, 'the mode picker is missing offline');
  // The local modules must come from the cache too, not just the HTML.
  const drew = await page.evaluate(async () => {
    const m = await import('./sketch.mjs');
    return m.parseSketch('{"t":"A cat","c":["cat 50 52 34"]}').commands[0].text;
  });
  assert.equal(drew, 'cat', 'sketch.mjs was not available offline');
  console.log('Offline check passed: page, composer and sketch module all load with the network down.');
} finally {
  await context.close(); await browser.close();
  server.listening && await new Promise(r => server.close(r));
}
