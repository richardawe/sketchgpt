// The prototype's one piece of reading: who does what, from the page's words.
//
//   node --test tests/animate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageActions } from "../web/animate.mjs";

const pip = { name: "Pip", is: "dog" }, bay = { name: "Mr. Bay", is: "bird" }, mum = { name: "Mum", is: "human" };
const cast = [pip, bay, mum];

test("a hop, then swimming — and nothing after something that can go on", () => {
  // Real Qwen3-1.7B page (scripts/demo-books/dog.json, page 4).
  const a = pageActions("Pip jumps into the water, and the cool, salty breeze fills him. He swims and plays, chasing fish and waves.", cast);
  assert.deepEqual(a.get(pip), ["hop", "swim"]);
});

test("the doer is the character a sentence names; a pronoun keeps the last one", () => {
  const a = pageActions("Mr. Bay flies past them, singing songs of the sea. Pip looks up. He smiles.", cast);
  assert.deepEqual(a.get(bay), ["fly"]);
  assert.deepEqual(a.get(pip), ["look", "cheer"]);
});

test("a page that names nobody is the hero's, and a page with no verbs moves nobody", () => {
  assert.deepEqual(pageActions("The dog ran to the beach.", cast).get(pip), ["run"]);
  assert.equal(pageActions("The sky is blue, and the wind is light.", cast).size, 0);
});

test("waves are water, not a greeting", () => {
  assert.equal(pageActions("Pip sits by the waves.", cast).size, 0);
});

test("a wish, a dream or a can't is not something the picture does", () => {
  // Real Qwen3-1.7B pages (scripts/demo-books/dog-shaped.json, pages 2, 3 and 5).
  const lucky = { name: "Lucky", is: "dog" };
  assert.equal(pageActions("Lucky wants to see the sea, but he has never been outside the woods. He dreams of swimming and seeing the ocean from afar.", [lucky]).size, 0);
  assert.deepEqual(pageActions("Lucky tries to find the sea by following the sound of waves, but he can't find it. He gets tired and returns to his house.", [lucky]).get(lucky),
    ["look", "run"]);
  assert.deepEqual(pageActions("Lucky follows the light and finally reaches the sea. He swims in the water and feels the cool, salty breeze.", [lucky]).get(lucky),
    ["run", "swim"]);
});

test("being told to do something is not doing it", () => {
  const lucky = { name: "Lucky", is: "dog" };
  assert.equal(pageActions("A friendly bird named Fluff helps Lucky by showing him the path to the sea. Fluff tells him to follow the shimmering light of the ocean.", [lucky]).size, 0);
  assert.deepEqual(pageActions("Lucky returns to his house.", [lucky]).get(lucky), ["run"]);
});
