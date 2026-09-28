// Kokoro's files for the Film voice test, served in place of their real URLs.
//
// In the sandbox this project is built in, headless Chromium's own requests
// through the proxy fail (ERR_TOO_MANY_RETRIES), but curl's work. So the files
// are fetched once with curl into KOKORO_MIRROR (default: the OS temp dir) and
// the browser's requests to huggingface.co / cdn.jsdelivr.net are redirected to
// a local server holding them. The page still asks for the real URLs, so the
// test sees exactly what a visitor's browser fetches. Bodies this big can't go
// through route.fulfill: it kills the browser.
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HF = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/";
const JS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/";
export const VOICE_FILES = ["af_heart", "af_bella", "bf_emma", "af_nicole", "af_sarah", "bf_isabella", "am_michael", "bm_george", "am_fenrir", "am_puck", "bm_fable"].map(v => `voices/${v}.bin`);
const FILES = [...["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx", ...VOICE_FILES].map(f => ["hf/" + f, HF + f]),
  ...["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"].map(f => ["js/" + f, JS + f])];

export function fetchMirror(dir = process.env.KOKORO_MIRROR || join(tmpdir(), "kokoro-mirror")) {
  for (const [path, url] of FILES) {
    const file = join(dir, path);
    if (existsSync(file)) continue;
    mkdirSync(dirname(file), { recursive: true });
    execFileSync("curl", ["-sSfL", "-o", file, url]);
  }
  return dir;
}

/** Route the context's Kokoro requests to the mirror. Returns the paths asked for, and close(). */
export async function mirror(context, dir) {
  const asked = [];
  const server = createServer(async (req, res) => {
    const file = join(dir, decodeURIComponent(req.url.split("?")[0]).replace(/\.\.+/g, ""));
    const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-length" };
    try {
      const { size } = await stat(file);
      const type = file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".mjs") ? "text/javascript" : file.endsWith(".json") ? "application/json" : "application/octet-stream";
      res.writeHead(200, { ...cors, "content-type": type, "content-length": size });
      createReadStream(file).pipe(res);
    } catch { res.writeHead(404, cors); res.end("not mirrored"); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  await context.route(/^https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, route => {
    const u = new URL(route.request().url());
    asked.push(route.request().method() + " " + u.host + u.pathname);
    const m = u.pathname.match(/\/resolve\/main\/(.+)$/) || u.pathname.match(/\/dist\/(ort-[^/]+)$/);
    if (!m) return route.fulfill({ status: 404, body: "not mirrored", headers: { "access-control-allow-origin": "*" } });
    return route.fulfill({ status: 302, headers: { location: `${base}/${u.host === "huggingface.co" ? "hf" : "js"}/${m[1]}`, "access-control-allow-origin": "*" } });
  });
  asked.close = () => server.close();
  return asked;
}
