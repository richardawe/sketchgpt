// Desk, end to end in a real page — on a touch screen AND with a mouse.
//
//   node tests/desk-browser.mjs
//
// Every other browser test here ran with a fine pointer only. That is how a
// startup crash that only happened on touch screens shipped: the module read a
// `const` before its declaration, threw, and never attached the submit
// listener, so on every phone Send submitted the form natively and RELOADED
// THE PAGE. The touch run below starts in Chat mode — the exact condition —
// and fails on any page error or any navigation caused by Send.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return {
 interruptGenerate() {},
 chat: { completions: { async create(req) {
 window.requests.push(req);
 return (async function* () { yield { choices: [{ delta: { content: window.result } }] }; })();
 } } }
}; }`;

const PAGE = process.env.DESK_PAGE || 'browser.html';   // lets the old page be checked too

const browser = await launch();
try {
  for (const touch of [true, false]) {
    const who = touch ? 'touch' : 'mouse';
    const context = await browser.newContext(touch
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' }
      : { viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({ startIn }) => {
      Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
        features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 }
      }) } });
      window.requests = [];
      window.result = 'ok';
      // Only on the first load: later reloads must see what the page saved.
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('sketchgpt.cfg', JSON.stringify({ output: startIn }));
      }
    }, { startIn: touch ? 'chat' : 'desk' });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/mock.mjs')
        return route.fulfill({ contentType: 'text/javascript', body: stub });
      const name = url.pathname.replace(/^.*\//, '');
      const file = /^(sketch|stamps|rough|desk)\.mjs$/.test(name) ? name : PAGE;
      const dir = file === PAGE && process.env.DESK_PAGE_DIR ? process.env.DESK_PAGE_DIR : '../web/';
      await route.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
        body: await readFile(new URL(dir + file, import.meta.url), 'utf8') });
    });

    await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs');
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
        !/generating/.test(document.querySelector('#status').textContent));
    };

    // ---- Send sends, in the mode that used to crash -----------------------
    const mode = () => page.locator('#output').getAttribute('data-value');
    assert.equal(await mode(), touch ? 'chat' : 'desk');
    const before = await calls();
    await send('hello');
    assert.equal(navigations, 0, `${who}: Send reloaded the page`);
    assert.equal(await calls(), before + 1, `${who}: Send did not reach the model`);

    // ---- Desk: two tools, one option --------------------------------------
    await page.click('#output [data-mode="desk"]');
    assert.equal(await mode(), 'desk');
    assert.deepEqual(await page.locator('#tools .tab').evaluateAll(b => b.map(x => x.dataset.tool)),
      ['dump', 'polish']);
    await page.click('#tools [data-tool="dump"]');
    assert.equal(await page.locator('#opt').isVisible(), false, 'brain dump has no options');
    await page.click('#tools [data-tool="polish"]');
    assert.equal(await page.locator('#opt').isVisible(), true, 'say it better lost its tone');

    // ---- Brain dump: the page draws the checklist and finds what is missing.
    // The model output is Qwen3-0.6B's own shape: a bullet inside a bullet.
    await page.click('#tools [data-tool="dump"]');
    await page.evaluate(() => { window.result = '- - Email Sam about the budget\n- - Buy milk\n- - Call mum back'; });
    await send('dentist, email Sam about the budget, buy milk, call mum back');
    const last = page.locator('.msg.assistant').last();
    assert.deepEqual(await last.locator('.checklist li').allTextContents(),
      ['Email Sam about the budget', 'Buy milk', 'Call mum back']);
    assert.match(await last.locator('.callout').textContent(), /Not on the list/);
    await last.locator('.callout button', { hasText: 'dentist' }).click();
    assert.equal(await last.locator('.checklist li').count(), 4, 'a left-out item could not be added back');
    assert.equal(await last.locator('.callout').count(), 0, 'the callout outlived its last chip');
    await last.locator('.checklist input').first().check();
    assert.equal(await last.locator('.checklist input:checked').count(), 1);

    // The prompt carried the text and nothing from the previous turn.
    const sent = await page.evaluate(() => window.requests.at(-1));
    assert.equal(sent.messages.length, 2);
    assert.match(sent.messages[1].content, /dentist/);
    assert.doesNotMatch(sent.messages.map(m => m.content).join(' '), /hello/,
      'a chat turn leaked into a Desk prompt');
    assert.ok(sent.max_tokens > 0);

    // ---- Say it better: a flipped negation is flagged, a preamble stripped.
    await page.click('#tools [data-tool="polish"]');
    await page.selectOption('#opt', 'more professional');
    await page.evaluate(() => {
      window.result = "Sure! Here's a more professional version of your message:\n" +
        'Hi, the report will be ready Friday due to the data being delayed.';
    });
    await send('hi, the report wont be ready friday because the data came late, sorry');
    const rewrite = page.locator('.msg.assistant').last();
    assert.equal(await rewrite.locator('.result').textContent(),
      'Hi, the report will be ready Friday due to the data being delayed.');
    assert.match(await rewrite.locator('.callout').textContent(), /Check before sending/);
    assert.match(await page.locator('.msg.user').last().textContent(), /Say it better · make it more professional/);

    // A model that returns only a preamble is a failure, and says so.
    await page.evaluate(() => { window.result = "Sure! Here's a firmer version of your message:"; });
    await send('No. I am not doing overtime again this weekend.');
    assert.match(await page.locator('.msg.assistant').last().textContent(), /did not return anything usable/);

    // ---- Too long is refused before the model runs, and the text stays. ---
    const long = 'word '.repeat(5000).trim();
    const n = await calls();
    await page.fill('#input', long);
    assert.match(await page.locator('#count').textContent(), /5,000 \/ [\d,]+ words/);
    assert.match(await page.locator('#count').getAttribute('class'), /over/);
    await page.click('#send');
    assert.equal(await calls(), n, 'text too long for the window was sent anyway');
    assert.equal(await page.inputValue('#input'), long, 'refusing the text also deleted it');
    assert.match(await page.locator('#count').textContent(), /about [\d,]+ at once/);
    await page.fill('#input', '');

    // ---- The privacy meter: zero requests since the model loaded ----------
    assert.equal(await page.locator('#net').isVisible(), true);
    assert.equal(await page.locator('#netn').textContent(), '0',
      `${who}: the page made requests after loading: ` +
      await page.locator('#netlog').textContent());
    // And it is a real counter, not a label: a request after load shows up.
    await page.evaluate(() => fetch('/probe-request').catch(() => {}));
    await page.waitForFunction(() => document.querySelector('#netn').textContent === '1');
    assert.match(await page.locator('#net').getAttribute('class'), /dirty/);
    await page.click('#net');
    assert.match(await page.locator('#netlog').textContent(), /probe-request/);
    await page.keyboard.press('Escape');

    // ---- Nothing typed is stored ----------------------------------------------
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    for (const secret of ['dentist', 'report', 'overtime'])
      assert.ok(!stored.includes(secret), `"${secret}" was written to localStorage`);

    // ---- Layout: the conversation gets the screen ------------------------------
    const box = await page.evaluate(() => ({
      header: document.querySelector('header').getBoundingClientRect().height,
      log: document.querySelector('#log').getBoundingClientRect().height,
      vh: innerHeight,
      scroll: document.documentElement.scrollWidth - innerWidth
    }));
    assert.ok(box.header <= 60, `${who}: the header is ${box.header}px tall`);
    assert.ok(box.log / box.vh >= 0.6, `${who}: the conversation has ${(100 * box.log / box.vh).toFixed(0)}% of the screen`);
    assert.ok(box.scroll <= 0, `${who}: the page scrolls sideways by ${box.scroll}px`);

    // ---- The mode survives a reload -----------------------------------------------
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
    assert.equal(await mode(), 'desk');
    assert.equal(navigations, 1, 'only the deliberate reload should have navigated');

    assert.deepEqual(errors, [], `${who}: page errors: ${errors.join('; ')}`);
    await context.close();
  }
  console.log('Desk checks passed on touch and mouse: Send never reloads, two tools, the checklist ' +
    'and its left-out items, the rewrite check, the length refusal, the privacy meter, nothing ' +
    'stored, and a header that leaves the screen to the conversation.');
} finally {
  await browser.close();
}
