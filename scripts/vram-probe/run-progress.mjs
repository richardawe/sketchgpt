// Drive progress.html in headless Chromium and print the timeline.
//
//   node run-progress.mjs <model-id> <wasm-file> [kbit/s]
//
// The optional third argument throttles the connection through CDP, which is
// the point: the gap between "Start to fetch params" and the first real tick
// is invisible over localhost and minutes long on a phone.
import { chromium } from 'playwright';
const [model, wasm, kbps] = process.argv.slice(2);
const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--max-old-space-size=4096'],
});
const p = await b.newPage();
if (kbps && kbps !== '0') {
  const c = await p.context().newCDPSession(p);
  await c.send('Network.enable');
  await c.send('Network.emulateNetworkConditions', {
    offline: false, latency: 60,
    downloadThroughput: Number(kbps) * 1024 / 8,
    uploadThroughput: 500 * 1024 / 8,
  });
  console.log(`[throttled to ${kbps} kbit/s]`);
}
await p.goto(`http://127.0.0.1:8099/progress.html?model=${model}&wasm=${wasm}`);
try { await p.waitForFunction(() => document.title === 'DONE', { timeout: 900000 }); }
catch { console.log('TIMEOUT; partial:'); }
console.log(await p.textContent('#o'));
await b.close();
