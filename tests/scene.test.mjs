// Scene mode: the model lists things, the page places them.
//
//   node --test tests/scene.test.mjs
//
// Every entry string below came out of Qwen3-1.7B on Ollama during the runs
// recorded in docs/sketch-scenes.md — including the ones that broke earlier
// versions of this module ("blue sky" became a building; "sun front" put the
// sun on the grass; a leaked moon turned a sunny party into night).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEntry, composeScene, looksLikeCoordinates, scenePrompt } from "../web/scene.mjs?v=6";
import { parseSketch, GRID } from "../web/sketch.mjs?v=6";

const plan = (t, c) => composeScene({ t, c });
const drawn = composed => parseSketch(JSON.stringify({ t: composed.t, c: composed.c }), { spread: false });
const stamps = composed => drawn(composed).commands.filter(c => c.tool === "stamp");

test("counts, colours and places are read, in any order", () => {
  assert.deepEqual(parseEntry("pine tree x3"), { stamp: "tree-pine", said: "pine tree", count: 3, colour: null, place: null, setting: null, scale: 1 });
  assert.equal(parseEntry("3 trees").count, 3);
  assert.equal(parseEntry("boat ×2").count, 2);
  assert.equal(parseEntry("red balloons").colour, "red");
  assert.equal(parseEntry("bird x4 sky").place, "sky");
});

test("nouns are read left to right, past words that are not things", () => {
  assert.equal(parseEntry("cake on table").stamp, "cake");
  assert.equal(parseEntry("children playing").stamp, "child");
});

test("setting words shape the backdrop instead of being printed", () => {
  for (const [entry, setting] of [["beach", "water"], ["sand", "water"], ["lake x2", "water"],
                                  ["street x2", "road"], ["farm", "none"], ["green grass", "none"]])
    assert.equal(parseEntry(entry).setting, setting, entry);
  // The stamp matcher's prefix rule once turned "sky" into a building, via
  // the "skyscraper" alias.
  const sky = parseEntry("blue sky");
  assert.ok(sky === null || !sky.stamp, `"blue sky" drew ${sky && sky.stamp}`);
  assert.equal(parseEntry("front"), null);
  assert.equal(parseEntry("black"), null);
});

test("things with no drawing stay words, never the nearest icon", () => {
  // "cow" was this test's example until the illustrations drew one.
  const llama = parseEntry("llama x2");
  assert.equal(llama.stamp, null);
  assert.equal(llama.said, "llama");
  assert.equal(parseEntry("cow x2").stamp, "cow");
});

test("counts are capped where more than one makes no sense", () => {
  assert.equal(parseEntry("5 suns").count, 1);      // verbatim
  assert.equal(parseEntry("sun x2").count, 1);      // the numbering pattern
  assert.equal(parseEntry("moon x3").count, 1);
});

test("every composed coordinate is on the canvas", () => {
  for (const [t, c] of [
    ["A farm", ["farm", "tractor", "cow x2", "pig x1", "chicken x3", "bird x2", "grain field", "sun front"]],
    ["A city street", ["street x2", "shop x3", "car x4", "house x2", "tree x2", "sun"]],
    ["A beach", ["sun x2", "people x3", "boat x2", "sand", "sea"]],
    ["Lots", Array.from({ length: 20 }, (_, i) => ["tree", "house", "car", "dog", "flower"][i % 5] + " x8")],
  ]) {
    for (const cmd of drawn(plan(t, c)).commands) {
      for (const n of cmd.args) assert.ok(n >= 0 && n <= GRID, `${t}: ${cmd.tool} at ${cmd.args}`);
    }
  }
});

test("sky things are drawn in the sky, whatever the model said", () => {
  const out = stamps(plan("A birthday party in the garden",
    ["cake", "gift x3", "sun front", "cloud sky", "flower front", "bird x2"]));
  const sun = out.find(s => s.text === "sun");
  assert.ok(sun.args[1] < 30, `the sun is at y=${sun.args[1]}`);
  for (const b of out.filter(s => s.text === "bird")) assert.ok(b.args[1] < 50);
  for (const g of out.filter(s => s.text === "gift")) assert.ok(g.args[1] > 62, "a gift floated");
});

test("a sun means day: a leaked moon and stars are dropped, the sky stays light", () => {
  const c = plan("A birthday party in the garden", ["cake", "person x3", "sun front", "moon", "star x4"]);
  assert.ok(c.c.includes("sky day"));
  const names = stamps(c).map(s => s.text);
  assert.ok(!names.includes("moon") && !names.includes("star"), names.join(" "));
});

