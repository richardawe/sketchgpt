// The illustrations: well-formed, reachable by name, and credited.
//
//   node --test tests/art.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ART, ART_BOX } from "../web/art.mjs";
import { ART_NAMES } from "../web/art-names.mjs?v=8";
import { STAMPS } from "../web/stamps.mjs?v=8";
import { resolveStamp, parseSketch } from "../web/sketch.mjs?v=8";

test("every picture is a list of [path, fill] shapes in a 36-unit box", () => {
  assert.equal(ART_BOX, 36);
  assert.ok(Object.keys(ART).length >= 200);
  for (const [name, shapes] of Object.entries(ART)) {
    assert.ok(shapes.length, `${name} is empty`);
    for (const s of shapes) {
      assert.match(s[0], /^[Mm]/, `${name}: a shape that is not a path`);
      assert.match(s[1], /^#[0-9a-f]{3,8}$|^[a-z]+$/i, `${name}: fill ${s[1]}`);
    }
  }
});

test("every word points at a picture that exists", () => {
  for (const [word, name] of Object.entries(ART_NAMES)) assert.ok(ART[name], `${word} -> ${name}, which is missing`);
});

test("the nouns the icons never had now draw", () => {
  for (const w of ["cow", "pig", "horse", "sheep", "chicken", "barn", "snowman", "beach umbrella", "whale"])
    assert.ok(ART[resolveStamp(w)], `${w} did not resolve to an illustration (got ${resolveStamp(w)})`);
});

test("names shared with the line icons are the same names", () => {
  // So a drawing's commands read the same with or without the illustrations.
  for (const n of ["house", "tree-deciduous", "tree-pine", "sun", "moon", "cloud", "sailboat", "user", "car"])
    assert.ok(ART[n] && STAMPS[n], n);
  assert.equal(parseSketch('{"t":"x","c":["tree 50 50 20"]}').commands[0].text, "tree-deciduous");
});

test("every name the scene composer places has something to draw", () => {
  const src = readFileSync(new URL("../web/scene.mjs", import.meta.url), "utf8");
  const listed = new Set();
  for (const block of src.matchAll(/new Set\(\[([\s\S]*?)\]\)/g))
    for (const m of block[1].matchAll(/"([a-z0-9-]+)"/g)) listed.add(m[1]);
  const settingsOnly = new Set(["waves-horizontal", "road", "left", "right", "middle", "centre", "center",
    "sky", "back", "front", "water", "behind", "far", "near", "top", "bottom", "foreground", "background",
    "wind", "bridge", "trees", "fuel"]);
  for (const n of listed) if (!settingsOnly.has(n)) assert.ok(ART[n] || STAMPS[n], `scene.mjs places "${n}", which has no drawing`);
});

test("the licence travels with the art", () => {
  const head = readFileSync(new URL("../web/art.mjs", import.meta.url), "utf8").slice(0, 400);
  assert.match(head, /Twemoji/);
  assert.match(head, /CC-BY 4\.0/);
  assert.match(readFileSync(new URL("../web/sketch.mjs", import.meta.url), "utf8"), /CC-BY 4\.0/,
    "the credit is not written into drawn SVGs");
  assert.match(readFileSync(new URL("../web/browser.html", import.meta.url), "utf8"), /Twemoji<\/a> \(CC-BY 4\.0\)/,
    "the page does not credit the illustrations");
});
