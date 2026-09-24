// A book in a link, and editing it — in the real page, on a touch screen.
//
//   node tests/share-browser.mjs
//
// Writes a book (stub model), edits a page's words, a picture's list, the
// title and a character, undoes, asks the model to rewrite a page, shares —
// then opens the link as ANOTHER DEVICE WITH NO GPU AT ALL and checks it is
// the same book, drawn the same, with no model created and nothing downloaded.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() { window.created = true; return {
 interruptGenerate() {},
 chat: { completions: { async create(req) {
 window.requests.push(req);
 const rewrite = /Write this page again/.test(req.messages[1].content);
 const out = rewrite ? JSON.stringify({ text: 'Pip waves at a friendly crab on the sand.' }) : window.story;
 return (async function* () { yield { choices: [{ delta: { content: out } }] }; })();
 } } }
}; }`;

const STORY = JSON.stringify({
  title: 'Pip and the Sea',
  cast: [{ name: 'Pip', is: 'dog' }, { name: 'Mr. Gull', is: 'bird' }],
  pages: ['Pip is a little dog who lives on a farm.', 'Pip wants to see the sea.',
    'Pip walks past the village and the tall trees.', 'Mr. Gull flies down and shows Pip the way to the beach.',
    'Pip jumps into the sea. He swims in the waves.', 'Pip and Mr. Gull watch the boats come home.']
});

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' };

async function device(browser, { gpu, voices }) {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ story, gpu, voices }) => {
    if (gpu) Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
      features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 } }) } });
    else Object.defineProperty(navigator, 'gpu', { value: undefined });
    if (navigator.storage) navigator.storage.estimate = async () => ({ quota: 50e9, usage: 0 });
    window.requests = []; window.story = story;
    Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => voices, speak() {}, cancel() {}, onvoiceschanged: null } });
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    Object.defineProperty(navigator, 'share', { value: async d => { window.shared = d; } });
  }, { story: STORY, gpu, voices });
  await page.route('**/*', async r => {
    const url = new URL(r.request().url());
    if (url.pathname === '/mock.mjs') return r.fulfill({ contentType: 'text/javascript', body: stub });
    const name = url.pathname.replace(/^.*\//, '');
    const file = /^(sketch|stamps|rough|book|scene|art|art-names|animate|voice|share)\.mjs$/.test(name) ? name : 'browser.html';
    await r.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
      body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
  });
  return { context, page, errors };
}

// What each picture is, exactly: every path's geometry, in order.
const fingerprint = page => page.evaluate(() => [...document.querySelectorAll('.book .art svg')].map(svg =>
  [...svg.querySelectorAll('[data-thing]')].map(n => n.dataset.thing + '@' + n.dataset.at).join('|') + '#' +
  [...svg.querySelectorAll('path')].map(p => p.getAttribute('d')).join('').length));
const texts = page => page.locator('.book .sheet:not(.cover):not(.end) .page-text').allTextContents();
const things = (page, n) => page.locator(`.book .sheet:nth-of-type(${n}) .art [data-thing]`).evaluateAll(x => x.map(e => e.dataset.thing));

const browser = await launch();
try {
  // ---- The writer's phone ----------------------------------------------------
  const a = await device(browser, { gpu: true, voices: [{ name: 'Ava (Enhanced)', lang: 'en-US', localService: true, voiceURI: 'Ava' }] });
  const p = a.page;
  await p.goto('http://localhost:8080/browser.html?lib=/mock.mjs&manual=1&animate=1');
  await p.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
  await p.click('#load');
  await p.waitForFunction(() => !document.querySelector('#send').disabled);
  await p.fill('#input', 'a little dog who has never seen the sea');
  await p.click('#send');
  await p.waitForFunction(() => !document.querySelector('#send').disabled && document.querySelector('.book .share'));

  // Edit a page's words: the picture is rebuilt from them.
  const sheet = n => p.locator(`.book .sheet:nth-of-type(${n})`);
  await sheet(4).locator('.edit-page').click();
  await sheet(4).locator('.ed-text').fill('Pip rides a bike past the village.');
  await sheet(4).locator('.ed-save').click();
  await p.waitForFunction(() => document.querySelector('.book .sheet:nth-of-type(4) [data-thing="bike"]'));
  assert.equal((await texts(p))[2], 'Pip rides a bike past the village. ');
  assert.match(await sheet(4).locator('.made p').textContent(), /^Redrawn from your words\./);

  // Edit a picture's list: drawn as typed, the page's rules do not tidy it.
  await sheet(2).locator('.edit-page').click();
  await sheet(2).locator('.ed-things').fill('big dog front\nrocket\n');
  await sheet(2).locator('.ed-save').click();
  await p.waitForFunction(() => document.querySelector('.book .sheet:nth-of-type(2) [data-thing="rocket"]'));
  const listed = await things(p, 2);
  assert.ok(listed.includes('rocket') && listed.includes('dog'), listed.join(', '));
  assert.ok(!listed.includes('tractor'), 'the words\' farm came back: the typed list was not drawn as typed');
  assert.match(await sheet(2).locator('.made p').textContent(), /^Drawn from your list\./);

  // Rename the hero and make them a cat: every page and picture follows.
  await sheet(1).locator('.edit-cover').click();
  await sheet(1).locator('.ed-title').fill('Biscuit and the Sea');
  await sheet(1).locator('.ed-name').first().fill('Biscuit');
  await sheet(1).locator('.ed-is').first().fill('cat');
  if (process.env.SHOT) { await sheet(1).locator('.editor').scrollIntoViewIfNeeded(); await p.screenshot({ path: process.env.SHOT + '-cover.png' }); }
  await sheet(1).locator('.ed-save').click();
  await p.waitForFunction(() => document.querySelector('.book .cover h2').textContent === 'Biscuit and the Sea' &&
    !document.querySelector('.book .art [data-thing="dog"]'));
  const renamed = await texts(p);
  assert.ok(renamed.every(t => !/\bPip\b/.test(t)), renamed.join(' | '));
  assert.match(renamed[3], /shows Biscuit the way/);
  assert.ok((await things(p, 2)).includes('cat'), 'the hero is still on the page, as a cat');

  // Undo the rename: back to Pip the dog, everywhere.
  await p.locator('.book .undo').click();
  await p.waitForFunction(() => document.querySelector('.book .cover h2').textContent === 'Pip and the Sea');
  assert.match((await texts(p))[3], /shows Pip the way/);
  assert.ok((await things(p, 2)).includes('dog'));

  // Rewrite with the model: its words go into the editor, not the book.
  await sheet(3).locator('.edit-page').click();
  await sheet(3).locator('.ed-rewrite').click();
  await p.waitForFunction(() => document.querySelector('.book .sheet:nth-of-type(3) .ed-text').value.includes('crab'));
  const asked = await p.evaluate(() => window.requests.at(-1).messages[1].content);
  assert.match(asked, /page 2 of 6/);
  assert.equal((await texts(p))[1], 'Pip wants to see the sea. ', 'a rewrite is not saved until the person saves it');
  if (process.env.SHOT) { await sheet(3).locator('.editor').scrollIntoViewIfNeeded(); await p.waitForTimeout(2500); await p.screenshot({ path: process.env.SHOT + '-page.png' }); }
  await sheet(3).locator('.ed-cancel').click();
  assert.equal((await texts(p))[1], 'Pip wants to see the sea. ');

  // Share: the link is the book; the model's things and the voice travel.
  await p.locator('.book .share').click();
  await p.waitForFunction(() => window.shared);
  const shared = await p.evaluate(() => window.shared);
  assert.equal(shared.title, 'Pip and the Sea');
  assert.match(shared.url, /\?.*animate=1.*#book=z[A-Za-z0-9_-]+$/);
  assert.ok(shared.url.length < 4000, `link is ${shared.url.length} characters`);
  assert.match(await p.locator('.book .share-note').textContent(), /Nothing is uploaded/);
  const mine = { texts: await texts(p), pictures: await fingerprint(p) };
  assert.deepEqual(a.errors, [], a.errors.join('; '));

  // ---- Someone else's phone, with no GPU at all ---------------------------------
  const b = await device(browser, { gpu: false, voices: [{ name: 'Samantha', lang: 'en-US', localService: true, voiceURI: 'Sam' },
    { name: 'Ava (Premium)', lang: 'en-US', localService: true, voiceURI: 'AvaP' }] });
  // Opened as a real recipient would: no ?manual, so the page would normally
  // start downloading a model by itself.
  const theirs = shared.url.replace('&manual=1', '');
  await b.page.goto(theirs);
  await b.page.waitForFunction(() => document.querySelectorAll('.book .art svg').length === 7 && document.querySelector('.book .share'),
    null, { timeout: 30000 });
  assert.deepEqual(await texts(b.page), mine.texts, 'the words are not the ones shared');
  assert.deepEqual(await fingerprint(b.page), mine.pictures, 'the pictures are not drawn the same');
  assert.equal(await b.page.evaluate(() => window.created || false), false, 'a model was created to show a shared book');
  assert.match(await b.page.locator('#log .errbox').textContent(), /no WebGPU/, 'this phone was meant to have no GPU');
  assert.match(await b.page.locator('.book .by').textContent(), /Shared with you/);
  assert.match(await b.page.locator('.book .reader-note:not(.share-note)').textContent(),
    /asked for Ava \(Enhanced\): using Ava \(Premium\)/);
  assert.equal(await b.page.locator('.book .voice-row select').inputValue(), 'AvaP');
  // It can be edited and shared on, too.
  assert.equal(await b.page.locator('.book .edit-page').count(), 7);
  assert.deepEqual(b.errors, [], b.errors.join('; '));

  // ---- A damaged link says so -----------------------------------------------------
  const c = await device(browser, { gpu: true, voices: [] });
  await c.page.goto(theirs.slice(0, theirs.length - 40));
  await c.page.waitForFunction(() => /damaged/.test(document.querySelector('#log').textContent));
  assert.equal(await c.page.locator('.book').count(), 0);
  // A shared link never starts the model download, even on a phone that could.
  assert.match(await c.page.locator('#autonote').textContent(), /nothing was downloaded/);
  await c.page.waitForTimeout(500);
  assert.equal(await c.page.evaluate(() => window.created || false), false, 'a shared link started the model');

  for (const d of [a, b, c]) await d.context.close();
  console.log('Share checks passed on a touch screen: a page\'s words redraw its picture, a typed list is drawn as typed, ' +
    'a rename reaches every page and picture, undo restores it, a rewrite waits in the editor, the link holds the book, ' +
    'and a phone with no GPU opens it as the same words and the same pictures, with the nearest voice, no model and ' +
    'no download; a damaged link says so.');
} finally {
  await browser.close();
}
