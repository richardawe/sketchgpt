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
  // Book's own module, fetched before the worker had control, is only cached
  // if the page warms the worker (warmWorker). Book is what a visitor opens,
  // so this is the check that one visit is enough.
  const cached = path => page.waitForFunction(async p => {
    for (const k of await caches.keys())
      if (await (await caches.open(k)).match(new URL(p, location.href).href, { ignoreSearch: true })) return true;
    return false;
  }, path, { timeout: 15000 });
  await cached('story.mjs');
  await page.waitForSelector('#write');
  // A first visit: the worker takes control and the page re-fetches its own
  // scripts so they are cached (warmWorker). That is the page caching itself,
  // not anything leaving the device, and the privacy meter must not count it —
  // it once showed 11 requests on a first visit.
  await page.waitForFunction(() => !document.querySelector('#net').hidden);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#netn').textContent(), '0',
    'the meter counted the page caching its own files: ' + await page.locator('#netlog').textContent());
  // Open Sketch once while online: the model library (the stand-in engine
  // module here) is fetched only then, and the worker caches it.
  await page.click('#output [data-mode="sketch"]');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
  await cached('mock.mjs');
  await page.click('#output [data-mode="book"]');

  // Now cut it off entirely — server down AND the browser offline.
  await context.setOffline(true);
  await new Promise(r => server.close(r));

  await page.reload();
  assert.match(await page.title(), /sketchgpt/, 'the page did not survive going offline');
  assert.equal(await page.locator('#output').count(), 1, 'the mode picker is missing offline');
  // The elements above are static HTML and exist even if the script died.
  // This is the check that the page's modules — imported with a ?v=
  // cache-buster — came back from the worker's cache and ran: a whole book,
  // written and drawn, with no network at all.
  await page.waitForSelector('#write', { timeout: 10000 });
  assert.equal(await page.locator('#output [data-mode="book"]').getAttribute('aria-selected'), 'true',
    'the page did not start in Book mode offline');
  await page.click('#write');
  await page.waitForFunction(() => document.querySelectorAll('.book .art svg').length === 7, null, { timeout: 20000 });
  // And Sketch still reaches its model library.
  await page.click('#output [data-mode="sketch"]');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load',
    null, { timeout: 10000 });
  assert.equal(await page.locator('#input').count(), 1, 'the composer is missing offline');
  console.log('Offline check passed: after one visit, a whole book is written and drawn with the ' +
    'network down, and Sketch still reaches its model library.');
} finally {
  await context.close(); await browser.close();
  server.listening && await new Promise(r => server.close(r));
}
