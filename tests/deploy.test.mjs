// Every module the page imports must be deployed, and cached for offline.
//
//   node --test tests/deploy.test.mjs
//
// The deploy workflow copies an explicit list of files, and the service
// worker precaches an explicit list. Adding web/scene.mjs almost shipped a
// page that imported a file the site did not have — a 404 on a module import
// kills the whole page — and every browser test passed, because they serve
// web/ directly. This reads the imports and checks both lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const web = f => readFileSync(new URL("../web/" + f, import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
const sw = web("sw.js");

function modules() {
  const found = new Set();
  const queue = ["browser.html", "selfie.html"];
  while (queue.length) {
    const file = queue.shift();
    // Static imports AND import("./x.mjs"): the animation modules are loaded on
    // demand, and the first deploy of them 404'd because only `from` was read.
    for (const m of web(file).matchAll(/(?:from\s+|import\(\s*)"\.\/([\w-]+\.mjs)(?:\?[^"]*)?"/g)) {
      if (!found.has(m[1])) { found.add(m[1]); queue.push(m[1]); }
    }
  }
  return [...found];
}

test("the page's module graph is what we think it is", () => {
  const found = modules();
  for (const m of ["sketch.mjs", "book.mjs", "scene.mjs", "stamps.mjs", "art-names.mjs", "animate.mjs", "voice.mjs"])
    assert.ok(found.includes(m), m);
});

test("every imported module is copied by the deploy workflow", () => {
  for (const m of modules()) assert.match(workflow, new RegExp(`cp web/${m.replace(".", "\\.")}\\s`), `${m} is not deployed`);
});

test("every imported module is precached by the service worker", () => {
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  for (const m of modules()) assert.ok(shell.includes(`"./${m}"`), `${m} is not cached for offline use`);
  // rough.mjs and art.mjs are loaded dynamically, not imported, and must be
  // cached (and deployed) too.
  for (const m of ["rough.mjs", "art.mjs"]) {
    assert.ok(shell.includes(`"./${m}"`), `${m} is not cached for offline use`);
    assert.match(workflow, new RegExp(`cp web/${m.replace(".", "\\.")}\\s`), `${m} is not deployed`);
  }
});

test("every versioned import of a module uses the same version", () => {
  const seen = new Map();
  for (const f of ["browser.html", "selfie.html", ...modules()]) {
    for (const m of web(f).matchAll(/(?:from\s+|import\(\s*)"\.\/([\w-]+\.mjs)\?v=(\d+)"/g)) {
      if (seen.has(m[1])) assert.equal(m[2], seen.get(m[1]), `${m[1]} is imported as v=${m[2]} and v=${seen.get(m[1])}`);
      seen.set(m[1], m[2]);
    }
  }
});

test("selfie.html is deployed, and every vendored file it loads exists and is deployed", async () => {
  assert.match(workflow, /cp web\/selfie\.html\s/);
  assert.match(workflow, /cp -r web\/vendor\s+_site\/vendor/);
  const { existsSync } = await import("node:fs");
  const refs = new Set();
  for (const f of ["selfie.html", "face-find.mjs"])
    for (const m of web(f).matchAll(/"\.\/vendor\/([\w./-]+)"/g)) refs.add(m[1]);
  // face-find.mjs names its models and wasm by folder; list what it loads.
  for (const m of ["face_detector", "face_landmarks_detector", "hair_segmenter", "selfie_segmenter"]) refs.add(`models/${m}.tflite`);
  for (const f of ["litert_wasm_internal.js", "litert_wasm_internal.wasm", "litert_wasm_compat_internal.js", "litert_wasm_compat_internal.wasm", "wasm-utils.mjs"]) refs.add("litert/" + f);
  for (const r of refs) assert.ok(existsSync(new URL("../web/vendor/" + r, import.meta.url)), `web/vendor/${r} is missing`);
  assert.ok(refs.size >= 10);
});

test("an updated worker deletes only its own old caches, never the model weights", async () => {
  // Runs web/sw.js's activate handler against a fake origin whose caches hold
  // an old shell AND WebLLM's weights. Deleting everything but VERSION made
  // every visitor download the model again whenever sw.js changed.
  const handlers = {}, deleted = [];
  const self = { addEventListener: (type, fn) => { handlers[type] = fn; }, clients: { claim: async () => {} },
    location: { origin: "https://example.test" }, skipWaiting() {} };
  const caches = { keys: async () => ["sketchgpt-v7", "webllm/model", "webllm/config", "webllm/wasm", "transformers-cache",
      sw.match(/const VERSION = "([^"]+)"/)[1]],
    delete: async key => { deleted.push(key); return true; } };
  new Function("self", "caches", "fetch", sw)(self, caches, async () => { throw new Error("offline"); });
  let work;
  handlers.activate({ waitUntil: p => { work = p; } });
  await work;
  assert.deepEqual(deleted, ["sketchgpt-v7"]);
});

test("film-probe.html is deployed with its module, every asset it loads, and its vendored files", async () => {
  const { existsSync } = await import("node:fs");
  assert.match(workflow, /cp web\/film-probe\.html\s/);
  assert.match(workflow, /cp -r web\/film\s+_site\/film/);
  const html = web("film-probe.html"), mod = web("film/probe.mjs");
  assert.match(html, /"\.\/film\/probe\.mjs\?v=\d+"/);
  const vendor = [...mod.matchAll(/"\.\.\/vendor\/([\w.-]+\.mjs)(?:\?v=\d+)?"/g)].map(m => m[1]);
  assert.deepEqual(vendor.sort(), ["mediabunny-film.mjs", "three.mjs"]);
  for (const v of vendor) assert.ok(existsSync(new URL(`../web/vendor/${v}`, import.meta.url)), `vendor/${v} missing`);
  const assets = new Set([...mod.matchAll(/"([\w-]+\.(?:glb|hdr))"/g)].map(m => m[1]));
  assert.ok(assets.size >= 9, `${assets.size} assets named`);
  for (const a of assets) assert.ok(existsSync(new URL(`../web/film/assets/${a}`, import.meta.url)), `film/assets/${a} missing`);
  assert.ok(existsSync(new URL("../web/film/assets/LICENSE.txt", import.meta.url)), "the assets say where they came from");
});
