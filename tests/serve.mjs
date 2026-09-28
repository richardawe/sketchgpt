// A static server for web/, with the content types GitHub Pages sends (wasm
// must be application/wasm or the browser refuses to stream-compile it).
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, normalize } from "node:path";

const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };

export async function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split("?")[0]);
    const name = normalize(path === "/" ? "/browser.html" : path).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(root, name));
      res.writeHead(200, { "content-type": TYPES[name.slice(name.lastIndexOf("."))] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}
