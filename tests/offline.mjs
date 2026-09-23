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
import { launch } from './browser.mjs';

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

const browser = await launch();
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
  await page.goto(`${origin}/browser.html?lib=${origin}/mock.mjs&rough=${origin}/rough.mjs&manual=1`);
  // The PAGE must register the worker. Registering it from the test here hid
  // a real bug: the registration sat inside a load listener, and this module
  // top-level awaits its WebLLM import, so load fired while it was suspended
  // and the listener never ran. Live, no worker was ever registered; the test
  // passed anyway because it had registered one itself.
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistrations()).length > 0,
    { timeout: 15000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
  // The engine module stands in for the WebLLM bundle: fetched before the
  // worker had control, so it is only cached if the page warms the worker.
  await page.waitForFunction(async () => {
    for (const k of await caches.keys())
      if (await (await caches.open(k)).match(new URL('mock.mjs', location.href).href, { ignoreSearch: true })) return true;
    return false;
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');

  // Now cut it off entirely — server down AND the browser offline.
  await context.setOffline(true);
  await new Promise(r => server.close(r));

  await page.reload();
  assert.match(await page.title(), /sketchgpt/, 'the page did not survive going offline');
  await page.waitForFunction(() => document.querySelector('#status') !== null);
  assert.equal(await page.locator('#input').count(), 1, 'the composer is missing offline');
  assert.equal(await page.locator('#output').count(), 1, 'the mode picker is missing offline');
  // The elements above are static HTML and exist even if the script died. This
  // is the check that the page's own modules — imported with a ?v= cache-buster
  // — came back from the worker's cache and ran.
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load',
    null, { timeout: 10000 });
  assert.equal(await page.locator('#tools .tab').count(), 2, 'the Desk tools did not render offline');
  // The local modules must come from the cache too, not just the HTML.
  const drew = await page.evaluate(async () => {
    const m = await import('./sketch.mjs');
    return m.parseSketch('{"t":"A cat","c":["cat 50 52 34"]}').commands[0].text;
  });
  assert.equal(drew, 'cat', 'sketch.mjs was not available offline');
  // Desk is the mode whose whole argument is that nothing leaves the device,
  // so its module has to be in the shell cache, not fetched on demand.
  const planned = await page.evaluate(async () => {
    const m = await import('./desk.mjs');
    return m.planDeskTurn({ tool: m.toolById('dump'), text: 'buy milk, call mum' }).run;
  });
  assert.equal(planned, true, 'desk.mjs was not available offline');
  console.log('Offline check passed: page, composer, sketch and desk modules all load ' +
    'with the network down.');
} finally {
  await context.close(); await browser.close();
  server.listening && await new Promise(r => server.close(r));
}
