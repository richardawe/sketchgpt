// Stop must stop, and the page must survive it.
//
//   node tests/stop.mjs
//
// The bug this exists for: web-llm 0.2.85 acquires a per-model lock inside
// chat.completions.create() and releases it at the END of the async generator
// body, with no try/finally around it. Abandoning the generator early — which
// is what `break` inside a `for await` does — terminates it at the suspended
// yield, so the release never runs and CustomLock.acquired stays true for the
// life of the page. The next create() awaits a lock nobody will release.
//
// The symptom is not "Stop does nothing". Stop looks like it works: the text
// halts, the button hides, Send comes back. The NEXT message hangs on
// "generating…" for ever, with no error anywhere, and pressing Stop then does
// nothing at all because the generator that reads interruptSignal never
// started. One press bricked chat.
//
// The engine stub below reproduces exactly that lock discipline, so this test
// fails against the old `break` and passes against the drain. Nothing here
// checks WebLLM itself — it checks that the page does not abandon a stream.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

// CustomLock and asyncGenerate, faithfully: acquire in create(), release only
// when the generator body runs to its end; interruptSignal cleared on entry
// and checked once per decode step.
const stub = `export const prebuiltAppConfig = { model_list: [] };
export const hasModelInCache = async () => false;
export async function CreateMLCEngine() {
  let acquired = false; const queue = [];
  const acquire = async () => { if (!acquired) { acquired = true; return; }
    window.blocked = (window.blocked || 0) + 1;
    return new Promise(r => queue.push(r)); };
  const release = async () => { if (queue.length) queue.shift()(); else acquired = false; };
  let interrupt = false;
  return {
    interruptGenerate() { interrupt = true; window.interrupts = (window.interrupts || 0) + 1; },
    chat: { completions: { async create(req) {
      window.requests = window.requests || []; window.requests.push(req);
      await acquire();
      return (async function* () {
        interrupt = false;                       // asyncGenerate clears it on entry
        window.started = (window.started || 0) + 1;
        let n = 0;
        for (; n < 400; n++) {
          if (interrupt) break;                  // pipeline.triggerStop()
          await new Promise(r => setTimeout(r, 8));
          yield { choices: [{ delta: { content: 'tick ' } }] };
        }
        window.finished = (window.finished || 0) + 1;
        window.lastTicks = n;
        await release();                         // ONLY on a clean exit
      })();
    } } }
  };
}`;

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
      features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 }
    }) } });
      // A normal disk. Headless Chromium here offers ~0.9 GB, which makes the page
      // (correctly) pick a smaller model than a real desktop gets.
      if (navigator.storage) navigator.storage.estimate = async () => ({ quota: 50e9, usage: 0 });
      // The model streams in Sketch; Book writes with rules and has nothing to stop.
      localStorage.setItem('sketchgpt.cfg', JSON.stringify({ output: 'sketch' }));
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/mock.mjs')
      return route.fulfill({ contentType: 'text/javascript', body: stub });
    const name = url.pathname.replace(/^.*\//, '');
    const file = /^(sketch|stamps|rough|book|story|scene|art|art-names)\.mjs$/.test(name) ? name : 'browser.html';
    await route.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
      body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
  });

  await page.goto('http://localhost:8080/browser.html?lib=/mock.mjs&manual=1');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'ready to load');
  await page.click('#load');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);

  const ready = () => page.waitForFunction(
    () => !document.querySelector('#send').disabled, null, { timeout: 15000 });

  // ---- 1. a stop stops --------------------------------------------------
  await page.fill('#input', 'a dog who counts');
  await page.click('#send');
  await page.waitForFunction(() => window.started === 1);
  await page.waitForTimeout(150);                 // some ticks arrive
  await page.click('#stop');
  await ready();

  assert.match(await page.locator('.msg.assistant').last().textContent(), /stopped/i, 'Stop was not reported');
  // The generator must have run to its end rather than being abandoned: that
  // is the whole difference between draining and breaking.
  assert.equal(await page.evaluate(() => window.finished), 1,
    'the stream was abandoned mid-generation — its lock was never released');

  const before = await page.evaluate(() => document.querySelector('.msg.assistant .body').textContent);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.querySelector('.msg.assistant .body').textContent), before,
    'text kept arriving after Stop');

  // ---- 2. the chat still works afterwards -------------------------------
  // This is the assertion that fails against `break`: create() blocks on a
  // lock that was never released, and nothing below ever resolves.
  await page.fill('#input', 'again please');
  await page.click('#send');
  await page.waitForFunction(() => window.started === 2, null, { timeout: 15000 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.blocked || 0), 0,
    'the second turn had to wait for a leaked lock');
  assert.equal(await page.evaluate(() => window.started), 2, 'the second generation never began');

  // ---- 3. and it can be stopped again ------------------------------------
  await page.click('#stop');
  await ready();
  assert.equal(await page.evaluate(() => window.finished), 2, 'the second stream was abandoned');

  // ---- 4. a stop during prefill is not lost ------------------------------
  // asyncGenerate sets interruptSignal = false on its way in, so a click that
  // lands before the body starts is cleared. Re-asserting on every chunk is
  // what covers it; without that this turn runs to its full 400 ticks.
  await page.fill('#input', 'third');
  await page.evaluate(() => {
    document.querySelector('#send').click();
    document.querySelector('#stop').click();   // same task, before any chunk
  });
  await ready();
  const third = await page.evaluate(() => window.lastTicks);
  assert.ok(third < 50, `a stop issued during prefill was lost: ${third} ticks arrived`);

  assert.deepEqual(errors, [], 'page errors: ' + errors.join('; '));
  console.log('Stop checks passed: stops, says so, releases the ' +
    'stream lock, survives a second turn, and is not lost during prefill.');
} finally {
  await browser.close();
}
