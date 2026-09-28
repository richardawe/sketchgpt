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

// ---- Reading aloud (web/voice.mjs) ------------------------------------------
import { sentences, pickVoice, voiceOptions, readAloud } from "../web/voice.mjs";

test("a page is read one sentence at a time", () => {
  assert.deepEqual(sentences("Pip jumps in! He swims. “Look,” said Mum. The end…  "),
    ["Pip jumps in!", "He swims.", "“Look,” said Mum.", "The end…"]);
  assert.deepEqual(sentences("‘Look! The ocean is vast.’ He smiled."), ["‘Look!", "The ocean is vast.’", "He smiled."]);
  // A title is not a full stop.
  assert.deepEqual(sentences("Mr. Gull flies down. As the sun sets, Pip and Mrs. Gull watch."),
    ["Mr. Gull flies down.", "As the sun sets, Pip and Mrs. Gull watch."]);
});

test("the best local voice in the reader's language is chosen", () => {
  const v = (name, lang, localService = true) => ({ name, lang, localService });
  const voices = [v("Albert", "en-US"), v("Samantha", "en-US"), v("Ava (Enhanced)", "en-US"), v("Google UK English Male", "en-GB", false),
    v("Thomas", "fr-FR")];
  assert.equal(pickVoice(voices, "en").name, "Ava (Enhanced)");
  assert.equal(pickVoice(voices, "fr").name, "Thomas");
  assert.equal(pickVoice(voices, "de"), null);
});

test("every sentence is queued inside the tap, and each one marks itself as it starts", async () => {
  const queued = [];
  const synth = { cancel() { queued.length = 0; }, speak(u) { queued.push(u); } };
  class Utterance { constructor(text) { this.text = text; } }
  const started = [];
  const r = readAloud([{ text: "One.", onStart: () => started.push(1) }, { text: "Two.", onStart: () => started.push(2) }],
    { synth, Utterance, voice: { name: "Ava", lang: "en-US" } });
  assert.deepEqual(queued.map(u => u.text), ["One.", "Two."], "both queued at once, before anything is awaited");
  assert.equal(queued[0].voice.name, "Ava");
  queued[0].onstart(); queued[1].onstart(); queued[1].onend();
  assert.deepEqual(started, [1, 2]);
  assert.equal(await r.done, "ended");
  const s = readAloud([{ text: "Three." }], { synth, Utterance });
  s.stop();
  assert.equal(await s.done, "stopped");
});

test("the picker lists the reader's language first, nicest first, and says which need the network", () => {
  const v = (name, lang, localService = true) => ({ name, lang, localService, voiceURI: "id:" + name });
  const voices = [v("Thomas", "fr-FR"), v("Albert", "en-US"), v("Google UK English Male", "en-GB", false),
    v("Ava (Enhanced)", "en-US"), v("Amélie", "fr-CA"), v("Samantha", "en-US")];
  const en = voiceOptions(voices, "en");
  assert.deepEqual(en.map(o => o.voice.name), ["Ava (Enhanced)", "Samantha", "Albert", "Google UK English Male", "Amélie", "Thomas"]);
  assert.equal(en[3].label, "Google UK English Male · en-GB · online");
  assert.equal(en[0].id, "id:Ava (Enhanced)");
  assert.deepEqual(voiceOptions(voices, "fr").slice(0, 2).map(o => o.voice.name), ["Amélie", "Thomas"]);
  assert.equal(pickVoice(voices, "en").name, voiceOptions(voices, "en")[0].voice.name, "picker and default agree");
});