test("rain rules out a sun (Qwen3-1.7B put one in a rainy day in town)", () => {
  const c = plan("A rainy day in town", ["rain x3", "road", "house x2", "tree x2", "cloud sky", "sun front"]);
  assert.ok(c.c.includes("sky rain"));
  assert.ok(!stamps(c).some(s => s.text === "sun"), "a sun was drawn on a rainy day");
});

test("a sunset gets a dusk sky with the sun low (a story page got midday)", () => {
  const c = plan("As the sun dipped below the horizon, Pip looked at the ocean", ["dog front", "sea"]);
  assert.ok(c.c.includes("sky dusk"), c.c.join(" | "));
  const sun = stamps(c).find(s => s.text === "sun");
  assert.ok(sun && sun.args[1] > 30, `the setting sun is at y=${sun && sun.args[1]}`);
  assert.ok(plan("An evening walk", ["dog"]).c.includes("sky dusk"), "evening is dusk, not night");
});

test("size words scale a thing: the story's hero is drawn big", () => {
  assert.equal(parseEntry("big dog front").scale, 1.7);
  assert.equal(parseEntry("little bird").scale, 0.7);
  const big = stamps(plan("A dog", ["big dog front"])).find(s => s.text === "dog").args[2];
  const plain = stamps(plan("A dog", ["dog front"])).find(s => s.text === "dog").args[2];
  assert.ok(big > plain * 1.4, `big ${big} vs plain ${plain}`);
});

test("a girl is a standing child, not a baby's face", () => {
  assert.equal(parseEntry("girl").stamp, "girl");
  assert.equal(parseEntry("boy").stamp, "boy");
  assert.equal(parseEntry("baby").stamp, "baby");
});

test("night comes from the title, the moon, or stars without a sun", () => {
  assert.ok(plan("A cosy cabin in the woods at night", ["cabin", "tree x3"]).c.includes("sky night"));
  assert.ok(plan("A cabin", ["cabin", "moon"]).c.includes("sky night"));
  assert.ok(plan("A camp", ["tent", "star night"]).c.includes("sky night"));
});

test("water sits behind the shore, with boats on it and people in front", () => {
  const c = plan("A sunny beach", ["sun", "people x3", "boat x2", "sand", "sea"]);
  const water = Number(c.c.find(l => l.startsWith("water ")).split(" ")[1]);
  const shore = Number(c.c.find(l => l.startsWith("sand ")).split(" ")[1]);
  assert.ok(water < shore, "the sea was drawn in front of the beach");
  const out = stamps(c);
  for (const b of out.filter(s => s.text === "sailboat")) assert.ok(b.args[1] > water && b.args[1] < shore, `boat at ${b.args[1]}`);
  for (const p of out.filter(s => s.text === "users" || s.text === "user")) assert.ok(p.args[1] > shore, `person at ${p.args[1]}`);
});

test("a lake is grass, a beach is sand", () => {
  assert.ok(plan("A camping trip by a lake", ["tent", "lake", "fire x2"]).c.some(l => l.startsWith("ground ")));
  assert.ok(plan("A sunny beach", ["sand", "sea", "boat"]).c.some(l => l.startsWith("sand ")));
});

test("a short word does not match a longer one it merely starts ('line' is not a liner)", () => {
  assert.notEqual(parseEntry("line").stamp, "ship");
});

test("a repeated entry is drawn once", () => {
  const c = plan("Loop", Array(40).fill("line tree"));
  assert.equal(stamps(c).filter(s => s.text === "tree-deciduous").length, 1);
});

test("the same plan always gives the same picture", () => {
  const a = plan("A city street", ["shop x3", "car x4", "tree x2", "sun"]);
  const b = plan("A city street", ["shop x3", "car x4", "tree x2", "sun"]);
  assert.deepEqual(a.c, b.c);
});

test("a coordinate answer is recognised and left alone", () => {
  assert.equal(looksLikeCoordinates(["house 25 55 40", "tree 78 50 34", "sun 82 14 16"]), true);
  assert.equal(looksLikeCoordinates(["cabin x1", "moon x1 sky", "star x2 back", "tree x3 green"]), false);
});

test("the scene prompt teaches counts as xN and keeps night out of the example", () => {
  const p = scenePrompt(14);
  assert.match(p, /x3/);
  assert.match(p, /Only put a moon or stars in a night picture/);
  assert.doesNotMatch(p.split("Draw a quiet harbour")[1], /moon|star/, "the example's sky would leak into daytime scenes");
});
