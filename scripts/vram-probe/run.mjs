import { chromium } from 'playwright';
const [model, wasm, ctx, gen] = process.argv.slice(2);
const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--max-old-space-size=4096'],
});
const p = await b.newPage();
p.on('response', r => { if (r.status() >= 400) console.log('[http]', r.status(), r.url()); });
const url = `http://127.0.0.1:8099/measure.html?model=${model}&wasm=${wasm}` + (ctx ? `&ctx=${ctx}` : '') + (gen ? '&gen=1' : '');
await p.goto(url);
try { await p.waitForFunction(() => document.title === 'DONE', { timeout: 900000 }); }
catch (e) { console.log('TIMEOUT; partial:'); }
console.log(await p.textContent('#o'));
await b.close();
