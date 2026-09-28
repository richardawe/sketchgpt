// Selfie mode's fixture review: every photo in a folder through the real page
// (web/selfie.html, MediaPipe's models on LiteRT.js, CPU/WASM) in headless Chromium, saving
// the caricature at slider 0, 1 and 2 next to the photo, plus the page's
// report (faces found, timings, colours) — docs/selfie.md, stage 0.
//
//   PLAYWRIGHT_MODULE=... SKETCH_CHROME=... node scripts/face-bench.mjs <photos-dir> <out-dir>
//
// Photos: openly licensed portraits (the first set was NASA's public-domain
// astronaut portraits from Wikimedia Commons). Out: <name>-<amount>.png and
// index.html, a side-by-side sheet for people to judge — likeness, and
// whether any drawing reads as a stereotype. Only people can judge those.
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "../tests/serve.mjs";
import { launch } from "../tests/browser.mjs";
import { lightness } from "../web/face.mjs";

const [dir, out] = process.argv.slice(2).map(p => resolve(p));
mkdirSync(out, { recursive: true });
const photos = readdirSync(dir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const server = await serve(new URL("../web/", import.meta.url).pathname);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
const outside = [];
page.on("request", r => { if (!r.url().startsWith(server.url) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
page.on("pageerror", e => console.log("pageerror", e.message));
await page.goto(server.url + "selfie.html");
const rows = [];
for (const f of photos) {
  await page.setInputFiles("#file", join(dir, f));
  await page.waitForFunction(() => document.querySelector("#stage svg") || getComputedStyle(document.querySelector("#errbox")).display !== "none", null, { timeout: 120000 });
  const report = await page.evaluate(() => window.__selfie.report);
  const notes = await page.$$eval("#notes li", l => l.map(x => x.textContent));
  const shots = [];
  if (await page.$("#stage svg")) {
    for (const amount of ["0", "1", "2"]) {
      await page.$eval("#amount", (el, v) => { el.value = v; el.dispatchEvent(new Event("change")); }, amount);
      await page.evaluate(() => window.__selfie.data && document.querySelector("#stage svg"));
      await page.waitForTimeout(150);
      const name = `${f.replace(/\.\w+$/, "")}-${amount}.png`;
      await (await page.$("#stage")).screenshot({ path: join(out, name) });
      shots.push(name);
    }
    const d = await page.evaluate(() => { const d = window.__selfie.data; return { colours: d.colours, hair: d.hair.length, fringe: d.fringe.length, strokes: d.strokes.length, shade: d.shade.length, ears: d.ears, bytes: JSON.stringify(d).length }; });
    Object.assign(report, d);
  } else report.error = await page.$eval("#errmsg", e => e.textContent);
  // Skin must be drawn at the photo's own lightness (docs/selfie.md).
  if (report.colours) report.skinDrawnL = +lightness(report.colours.skin).toFixed(1);
  if (report.error && process.env.DEBUG) console.log(report);
  console.log(f, JSON.stringify({ faces: report.faces, ms: report.totalMs, skinL: [report.skinPhotoL, report.skinDrawnL], halves: report.skinHalvesL, dropped: report.skinShadowDropped, ...report.colours && { colours: report.colours }, hair: report.hair, strokes: report.strokes, shade: report.shade, bytes: report.bytes, notes, error: report.error }));
  rows.push({ f, shots, report, notes });
}
writeFileSync(join(out, "index.html"), `<!doctype html><meta charset=utf-8><title>face bench</title><style>body{font:13px sans-serif}td{vertical-align:top}img{width:200px}</style><table>` +
  rows.map(r => `<tr><td><img src="${join(dir, r.f)}"><br>${r.f}</td>${r.shots.map(s => `<td><img src="${s}"><br>${s}</td>`).join("")}<td><pre>${JSON.stringify({ ...r.report, notes: r.notes }, null, 1)}</pre></td></tr>`).join("") + `</table>`);
console.log("requests outside the site:", outside.length ? outside : "none");
await browser.close(); server.close();
