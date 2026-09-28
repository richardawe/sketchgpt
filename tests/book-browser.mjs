// Book mode, end to end in a real page — on a touch screen AND with a mouse.
//
//   node tests/book-browser.mjs
//
// Book writes with rules (web/story.mjs) and needs no model: opening the app
// must download no model and not even the model library. The model arrives
// only with Sketch. These runs hold the page to that, and to the old promises:
//
// The touch run exists because of a startup crash that only happened on touch
// screens: the module read a `const` before its declaration, threw, and never
// attached the submit listener, so on every phone Send submitted the form
// natively and RELOADED THE PAGE. Both runs start from a mode that no longer
// exists (Chat, Desk) and fail on any page error or any navigation.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return {
 interruptGenerate() {},
 chat: { completions: { async create(req) {
 window.requests.push(req);
 const out = window.plans.length ? window.plans.shift() : window.plan;
 return (async function* () { yield { choices: [{ delta: { content: out } }] }; })();
 } } }
}; }`;
const PLAN = JSON.stringify({ t: 'A house', c: ['house 30 60 40', 'tree 70 55 30'] });

const phoneCtx = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' };
// Every request the page makes for the model library is counted here.
const route = (page, seen) => page.route('**/*', async r => {
  const url = new URL(r.request().url());
  if (url.pathname === '/mock.mjs') { seen.lib++; return r.fulfill({ contentType: 'text/javascript', body: stub }); }
  const name = url.pathname.replace(/^.*\//, '');
  const file = /^(sketch|stamps|rough|book|story|picture|gif|video|scene|art|art-names)\.mjs$/.test(name) ? name : 'browser.html';
  await r.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
    body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
});
const gpu = () => Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
  features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 } }) } });

const browser = await launch();
try {
  for (const touch of [true, false]) {
    const who = touch ? 'touch' : 'mouse';
    const context = await browser.newContext(touch ? phoneCtx : { viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const errors = [], seen = { lib: 0 };
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({ startIn, plan, gpu }) => {
      eval(`(${gpu})`)();
      // A normal disk. Headless Chromium here offers ~0.9 GB, which makes the page
      // (correctly) pick a smaller model than a real desktop gets.
      if (navigator.storage) navigator.storage.estimate = async () => ({ quota: 50e9, usage: 0 });
      window.requests = []; window.plan = plan; window.plans = [];
      window.print = () => { window.printed = document.querySelectorAll('.print-me').length; };
      // Only on the first load: later reloads must see what the page saved.
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('sketchgpt.cfg', JSON.stringify({ output: startIn, system: 'leftover' }));
      }
    }, { startIn: touch ? 'chat' : 'desk', plan: PLAN, gpu: gpu.toString() });
    await route(page, seen);

    // ?animate=0: the plain book, the way back for a phone that struggles. The
    // default (moving, read aloud, share, edit) is tests/animate-browser.mjs and
    // tests/share-browser.mjs; writing and drawing are the same code in both.
    await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs&animate=0');
    await page.waitForSelector('#write');
    assert.deepEqual(errors, [], `${who}: the page threw while starting: ${errors.join('; ')}`);
    let navigations = 0;
    page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });

    // ---- A removed mode comes back as Book, and there are only two ------------
    const mode = () => page.locator('#output').getAttribute('data-value');
    assert.equal(await mode(), 'book', `${who}: a saved Chat/Desk mode did not come back as Book`);
    assert.deepEqual(await page.locator('#output button').evaluateAll(b => b.map(x => x.dataset.mode)),
      ['book', 'sketch']);
    assert.equal(await page.locator('#intro h2').textContent(), 'Make a picture book');

    // ---- Book needs no model: nothing to download, not even the library --------
    assert.equal(await page.locator('#status').textContent(), 'ready');
    assert.equal(await page.locator('#card').isVisible(), false, `${who}: the model card showed in Book`);
    assert.equal(await page.locator('#foot.on').count(), 0, `${who}: the Sketch composer showed in Book`);
    assert.equal(seen.lib, 0, `${who}: opening Book fetched the model library`);

    // ---- Choose, and the page writes a book ---------------------------------------
    const tapOrClick = sel => touch ? page.tap(sel) : page.click(sel);
    await tapOrClick('#kinds [data-value="dog"]');
    await tapOrClick('#places [data-value="farm"]');
    await tapOrClick('#wishes [data-value="sea"]');
    assert.equal(await page.locator('#kinds [aria-pressed="true"]').getAttribute('data-value'), 'dog');
    // A name is the reader's text, shown as text: never markup.
    await page.fill('#hero-name', '<b>Pip</b>');
    await tapOrClick('#write');
    await page.waitForFunction(() => document.querySelector('.book .book-actions') && !document.querySelector('#write').disabled);
    assert.equal(navigations, 0, `${who}: writing reloaded the page`);
    assert.equal(seen.lib, 0, `${who}: writing a book fetched the model library`);
    assert.equal(await page.evaluate(() => window.requests.length), 0, 'a book asked a model for something');

    const book = page.locator('.msg.assistant .book').last();
    assert.equal(await book.locator('.sheet').count(), 8, 'expected a cover, six pages and an end');
    const title = await book.locator('.cover h2').textContent();
    assert.match(title, /<b>Pip<\/b>/, title);
    assert.equal(await book.locator('.cover h2 b').count(), 0, 'the name was parsed as HTML');
    const pages = await book.locator('.page-text').evaluateAll(p => p.slice(0, 6).map(x => x.textContent));
    assert.ok(pages.every(t => t.includes('<b>Pip</b>')), 'the hero is named on every page: ' + pages.join(' | '));
    assert.match(pages[1], /sea/, 'the wish that was chosen');
    assert.equal(await book.locator('.art svg').count(), 7, 'every page and the cover get a picture');
    assert.equal(await book.locator('.art.pending').count(), 0, 'a picture was left undrawn');
    assert.match(await book.locator('.cover .by').textContent(), /no AI model/);
    const made = await book.locator('.made p').allTextContents();
    assert.ok(made.every(t => t.startsWith('Drawn from the words on this page')), made.join(' | '));
    // Each picture is drawn for its own page, in order.
    for (let i = 0; i < 6; i++) {
      const t = await book.locator('.sheet').nth(i + 1).locator('svg title').textContent();
      assert.equal(t, pages[i].trim().slice(0, 80));   // composeScene caps a title at 80
    }

    // ---- The privacy meter: zero requests since the page loaded ---------------
    assert.equal(await page.locator('#net').isVisible(), true);
    assert.equal(await page.locator('#netn').textContent(), '0',
      `${who}: the page made requests: ` + await page.locator('#netlog').textContent());

    // ---- Print this book, and download it as one file ---------------------------
    await book.locator('.book-actions button', { hasText: 'Print' }).click();
    assert.equal(await page.evaluate(() => window.printed), 1, 'print did not mark exactly this book');
    const [download] = await Promise.all([page.waitForEvent('download'),
      book.locator('.book-actions button', { hasText: 'Download' }).click()]);
    assert.match(download.suggestedFilename(), /^bPipb-.+\.html$/);
    const html = await readFile(await download.path(), 'utf8');
    assert.match(html, /<svg/);
    assert.match(html, /&lt;b&gt;Pip&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<script|How this picture was made|book-actions/);

    // ---- Another book: the builder stays, left to choose what is not chosen ----
    await tapOrClick('#kinds [data-value=""]');
    await page.fill('#hero-name', '');
    assert.equal(await page.locator('#write').textContent(), 'Write another book');
    await tapOrClick('#write');
    await page.waitForFunction(() => document.querySelectorAll('.book .book-actions').length === 2 &&
      !document.querySelector('#write').disabled);
    const second = page.locator('.msg.assistant .book').last();
    assert.equal(await second.locator('.art svg').count(), 7);
    assert.match(await second.locator('.page-text').nth(1).textContent(), /sea/, 'the farm and the wish were kept');

    // ---- Write my own: split, checked, drawn — and never rewritten --------------
    const OWN = 'Max and the Big Snow\n\nMax was a little dog who lived in a small house by the woods.\n\n' +
      'One morning, Max ran out into the snow.\n\nHe was cold! It was very cold.\n\n' +
      'Max went home to his warm bed.';
    await tapOrClick('#mode-own');
    await tapOrClick('#kinds [data-value=""]');
    await page.fill('#own-text', OWN);
    await page.waitForFunction(() => document.querySelectorAll('#guide .g.page').length === 4);
    const guide = await page.locator('#guide .g').allTextContents();
    assert.match(guide[0], /4 pages · “Max and the Big Snow” · hero: Max \(dog\) — found in your story/, guide[0]);
    assert.match(guide.find(g => g.startsWith('Page 3')), /nothing to draw here/, 'a page with nothing to draw was not flagged');
    assert.match(guide.find(g => g.startsWith('Page 4')), /draws .*bed/);
    await tapOrClick('#write');
    await page.waitForFunction(() => document.querySelectorAll('.book .book-actions').length === 3 &&
      !document.querySelector('#write').disabled);
    const mine = page.locator('.msg.assistant .book').last();
    assert.equal(await mine.locator('.cover h2').textContent(), 'Max and the Big Snow');
    assert.deepEqual(await mine.locator('.page-text').evaluateAll(p => p.slice(0, 4).map(x => x.textContent.trim())),
      OWN.split('\n\n').slice(1), 'the person\'s words were changed');
    assert.equal(await mine.locator('.art svg').count(), 5, 'every page and the cover get a picture');
    assert.equal(seen.lib, 0, `${who}: writing your own book fetched the model library`);
    await tapOrClick('#mode-make');

    // ---- Nothing typed is stored ----------------------------------------------------
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    for (const secret of ['Pip', 'leftover', 'Big Snow'])
      assert.ok(!stored.includes(secret), `"${secret}" is in localStorage`);

    // ---- Layout: the book gets the screen ------------------------------------------
    const box = await page.evaluate(() => ({
      header: document.querySelector('header').getBoundingClientRect().height,
      log: document.querySelector('#log').getBoundingClientRect().height,
      vh: innerHeight,
      scroll: document.documentElement.scrollWidth - innerWidth
    }));
    assert.ok(box.header <= 60, `${who}: the header is ${box.header}px tall`);
    assert.ok(box.log / box.vh >= 0.6, `${who}: the book has ${(100 * box.log / box.vh).toFixed(0)}% of the screen`);
    assert.ok(box.scroll <= 0, `${who}: the page scrolls sideways by ${box.scroll}px`);

    // ---- Sketch brings the model, and still draws ---------------------------------
    await page.click('#output [data-mode="sketch"]');
    await page.waitForFunction(() => !document.querySelector('#send').disabled &&
      document.querySelector('#foot').classList.contains('on'), null, { timeout: 15000 });
    assert.equal(seen.lib, 1, `${who}: Sketch did not fetch the model library once`);
    await page.evaluate(plan => { window.plans = [plan]; }, PLAN);
    await page.fill('#input', 'a house and a tree');
    await page.click('#send');
    await page.waitForFunction(() => !document.querySelector('#send').disabled &&
      !/drawing/.test(document.querySelector('#status').textContent));
    assert.equal(await page.evaluate(() => window.requests.length), 1);
    assert.equal(await page.locator('.msg.assistant').last().locator('svg').count(), 1);
    // Back in Book, the header does not report on a model Book does not use.
    await page.click('#output [data-mode="book"]');
    assert.equal(await page.locator('#status').textContent(), 'ready');
    assert.equal(await page.locator('#foot.on').count(), 0);

    // ---- The mode survives a reload -------------------------------------------------
    await page.click('#output [data-mode="sketch"]');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#foot').classList.contains('on'), null, { timeout: 15000 });
    assert.equal(await mode(), 'sketch');
    assert.equal(navigations, 1, 'only the deliberate reload should have navigated');

    assert.deepEqual(errors, [], `${who}: page errors: ${errors.join('; ')}`);
    await context.close();
  }

  // ---- No WebGPU at all: Book still works; Sketch says why it cannot ----------
  {
    const context = await browser.newContext(phoneCtx);
    const page = await context.newPage();
    const errors = [], seen = { lib: 0 };
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.requests = []; window.plans = []; });
    await route(page, seen);
    await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs&animate=0');
    await page.waitForSelector('#write');
    await page.tap('#write');
    await page.waitForFunction(() => document.querySelectorAll('.book .art svg').length === 7, null, { timeout: 30000 });
    await page.click('#output [data-mode="sketch"]');
    await page.waitForSelector('#nomodel');
    assert.match(await page.locator('#nomodel').textContent(), /no WebGPU|No GPU available/);
    assert.match(await page.locator('#nomodel').textContent(), /Books still work here/);
    assert.equal(await page.locator('#status').textContent(), 'unavailable');
    await page.click('#output [data-mode="book"]');
    assert.equal(await page.locator('#nomodel').isVisible(), false);
    assert.equal(await page.locator('.book').count(), 1, 'the book was lost');
    assert.equal(seen.lib, 0, 'no WebGPU, but the library was fetched anyway');
    assert.deepEqual(errors, [], `no WebGPU: page errors: ${errors.join('; ')}`);
    await context.close();
  }

  // ---- The page picks a model for the device and downloads it by itself ----
  // In Sketch. A phone gets Qwen3-0.6B and a desktop Qwen3-1.7B.
  // The fourth row is the desktop that "would not download": Qwen3-1.7B is a
  // ~1 GB download, and a browser offering less room ran it to 89% and then
  // refused to store it. The page must pick what fits, and say why.
  for (const [touch, want, saveData, quotaMB] of [
    [true, 'Qwen3-0.6B-q4f16_1-MLC', false],
    [false, 'Qwen3-1.7B-q4f16_1-MLC', false],
    [true, 'Qwen3-0.6B-q4f16_1-MLC', true],
    [false, 'Qwen3-0.6B-q4f16_1-MLC', false, 900]]) {
    const context = await browser.newContext(touch ? phoneCtx : { viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({ saveData, quotaMB }) => {
      Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
        features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 } }) } });
      // A normal disk. Headless Chromium here offers ~0.9 GB, which makes the page
      // (correctly) pick a smaller model than a real desktop gets.
      if (navigator.storage) navigator.storage.estimate = async () => ({ quota: 50e9, usage: 0 });
      if (saveData) Object.defineProperty(navigator, 'connection', { value: { saveData: true } });
      if (quotaMB) navigator.storage.estimate = async () => ({ quota: quotaMB * 1e6, usage: 0 });
      window.requests = []; window.plans = []; window.plan = '';
      // The model is picked, and downloaded, when Sketch is opened.
      localStorage.setItem('sketchgpt.cfg', JSON.stringify({ output: 'sketch' }));
    }, { saveData, quotaMB });
    await route(page, { lib: 0 });
    await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs');
    const who = `${touch ? 'phone' : 'desktop'}${saveData ? ' with Save-Data' : ''}${quotaMB ? ` with ${quotaMB} MB storage` : ''}`;
    await page.waitForFunction(() => document.querySelector('#model').value !== '');
    assert.equal(await page.inputValue('#model'), want, `${who}: picked the wrong model`);
    if (saveData) {
      await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#foot.on').count(), 0, `${who}: downloaded without asking`);
      assert.match(await page.locator('#autonote').textContent(), /save data/);
    } else {
      await page.waitForFunction(() => document.querySelector('#foot').classList.contains('on'),
        null, { timeout: 10000 });
      assert.match(await page.locator('#status').textContent(), /ready/, `${who}: did not load by itself`);
    }
    if (quotaMB) assert.match(await page.locator('#autonote').textContent(),
      /Qwen3 1\.7B would not fit: this browser has room for ~900 MB/, `${who}: did not say why`);
    assert.deepEqual(errors, [], `${who}: page errors: ${errors.join('; ')}`);
    await context.close();
  }

  console.log('Book checks passed on touch and mouse: old modes come back as Book, Book fetches no model ' +
    'and no library, the builder writes a six-page book with every picture drawn, a name stays text, ' +
    'print and download, another book from the same builder, nothing sent or stored, the layout fits, ' +
    'Sketch brings the model and draws, a phone with no WebGPU still makes a book, and each device ' +
    'gets its model in Sketch by itself.');
} finally {
  await browser.close();
}
