// Render a story written by scripts/storybook.mjs as a picture book: a cover,
// one illustrated page per page of text, and a standalone HTML file that
// prints one page per sheet. Uses the page's real composer and renderer.
import { readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PW);
const [storyFile, outBase] = process.argv.slice(2);
const story = JSON.parse(await readFile(storyFile, 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CH, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 1.5 });
const CSS = `
  :root { --paper:#fbf6ea; --ink:#2b2622; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e9e2d2; font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif; color: var(--ink); }
  .book { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  .sheet { background: var(--paper); border-radius: 6px; box-shadow: 0 2px 6px rgb(0 0 0 / .08), 0 18px 40px rgb(0 0 0 / .10);
           padding: 28px 30px 30px; margin: 0 0 28px; page-break-after: always; break-after: page; }
  .cover { text-align: center; padding: 40px 30px 34px; }
  .cover h1 { font-size: 40px; line-height: 1.1; margin: 6px 0 10px; letter-spacing: -0.01em; }
  .cover .by { font: italic 16px Georgia, serif; color: #6b6259; margin-bottom: 18px; }
  .art svg { display: block; width: 100%; height: auto; border-radius: 4px; }
  .art > :not(svg) { display: none; }
  .text { font-size: 21px; line-height: 1.55; margin: 20px 6px 0; }
  .text::first-letter { font-size: 1.9em; float: left; line-height: 1; margin: 2px 6px 0 0; font-weight: bold; }
  .num { text-align: center; font: italic 14px Georgia, serif; color: #8a8076; margin-top: 16px; }
  .credit { text-align: center; font: 12px -apple-system, sans-serif; color: #8a8076; margin-top: 8px; }
  @media print { body { background: none; } .sheet { box-shadow: none; margin: 0; } }
`;
await page.route('**/*', async route => {
  const n = new URL(route.request().url()).pathname.replace(/^.*\//, '');
  if (n === 'book.html') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset=utf-8><title>book</title><style>${CSS}</style><div class=book id=book></div>` });
  await route.fulfill({ contentType: 'text/javascript', body: await readFile('web/' + n, 'utf8') });
});
await page.goto('http://localhost:8080/book.html');
await page.evaluate(async story => {
  const sk = await import('./sketch.mjs?v=9');
  const sc = await import('./scene.mjs?v=10');
  const rough = await sk.loadRough('./rough.mjs');
  const art = await sk.loadArt('./art.mjs?v=8');
  const book = document.getElementById('book');
  const sheet = cls => { const s = document.createElement('section'); s.className = 'sheet ' + (cls || ''); book.append(s); return s; };
  const draw = (into, t, entries) => {
    const composed = sc.composeScene({ t, c: entries });
    const box = document.createElement('div'); box.className = 'art'; into.append(box);
    sk.renderSketch(box, JSON.stringify({ t: composed.t, c: composed.c }), { rough, art, spread: false });
  };
  // Cover: the cast on the first page's setting.
  const cover = sheet('cover');
  const h = document.createElement('h1'); h.textContent = story.title; cover.append(h);
  const by = document.createElement('div'); by.className = 'by';
  by.textContent = 'Written by a 1.7-billion-parameter model · drawn by the page'; cover.append(by);
  // The cover shows the whole cast in the first page's setting.
  draw(cover, story.title + ' ' + story.pages[0].text, [...story.cast.map(c => 'big ' + c.is + ' front'), ...story.pages[0].plan.c.filter(e => !/^big /.test(e))]);
  story.pages.forEach((p, i) => {
    const s = sheet();
    draw(s, p.text, p.plan.c);          // the page text decides day/night, beach, street
    const t = document.createElement('p'); t.className = 'text'; t.textContent = p.text; s.append(t);
    const n = document.createElement('div'); n.className = 'num'; n.textContent = '— ' + (i + 1) + ' —'; s.append(n);
  });
  const end = sheet();
  end.innerHTML = '<p class="text" style="text-align:center">The End</p><p class="credit">Story by Qwen3-1.7B, run locally · pictures placed and drawn by sketchgpt · illustrations from Twemoji (CC-BY 4.0) · inference by WebLLM</p>';
}, story);
const sheets = await page.locator('.sheet').count();
for (let i = 0; i < sheets; i++) await page.locator('.sheet').nth(i).screenshot({ path: `${outBase}-${i}.png` });
await page.screenshot({ path: `${outBase}-all.png`, fullPage: true });
const html = await page.evaluate(() => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
  document.querySelector('h1').textContent + '</title>' + document.querySelector('style').outerHTML + '</head><body>' + document.getElementById('book').outerHTML + '</body></html>');
await writeFile(`${outBase}.html`, html);
console.log(`${sheets} sheets, ${(html.length / 1024).toFixed(0)} KB standalone HTML`);
await browser.close();
