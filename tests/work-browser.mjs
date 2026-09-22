// Work mode, end to end in a real page.
//
//   node tests/work-browser.mjs
//
// tests/work.test.mjs checks the rules; this checks that the page obeys them.
// The assertions that matter are the ones counting calls to the model: a
// document too long to check must never be summarised, and a question the
// document shares no word with must never be sent. Those are refusals, and a
// refusal that only exists in a pure function is a refusal the UI can forget.
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

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
      features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 }
    }) } });
    window.requests = [];
    window.result = 'The answer.';
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/mock.mjs')
      return route.fulfill({ contentType: 'text/javascript', body: stub });
    const name = url.pathname.replace(/^.*\//, '');
    const file = /^(sketch|stamps|rough|work)\.mjs$/.test(name) ? name : 'browser.html';
    await route.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
      body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
  });

  await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
  await page.click('#load');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);

  const calls = () => page.evaluate(() => window.requests.length);
  const lastPrompt = () => page.evaluate(() =>
    window.requests.at(-1).messages.map(m => m.content).join('\n'));
  const send = async text => {
    await page.fill('#input', text);
    await page.click('#send');
    await page.waitForFunction(() => !document.querySelector('#send').disabled);
  };
  // Indexing is debounced, so wait for the summary to actually change rather
  // than for it to merely look plausible — it may still be the last document's.
  // Clear first and wait for the empty state, then fill: comparing the summary
  // against its previous value looks right and is not — two different
  // documents with the same word and passage count produce the same string,
  // and the wait then never fires.
  const setPaste = async text => {
    await page.fill('#paste', '');
    await page.waitForFunction(
      () => /Nothing loaded/.test(document.querySelector('#doc').textContent), null, { timeout: 10000 });
    await page.fill('#paste', text);
    await page.waitForFunction(
      () => !/Nothing loaded/.test(document.querySelector('#doc').textContent), null, { timeout: 10000 });
  };

  // ---- the tray only exists in Work mode --------------------------------
  assert.equal(await page.locator('#work.open').count(), 0, 'the tray showed in chat mode');
  await page.selectOption('#output', 'work');
  assert.equal(await page.locator('#work.open').count(), 1);
  assert.equal(await page.locator('#task').count(), 1);

  // Every use case is offered, grouped.
  const tasks = await page.evaluate(() =>
    [...document.querySelectorAll('#task option')].map(o => o.value));
  for (const id of ['draft', 'rewrite', 'shorten', 'expand', 'summarise', 'explain', 'reply',
                    'brainstorm', 'structure', 'organise', 'creative', 'questions', 'critique',
                    'roleplay', 'plan', 'translate', 'decide'])
    assert.ok(tasks.includes(id), `task missing from the page: ${id}`);

  // ---- a short text is worked on whole ----------------------------------
  const SHORT = 'The boiler has been broken since Tuesday. I have called twice and nobody came.';
  await setPaste(SHORT);
  assert.match(await page.locator('#doc').textContent(), /14 words/);

  await page.selectOption('#task', 'rewrite');
  const before = await calls();
  await send('for my landlord');
  assert.equal(await calls(), before + 1, 'the model was not run on a short text');
  assert.ok((await lastPrompt()).includes(SHORT), 'the source text never reached the model');
  assert.match(await lastPrompt(), /never add a fact|only with the text/i);
  // The source is shown with the answer, because that is the only thing that
  // makes the answer checkable.
  assert.equal(await page.locator('.msg.assistant .used blockquote').count(), 1);
  assert.match(await page.locator('.used blockquote').last().textContent(), /boiler has been broken/);

  // ---- a long document is NOT summarised --------------------------------
  const LONG = Array.from({ length: 150 }, (_, i) =>
    `Clause ${i}. Residents report repairs through the portal and complaints to the housing officer.`
  ).join('\n\n');
  await setPaste(LONG);
  assert.match(await page.locator('#doc').textContent(), /150 passages/);
  assert.match(await page.locator('#doc').textContent(), /too long to read whole/);

  await page.selectOption('#task', 'summarise');
  const beforeSummary = await calls();
  await send('');
  assert.equal(await calls(), beforeSummary,
    'a document too long to check was sent to the model to summarise');
  assert.match(await page.locator('.msg.assistant .note').last().textContent(), /too long/i);
  // What it shows instead is passages, verbatim — a contents list, not prose.
  const contents = await page.locator('.msg.assistant').last().locator('.used blockquote').count();
  assert.ok(contents > 0, 'nothing was shown in place of the summary');

  // ---- a question with no overlap never reaches the model ---------------
  await page.selectOption('#task', 'explain');
  const beforeMiss = await calls();
  await send('what about parking permits');
  assert.equal(await calls(), beforeMiss, 'an unanswerable question was sent to the model');
  assert.match(await page.locator('.msg.assistant .note').last().textContent(),
    /Nothing was sent to the model/);

  // ---- a question with overlap is answered from passages only -----------
  const beforeHit = await calls();
  await send('complaints');
  assert.equal(await calls(), beforeHit + 1, 'an answerable question was not sent');
  const prompt = await lastPrompt();
  assert.ok(prompt.length < LONG.length, 'the whole document was sent despite not fitting');
  assert.match(prompt, /extract, not the whole document/i);

  // Everything the model saw is on the screen, and vice versa.
  const shown = await page.locator('.msg.assistant').last().locator('.used blockquote')
    .allTextContents();
  assert.ok(shown.length > 0, 'an answer was shown with no passages');
  for (const s of shown)
    assert.ok(prompt.includes(s.trim()), 'a passage was shown that the model never saw');

  // ---- the file cap is enforced before the file is read -----------------
  const huge = 'word '.repeat(150000);                 // ~750 KB
  await page.setInputFiles('#file', {
    name: 'huge.txt', mimeType: 'text/plain', buffer: Buffer.from(huge) });
  await page.waitForFunction(() => document.querySelector('#doc').classList.contains('bad'));
  assert.match(await page.locator('#doc').textContent(), /limit is 512 KB/);

  await page.setInputFiles('#file', {
    name: 'lease.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await page.waitForFunction(() =>
    /PDF is not supported/.test(document.querySelector('#doc').textContent));

  // A file within the cap loads, and its name is shown.
  await page.fill('#paste', '');
  await page.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain',
    buffer: Buffer.from('Meet Ana at four. Bring the blue folder and the receipts.') });
  await page.waitForFunction(() => /notes\.txt/.test(document.querySelector('#doc').textContent));
  assert.match(await page.locator("#doc").textContent(), /11 words/);

  // ---- a passage is text, never markup ----------------------------------
  await page.setInputFiles('#file', []);
  await setPaste('<img src=x onerror=alert(1)> and **not bold** in my note.');
  await page.selectOption('#task', 'explain');
  await send('what does it say');
  assert.equal(await page.locator('.used img').count(), 0, 'a supplied document was parsed as HTML');
  assert.match(await page.locator('.used blockquote').last().textContent(), /<img src=x/);

  // ---- role-play keeps a conversation without re-sending the source ------
  await setPaste('I am asking my landlord about the broken boiler.');
  await page.selectOption('#task', 'roleplay');
  await page.evaluate(() => { window.result = 'I will look into it.'; });
  await send('you are my landlord');
  await send('when will someone come?');
  const second = await lastPrompt();
  assert.match(second, /you are my landlord/, 'role-play lost the earlier turn');
  // The built prompt carries the source; the stored history must not, or every
  // turn puts another copy of the document in the window.
  assert.equal(second.split('broken boiler').length - 1, 1,
    'the source was sent more than once in a role-play turn');

  // ---- the document is never persisted ----------------------------------
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!stored.includes('blue folder') && !stored.includes('boiler'),
    'the document was written to localStorage');

  // ---- chat and sketch are untouched -------------------------------------
  await page.selectOption('#output', 'chat');
  assert.equal(await page.locator('#work.open').count(), 0);
  const beforeChat = await calls();
  await page.evaluate(() => { window.result = 'Hello there.'; });
  await send('hi');
  assert.equal(await calls(), beforeChat + 1);
  assert.ok(!(await lastPrompt()).includes('blue folder'), 'work state leaked into chat');

  assert.deepEqual(errors, [], 'page errors: ' + errors.join('; '));
  console.log('Work mode checks passed: tray, all 17 tasks, whole-text turns, the ' +
    'refusal to summarise an unreadable document, the refusal to send an unanswerable ' +
    'question, passages shown matching passages sent, the file cap, and no persistence.');
} finally {
  await browser.close();
}
