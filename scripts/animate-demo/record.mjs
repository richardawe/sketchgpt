// Prototype of animated book pages (web/animate.mjs), recorded from real captured
// model output in scripts/demo-books/. Writes video/*.webm, a still, and prints
// what the page decided. Convert with ffmpeg, e.g. ffmpeg-static.
//
//   PLAYWRIGHT_MODULE=... SKETCH_CHROME=... node scripts/animate-demo/record.mjs dog 4 12
// Serve the repo's web/ and the captured books, open the prototype, record it.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const HERE = new URL(".", import.meta.url).pathname, REPO = join(HERE, "../..");
const types = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.startsWith("/web/") ? join(REPO, path) : path.startsWith("/books/") ? join(REPO, "scripts/demo-books", path.slice(7)) : join(HERE, path);
  let body; try { body = await readFile(file); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(file)] || "text/plain" }); res.end(body);
}).listen(0);
const port = server.address().port;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ executablePath: process.env.SKETCH_CHROME });
const [book = "dog", page = "4", secs = "12"] = process.argv.slice(2);
const ctx = await browser.newContext({ viewport: { width: 480, height: 760 }, deviceScaleFactor: 1,
  recordVideo: { dir: join(HERE, "video"), size: { width: 480, height: 760 } } });
const p = await ctx.newPage();
const errors = []; p.on("pageerror", e => errors.push(e.message)); p.on("console", m => m.type() === "error" && errors.push(m.text()));
await p.goto(`http://localhost:${port}/page.html?book=${book}&page=${page}`);
await p.waitForFunction(() => window.__ready, null, { timeout: 30000 });
console.log(JSON.stringify(await p.evaluate(() => window.__said), null, 1));
await p.waitForTimeout(Number(secs) * 1000);
await p.screenshot({ path: join(HERE, `frame-${book}-${page}.png`) });
const video = p.video(); await ctx.close(); console.log("video:", await video.path());
console.log("errors:", errors);
await browser.close(); server.close();
