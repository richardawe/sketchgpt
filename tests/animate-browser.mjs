// ?animate=1 in the real page, on a touch screen: pictures move, the book is
// read aloud with the device's voice, printing stops everything still — and
// without the flag none of it loads.
//
//   node tests/animate-browser.mjs
//
// speechSynthesis is replaced by a recorder, so this checks what the page
// asks the voice to say and when, not how it sounds. Nothing here has run on
// a real iPhone; that is what ?animate=1 is for.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { return {
 interruptGenerate() {},
 chat: { completions: { async create(req) {
 window.requests.push(req);
 return (async function* () { yield { choices: [{ delta: { content: window.story } }] }; })();
 } } }
}; }`;

const STORY = JSON.stringify({
  title: 'Pip and the Sea',
  cast: [{ name: 'Pip', is: 'dog' }, { name: 'Mr. Gull', is: 'bird' }],
  pages: ['Pip is a little dog who lives on a farm. He dreams of the sea.',
    'Pip wants to see the sea, but it is far away.',
    'Pip walks past the village, but he gets lost.',
    'Mr. Gull flies down and shows Pip the way to the beach.',
    'Pip jumps into the sea. He swims in the waves.',
    'As the sun sets, Pip and Mr. Gull watch the boats come home.']
});

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' };

const browser = await launch();
try {
  for (const animate of [true, false]) {
    const context = await browser.newContext(phone);
    const page = await context.newPage();
    const errors = [], fetched = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(story => {
      Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
        features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 }
      }) } });
      if (navigator.storage) navigator.storage.estimate = async () => ({ quota: 50e9, usage: 0 });
      window.requests = []; window.story = story;
      // The device's voice, recorded rather than heard.
      window.spoken = [];
      const voices = [{ name: 'Albert', lang: 'en-US', localService: true, voiceURI: 'Albert' },
        { name: 'Ava (Enhanced)', lang: 'en-US', localService: true, voiceURI: 'Ava' }];
      Object.defineProperty(window, 'speechSynthesis', { value: {
        getVoices: () => voices, speak(u) { window.spoken.push(u); },
        cancel() { window.spoken = []; }, onvoiceschanged: null } });
      window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
      // The book's own animations only: the page's interface has some of its own.
      window.print = () => { window.animsWhilePrinting = [...document.querySelectorAll('.book .art svg')]
        .reduce((n, svg) => n + svg.getAnimations({ subtree: true }).length, 0); };
    }, STORY);
    await page.route('**/*', async r => {
      const url = new URL(r.request().url());
      if (url.pathname === '/mock.mjs') return r.fulfill({ contentType: 'text/javascript', body: stub });
      const name = url.pathname.replace(/^.*\//, '');
      fetched.push(name);
      const file = /^(sketch|stamps|rough|book|scene|art|art-names|animate|voice)\.mjs$/.test(name) ? name : 'browser.html';
      await r.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
        body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
    });

    await page.goto(`http://localhost:8080/browser.html?lib=/mock.mjs&manual=1${animate ? '&animate=1' : ''}`);
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
    await page.click('#load');
    await page.waitForFunction(() => !document.querySelector('#send').disabled);
    await page.fill('#input', 'a little dog who has never seen the sea');
    await page.click('#send');
    await page.waitForFunction(() => !document.querySelector('#send').disabled &&
      !/writing|drawing/.test(document.querySelector('#status').textContent));
    const book = page.locator('.msg.assistant .book').last();
    assert.equal(await book.locator('.art svg').count(), 7, 'every page and the cover get a picture');

    if (!animate) {
      assert.ok(!fetched.includes('animate.mjs') && !fetched.includes('voice.mjs'), 'animation loaded without the flag');
      assert.equal(await book.locator('.book-actions button', { hasText: 'Read aloud' }).count(), 0);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('.book .art svg')]
        .reduce((n, svg) => n + svg.getAnimations({ subtree: true }).length, 0)), 0, 'a picture moved without the flag');
      assert.deepEqual(errors, []);
      await context.close();
      continue;
    }

    // ---- Pictures move, and say how --------------------------------------------
    assert.ok(await page.evaluate(() => document.getAnimations().length) > 10, 'the pictures are not moving');
    const made = await book.locator('.made p').allTextContents();
    assert.match(made[4], /Moving: Pip \(dog\): hop, then swim/, made[4]);
    assert.match(made[3], /Mr\. Gull \(bird\): fly/, made[3]);
    assert.doesNotMatch(made[0], /Moving/, 'a dream is not a deed: page 1 should not move Pip');
    // The zoom is on the picture's box, not redrawn inside the SVG.
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.book .art > svg')]
      .some(svg => svg.getAnimations().length)), 'the camera should move the <svg> element itself');
    // Off-screen pages are paused.
    const states = await page.evaluate(() => document.querySelector('.book .sheet:nth-of-type(6) svg').getAnimations().map(a => a.playState));
    assert.ok(states.length && states.every(s => s === 'paused'), `page 5, off screen, should be paused: ${states}`);

    // ---- The voice picker ------------------------------------------------------
    const select = book.locator('.voice-row select');
    assert.deepEqual(await select.locator('option').allTextContents(),
      ['Best available (Ava (Enhanced))', 'Ava (Enhanced) · en-US', 'Albert · en-US']);
    assert.match(await book.locator('.reader-note').textContent(), /2 voices on this device/);
    if (process.env.SHOT) await book.locator('.book-actions').evaluate(n => n.scrollIntoView({ block: 'center' })) ||
      await page.screenshot({ path: process.env.SHOT });
    await select.selectOption({ label: 'Albert · en-US' });
    assert.equal(await page.evaluate(() => localStorage.getItem('sketchgpt.voice')), 'Albert', 'the choice is not remembered');
    await book.locator('.voice-row button', { hasText: 'Try' }).click();
    assert.deepEqual(await page.evaluate(() => window.spoken.map(u => [u.text, u.voice.name])),
      [['Once upon a time, a little dog went to see the sea.', 'Albert']]);
    assert.equal(await select.evaluate(s => getComputedStyle(s).fontSize), '16px', 'under 16px, iOS zooms the page');

    // ---- Read aloud ------------------------------------------------------------
    const read = book.locator('.book-actions button.read');
    await read.click();
    const spoken = await page.evaluate(() => window.spoken.map(u => u.text));
    assert.equal(spoken[0], 'Pip and the Sea', 'the title is read first');
    assert.equal(spoken.at(-1), 'The End');
    assert.deepEqual(spoken.slice(1, 3), ['Pip is a little dog who lives on a farm.', 'He dreams of the sea.'],
      'pages are read a sentence at a time');
    assert.equal(spoken.length, 1 + 8 + 1, 'every sentence queued at once, inside the tap');
    assert.ok(spoken.includes('Mr. Gull flies down and shows Pip the way to the beach.'), 'a title split a sentence');
    assert.equal(await page.evaluate(() => window.spoken[0].voice.name), 'Albert', 'the picked voice reads the book');
    assert.equal(await read.textContent(), 'Stop reading');
    // As a sentence starts it is marked, and its page's picture plays again.
    await page.evaluate(() => window.spoken[1].onstart());
    assert.equal(await book.locator('.said.reading').textContent(), 'Pip is a little dog who lives on a farm. ');
    await page.evaluate(() => window.spoken[6].onstart());
    assert.match(await book.locator('.said.reading').textContent(), /^Pip jumps into the sea/);
    assert.equal(await book.locator('.reading').count(), 1, 'only one sentence is marked');
    await page.evaluate(() => window.spoken.at(-1).onend());
    await page.waitForFunction(() => [...document.querySelectorAll('.book-actions button')].some(b => b.textContent === 'Read aloud'));
    assert.equal(await book.locator('.reading').count(), 0, 'the mark stays after the reading ended');

    // ---- Printing stops everything still, then it moves again -------------------
    await book.locator('.book-actions button', { hasText: 'Print' }).click();
    assert.equal(await page.evaluate(() => window.animsWhilePrinting), 0, 'pictures were moving while printing');
    await page.waitForTimeout(1700);
    assert.ok(await page.evaluate(() => document.getAnimations().length) > 10, 'pictures did not move again after printing');

    assert.deepEqual(errors, [], errors.join('; '));
    await context.close();
  }
  console.log('Animate checks passed on a touch screen: pictures move and say how, a dream is not a deed, the zoom is on the ' +
    'picture box, off-screen pages pause, the book is read a sentence at a time with the best voice and marked as it goes, ' +
    'a voice picker lists the device\'s voices and remembers the choice, printing is still, and without ?animate=1 nothing loads or moves.');
} finally {
  await browser.close();
}
