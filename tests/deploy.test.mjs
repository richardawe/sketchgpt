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
  const queue = ["browser.html"];
  while (queue.length) {
    const file = queue.shift();
    for (const m of web(file).matchAll(/from\s+"\.\/([\w-]+\.mjs)(?:\?[^"]*)?"/g)) {
      if (!found.has(m[1])) { found.add(m[1]); queue.push(m[1]); }
    }
  }
  return [...found];
}

test("the page's module graph is what we think it is", () => {
  const found = modules();
  for (const m of ["sketch.mjs", "desk.mjs", "scene.mjs", "stamps.mjs", "art-names.mjs"]) assert.ok(found.includes(m), m);
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
  for (const f of ["browser.html", ...modules()]) {
    for (const m of web(f).matchAll(/from\s+"\.\/([\w-]+\.mjs)\?v=(\d+)"/g)) {
      if (seen.has(m[1])) assert.equal(m[2], seen.get(m[1]), `${m[1]} is imported as v=${m[2]} and v=${seen.get(m[1])}`);
      seen.set(m[1], m[2]);
    }
  }
});
