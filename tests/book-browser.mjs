// Book mode, end to end in a real page — on a touch screen AND with a mouse.
//
//   node tests/book-browser.mjs
//
// The touch run exists because of a startup crash that only happened on touch
// screens: the module read a `const` before its declaration, threw, and never
// attached the submit listener, so on every phone Send submitted the form
// natively and RELOADED THE PAGE. Both runs start from a mode that no longer
// exists (Chat, Desk) and fail on any page error or any navigation.
//
// The stub answers like the real models were measured to (docs/storybook.md):
// a story in the schema's envelope, and — on desktop, where each page is
// planned — a scene list that on one page is the scene prompt's example
// copied whole, which the page has to remove.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return {
 interruptGenerate() {},
 chat: { completions: { async create(req) {
 window.requests.push(req);
 const story = /picture-book stories/.test(req.messages[0].content);
 const out = story ? window.story : window.plans.length ? window.plans.shift() : window.plan;
 return (async function* () { yield { choices: [{ delta: { content: out } }] }; })();
 } } }
}; }`;

const STORY = JSON.stringify({
  title: 'Pip <b>and</b> the Sea',
  cast: [{ name: 'Pip', is: 'Dog' }, { name: 'Mr. Gull', is: 'bird' }],
  pages: ['Pip was a little dog who lived on a farm with a red tractor.',
    'One morning Pip saw a picture of the sea and wanted to go.',
    'He walked past the village and the tall trees.',
    'Mr. Gull flew down and showed Pip the way to the beach.',
    'At last Pip ran across the sand and splashed in the waves.',
    'As the sun set, Pip and Mr. Gull watched the boats come home.']
});
const PLAN = JSON.stringify({ t: 'a page', c: ['big dog front', 'tree x2', 'house'] });
// Qwen3-1.7B on a vague page: the scene prompt's own example, verbatim.
const COPIED = JSON.stringify({ t: 'a page', c: ['boat x2', 'lighthouse', 'bird x3 sky', 'fish x2', 'crane'] });

const phoneCtx = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' };
const route = page => page.route('**/*', async r => {
  const url = new URL(r.request().url());
  if (url.pathname === '/mock.mjs') return r.fulfill({ contentType: 'text/javascript', body: stub });
  const name = url.pathname.replace(/^.*\//, '');
  const file = /^(sketch|stamps|rough|book|scene|art|art-names)\.mjs$/.test(name) ? name : 'browser.html';
  await r.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
    body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
});

const browser = await launch();
try {
  for (const touch of [true, false]) {
    const who = touch ? 'touch' : 'mouse';
    const context = await browser.newContext(touch ? phoneCtx : { viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({ startIn, story, plan, copied }) => {
      Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
        features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 }
      }) } });
      window.requests = [];
      window.story = story; window.plan = plan; window.plans = [plan, copied];
      window.print = () => { window.printed = document.querySelectorAll('.print-me').length; };
      // Only on the first load: later reloads must see what the page saved.
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('sketchgpt.cfg', JSON.stringify({ output: startIn, system: 'leftover' }));
      }
    }, { startIn: touch ? 'chat' : 'desk', story: STORY, plan: PLAN, copied: COPIED });
    await route(page);

    await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs&manual=1');
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
    assert.deepEqual(errors, [], `${who}: the page threw while starting: ${errors.join('; ')}`);
    await page.click('#load');
    await page.waitForFunction(() => !document.querySelector('#send').disabled);

    let navigations = 0;
    page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });
    const calls = () => page.evaluate(() => window.requests.length);
    const send = async text => {
      await page.fill('#input', text);
      await page.click('#send');
      await page.waitForFunction(() => !document.querySelector('#send').disabled &&
        !/writing|drawing/.test(document.querySelector('#status').textContent));
    };

    // ---- A removed mode comes back as Book, and there are only two ------------
    const mode = () => page.locator('#output').getAttribute('data-value');
    assert.equal(await mode(), 'book', `${who}: a saved Chat/Desk mode did not come back as Book`);
    assert.deepEqual(await page.locator('#output button').evaluateAll(b => b.map(x => x.dataset.mode)),
      ['book', 'sketch']);
    assert.equal(await page.locator('#intro h2').textContent(), 'Write a picture book');

    // ---- Send writes a book ----------------------------------------------------
    await send('a little dog who has never seen the sea');
    assert.equal(navigations, 0, `${who}: Send reloaded the page`);
    const reqs = await page.evaluate(() => window.requests);
    const story = reqs[0];
    assert.match(story.messages[1].content, /never seen the sea/);
    assert.equal(story.temperature, 0.8);
    assert.equal(story.extra_body.enable_thinking, false);
    assert.equal(story.response_format.type, 'json_object');
    assert.match(story.response_format.schema, /"pages"/);
    assert.ok(story.max_tokens > 0 && story.max_tokens <= 900);

    const book = page.locator('.msg.assistant .book').last();
    assert.equal(await book.locator('.sheet').count(), 8, 'expected a cover, six pages and an end');
    // The title is the model's text, shown as text: never markup.
    assert.equal(await book.locator('.cover h2').textContent(), 'Pip <b>and</b> the Sea');
    assert.equal(await book.locator('.cover h2 b').count(), 0, 'the model\'s title was parsed as HTML');
    assert.deepEqual(await book.locator('.page-text').evaluateAll(p => p.slice(0, 6).map(x => x.textContent)),
      JSON.parse(STORY).pages);
    assert.equal(await book.locator('.art svg').count(), 7, 'every page and the cover get a picture');
    assert.equal(await book.locator('.art.pending').count(), 0, 'a picture was left undrawn');

    // Phones draw from the page's words and ask the model once; desktops plan
    // each page, and the page's rules fix the plan.
    const made = await book.locator('.made p').allTextContents();
    if (touch) {
      assert.equal(reqs.length, 1, 'a phone asked the model to plan pictures');
      assert.ok(made.every(t => t.startsWith('Drawn from the words on this page')), made.join(' | '));
    } else {
      assert.equal(reqs.length, 7, 'a desktop should plan each of the six pages');
      for (const r of reqs.slice(1)) {
        assert.match(r.messages[0].content, /Pip is drawn as "dog"/);
        assert.equal(r.temperature, 0.3);
      }
      assert.match(made[1], /copied example removed/, made[1]);
    }
    // Each picture is drawn for its own page, in order.
    for (let i = 0; i < 6; i++) {
      const title = await book.locator('.sheet').nth(i + 1).locator('svg title').textContent();
      assert.equal(title, JSON.parse(STORY).pages[i]);
    }

    // ---- The privacy meter: zero requests since the model loaded ------------
    assert.equal(await page.locator('#net').isVisible(), true);
    assert.equal(await page.locator('#netn').textContent(), '0',
      `${who}: the page made requests after loading: ` + await page.locator('#netlog').textContent());

    // ---- Print this book, and download it as one file ---------------------------
    await book.locator('.book-actions button', { hasText: 'Print' }).click();
    assert.equal(await page.evaluate(() => window.printed), 1, 'print did not mark exactly this book');
    const [download] = await Promise.all([page.waitForEvent('download'),
      book.locator('.book-actions button', { hasText: 'Download' }).click()]);
    assert.equal(download.suggestedFilename(), 'Pip-bandb-the-Sea.html');
    const html = await readFile(await download.path(), 'utf8');
    assert.match(html, /<svg/);
    assert.match(html, /Pip &lt;b&gt;and&lt;\/b&gt; the Sea/);
    assert.doesNotMatch(html, /<script|How this picture was made|book-actions/);

    // ---- A reply that is not a story is said plainly, and kept -------------------
    await page.evaluate(() => { window.story = 'Once upon a time there was a dog.'; });
    await send('a cat');
    const last = page.locator('.msg.assistant').last();
    assert.match(await last.textContent(), /did not write a story/);
    assert.equal(await last.locator('.source.raw pre').textContent(), 'Once upon a time there was a dog.');

    // ---- A story cut off mid-page keeps its finished pages --------------------------
    await page.evaluate(story => { window.story = story.slice(0, story.indexOf('At last') + 20); }, STORY);
    await send('a dog again');
    const cut = page.locator('.msg.assistant').last();
    assert.equal(await cut.locator('.page-text').count(), 5, '4 finished pages and The End');
    assert.match(await cut.textContent(), /ran out of room after 4 pages/);

    // ---- Nothing typed is stored ----------------------------------------------------
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    for (const secret of ['never seen', 'a cat', 'leftover'])
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

    // ---- Sketch still draws ------------------------------------------------------------
    await page.click('#output [data-mode="sketch"]');
    await page.evaluate(() => { window.plans = [JSON.stringify({ t: 'A house', c: ['house 30 60 40', 'tree 70 55 30'] })]; });
    const n = await calls();
    await send('a house and a tree');
    assert.equal(await calls(), n + 1);
    assert.equal(await page.locator('.msg.assistant').last().locator('svg').count(), 1);

    // ---- The mode survives a reload -------------------------------------------------
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
    assert.equal(await mode(), 'sketch');
    assert.equal(navigations, 1, 'only the deliberate reload should have navigated');

    assert.deepEqual(errors, [], `${who}: page errors: ${errors.join('; ')}`);
    await context.close();
  }

  // ---- The page picks a model for the device and downloads it by itself ----
  // A phone gets Qwen3-0.6B — the only phone-sized model that wrote a story
  // (docs/storybook.md) — and a desktop Qwen3-1.7B.
  for (const [touch, want, saveData] of [
    [true, 'Qwen3-0.6B-q4f16_1-MLC', false],
    [false, 'Qwen3-1.7B-q4f16_1-MLC', false],
    [true, 'Qwen3-0.6B-q4f16_1-MLC', true]]) {
    const context = await browser.newContext(touch ? phoneCtx : { viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({ saveData }) => {
      Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
        features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 } }) } });
      if (saveData) Object.defineProperty(navigator, 'connection', { value: { saveData: true } });
      window.requests = []; window.plans = []; window.story = ''; window.plan = '';
    }, { saveData });
    await route(page);
    await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs');
    const who = `${touch ? 'phone' : 'desktop'}${saveData ? ' with Save-Data' : ''}`;
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
    assert.deepEqual(errors, [], `${who}: page errors: ${errors.join('; ')}`);
    await context.close();
  }

  console.log('Book checks passed on touch and mouse: Send never reloads, old modes come back as Book, ' +
    'a six-page book with every picture drawn, phones draw from words, desktops plan and the copied ' +
    'example is removed, the title stays text, print and download, a non-story and a cut-off story ' +
    'are handled, nothing sent or stored, the layout fits, Sketch still draws, and each device gets ' +
    'its model by itself.');
} finally {
  await browser.close();
}
