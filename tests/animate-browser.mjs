// The default book, in the real page, on a touch screen: pictures move, the book is
// read aloud with the device's voice, printing stops everything still — and
// with ?animate=0 none of it loads.
//
//   node tests/animate-browser.mjs
//
// speechSynthesis is replaced by a recorder, so this checks what the page
// asks the voice to say and when, not how it sounds. The owner has run it on a
// real iPhone ("It works"); everything here is emulation.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

// The book the builder makes for these choices and ?seed=0 — written by the
// same rules here, so the test knows every word (web/story.mjs).
import { writeStory } from '../web/story.mjs';
import { sentences } from '../web/voice.mjs';
const CHOICES = { kind: 'dog', place: 'farm', wish: 'sea', name: 'Pip' };
const STORY = writeStory({ ...CHOICES, seed: 0 });

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' };

const browser = await launch();
try {
  for (const animate of [true, false]) {
    const context = await browser.newContext(phone);
    const page = await context.newPage();
    const errors = [], fetched = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({
        features: new Set(['shader-f16']), limits: { maxBufferSize: 1e9 }
      }) } });
      if (navigator.storage) navigator.storage.estimate = async () => ({ quota: 50e9, usage: 0 });
      window.requests = [];
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
    });
    await page.route('**/*', async r => {
      const url = new URL(r.request().url());
      const name = url.pathname.replace(/^.*\//, '');
      fetched.push(name);
      if (url.pathname.startsWith('/vendor/'))       // gifenc, for "Save this page as a GIF"
        return r.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../web' + url.pathname, import.meta.url), 'utf8') });
      const file = /^(sketch|stamps|rough|book|story|picture|gif|video|scene|art|art-names|animate|voice|share)\.mjs$/.test(name) ? name : 'browser.html';
      await r.fulfill({ contentType: file.endsWith('.mjs') ? 'text/javascript' : 'text/html',
        body: await readFile(new URL('../web/' + file, import.meta.url), 'utf8') });
    });

    // The default is on; ?animate=0 is the plain book.
    await page.goto(`http://localhost:8080/browser.html?seed=0${animate ? '' : '&animate=0'}`);
    for (const [id, v] of [['kinds', 'dog'], ['places', 'farm'], ['wishes', 'sea']]) await page.tap(`#${id} [data-value="${v}"]`);
    await page.fill('#hero-name', 'Pip');
    await page.tap('#write');
    await page.waitForFunction(() => document.querySelector('.book .book-actions') && !document.querySelector('#write').disabled);
    const book = page.locator('.msg.assistant .book').last();
    assert.deepEqual(await book.locator('.page-text').evaluateAll(p => p.slice(0, 6).map(x => x.textContent.trim())),
      STORY.pages, 'the builder did not make the book these rules make for ?seed=0');
    assert.ok(!fetched.includes('mock.mjs'), 'a book fetched the model library');
    assert.equal(await book.locator('.art svg').count(), 7, 'every page and the cover get a picture');

    if (!animate) {
      assert.ok(!fetched.includes('animate.mjs') && !fetched.includes('voice.mjs') && !fetched.includes('share.mjs'),
        'animation, voice or sharing loaded with ?animate=0');
      assert.equal(await book.locator('.book-actions button', { hasText: 'Read aloud' }).count(), 0);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('.book .art svg')]
        .reduce((n, svg) => n + svg.getAnimations({ subtree: true }).length, 0)), 0, 'a picture moved with ?animate=0');
      assert.deepEqual(errors, []);
      await context.close();
      continue;
    }

    // ---- Pictures move, and say how --------------------------------------------
    assert.ok(await page.evaluate(() => document.getAnimations().length) > 10, 'the pictures are not moving');
    const made = await book.locator('.made p').allTextContents();
    assert.match(made[5], /Moving: Pip \(dog\): swim/, made[5]);
    assert.match(made[3], /Bird \(bird\): fly/, made[3]);
    assert.match(made[2], /Pip \(dog\): run/, made[2]);
    // Scenery: page 3 names no place, so it is still on the farm (a wish for
    // the sea on page 2 does not move it), and the far hills move less than
    // the picture — depth.
    assert.match(made[2], /Still at the farm/, made[2]);
    assert.doesNotMatch(made[1], /Still at/, 'a page that mentions a place is not carried over');
    assert.ok(await page.evaluate(() => { const far = document.querySelector('.book .sheet:nth-of-type(2) [data-layer="far"]');
      return far && far.getAnimations().length > 0; }), 'the far hills do not move');
    assert.doesNotMatch(made[1], /Pip \(dog\)/, 'a wish is not a deed: page 2 should not move Pip');
    // The zoom is on the picture's box, not redrawn inside the SVG.
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.book .art > svg')]
      .some(svg => svg.getAnimations().length)), 'the camera should move the <svg> element itself');
    // Off-screen pages are paused.
    const states = await page.evaluate(() => document.querySelector('.book .sheet:nth-of-type(6) svg').getAnimations().map(a => a.playState));
    assert.ok(states.length && states.every(s => s === 'paused'), `page 5, off screen, should be paused: ${states}`);

    // ---- The voice picker ------------------------------------------------------
    // The bar is at the top of the book, and the voice picker is one tap into it.
    assert.ok(await book.evaluate(b => b.firstElementChild.classList.contains('book-top')), 'the bar is not at the top of the book');
    await book.locator('.book-bar .voice-btn').click();
    assert.equal(await book.locator('.book-bar .voice-btn').getAttribute('aria-expanded'), 'true');
    const select = book.locator('.voice-row select');
    assert.deepEqual(await select.locator('option').allTextContents(),
      ['Best available (Ava (Enhanced))', 'Ava (Enhanced) · en-US', 'Albert · en-US']);
    assert.match(await book.locator('.reader-note:not(.share-note)').textContent(), /2 voices on this device/);
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
    const all = STORY.pages.flatMap(sentences);
    assert.equal(spoken[0], STORY.title, 'the title is read first');
    assert.equal(spoken.at(-1), 'The End');
    assert.deepEqual(spoken.slice(1, 3), sentences(STORY.pages[0]), 'pages are read a sentence at a time');
    assert.equal(spoken.length, 1 + all.length + 1, 'every sentence queued at once, inside the tap');
    assert.equal(await page.evaluate(() => window.spoken[0].voice.name), 'Albert', 'the picked voice reads the book');
    assert.equal(await read.textContent(), 'Stop reading');
    // As a sentence starts it is marked, and its page's picture plays again.
    await page.evaluate(() => window.spoken[1].onstart());
    assert.equal(await book.locator('.said.reading').textContent(), sentences(STORY.pages[0])[0] + ' ');
    assert.match(await book.locator('.book-top .share-note').textContent(), /Reading page 1 of 6 · Albert/);
    // The first sentence of page 5, wherever it falls in the queue.
    const five = 1 + STORY.pages.slice(0, 4).flatMap(sentences).length;
    await page.evaluate(i => window.spoken[i].onstart(), five);
    assert.match(await book.locator('.book-top .share-note').textContent(), /Reading page 5 of 6/);
    assert.equal(await book.locator('.said.reading').textContent(), sentences(STORY.pages[4])[0] + ' ');
    assert.equal(await book.locator('.reading').count(), 1, 'only one sentence is marked');
    await page.evaluate(() => window.spoken.at(-1).onend());
    await page.waitForFunction(() => [...document.querySelectorAll('.book-actions button')].some(b => b.textContent === 'Read aloud'));
    assert.equal(await book.locator('.reading').count(), 0, 'the mark stays after the reading ended');

    // ---- A page as a GIF: it moves, it has the page's words, the page moves on ----
    await page.evaluate(() => document.querySelector('.book .sheet:nth-of-type(4)').scrollIntoView({ block: 'center' }));
    await book.locator('.book-bar .more-btn').click();
    const t0 = Date.now();
    const [gifFile] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }),
      book.locator('.more-panel button.gif').click()]);
    const gifMs = Date.now() - t0;
    assert.equal(gifFile.suggestedFilename(), STORY.title.replace(/\s+/g, '-') + '-page-3.gif');
    const bytes = await readFile(await gifFile.path());
    assert.equal(bytes.subarray(0, 6).toString(), 'GIF89a');
    // Every frame starts with a graphic control extension (21 F9); the frames differ, so the picture moved.
    const frames = bytes.toString('latin1').split('\x21\xF9').slice(1);
    // (The byte pair can also occur inside compressed image data: at least 20.)
    assert.ok(frames.length >= 20, `${frames.length} frames`);
    assert.ok(new Set(frames).size > 5, `only ${new Set(frames).size} different frames: the picture did not move`);
    assert.match(await book.locator('.book-top .share-note').textContent(), /Page 3 saved as a GIF .* silent/);
    assert.ok(await page.evaluate(() => document.querySelector('.book .sheet:nth-of-type(4) svg').getAnimations()
      .some(a => a.playState === 'running')), 'the page stopped moving after its GIF was made');
    console.log(`  GIF: ${frames.length} frames, ${Math.round(bytes.length / 1024)} KB, ${gifMs} ms`);

    // ---- The whole book as a video: every sheet, moving, a real file ------------
    const v0 = Date.now();
    const [videoFile] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }),
      book.locator('.more-panel button.video').click()]);
    const videoMs = Date.now() - v0;
    const vname = videoFile.suggestedFilename();
    assert.match(vname, new RegExp('^' + STORY.title.replace(/\s+/g, '-') + '\\.(mp4|webm)$'), vname);
    const vbytes = await readFile(await videoFile.path());
    // MP4 has "ftyp" at byte 4; WebM starts with the EBML magic 1A 45 DF A3. (This Chromium build has no
    // H.264 encoder, so it makes WebM; Chrome, Edge and Safari make MP4.)
    assert.ok(vbytes.subarray(4, 8).toString() === 'ftyp' || vbytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
      'not an MP4 or a WebM');
    // Played back in the page: 8 sheets (cover, 6 pages, The End) at 4 s each, 2.5 s for the end.
    const meta = await page.evaluate(async b64 => {
      const v = document.createElement('video'); v.muted = true;
      v.src = 'data:' + (b64.startsWith('AAAA') ? 'video/mp4' : 'video/webm') + ';base64,' + b64;
      await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error('the video does not play')); });
      if (!isFinite(v.duration)) { v.currentTime = 1e6; await new Promise(r => { v.ontimeupdate = r; }); }
      return { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
    }, vbytes.toString('base64'));
    assert.deepEqual([meta.w, meta.h], [540, 720]);
    assert.ok(Math.abs(meta.duration - (7 * 4 + 2.5)) < 1.2, `the video is ${meta.duration} s long`);
    assert.match(await book.locator('.book-top .share-note').textContent(), /saved as a video \((MP4|WEBM), .* silent/);
    assert.ok(await page.evaluate(() => document.querySelector('.book .sheet:nth-of-type(4) svg').getAnimations()
      .some(a => a.playState === 'running')), 'the book stopped moving after its video was made');
    console.log(`  video: ${vname.split('.').pop()}, ${meta.duration.toFixed(1)} s, ${(vbytes.length / 1e6).toFixed(1)} MB, made in ${videoMs} ms`);
    await book.locator('.book-bar .more-btn').click();

    // ---- Printing stops everything still, then it moves again -------------------
    await book.locator('.book-bar .more-btn').click();
    assert.ok(await book.locator('.voice-panel').isHidden(), 'one panel at a time');
    await book.locator('.more-panel button', { hasText: 'Print' }).click();
    assert.equal(await page.evaluate(() => window.animsWhilePrinting), 0, 'pictures were moving while printing');
    await page.waitForTimeout(1700);
    assert.ok(await page.evaluate(() => document.getAnimations().length) > 10, 'pictures did not move again after printing');

    assert.deepEqual(errors, [], errors.join('; '));
    await context.close();
  }
  console.log('Animate checks passed on a touch screen: pictures move and say how, a dream is not a deed, the zoom is on the ' +
    'picture box, off-screen pages pause, the book is read a sentence at a time with the best voice and marked as it goes, ' +
    'a voice picker lists the device\'s voices and remembers the choice, printing is still, and with ?animate=0 nothing loads or moves.');
} finally {
  await browser.close();
}
