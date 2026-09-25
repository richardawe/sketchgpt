// Film stage 1 (web/film.mjs): plain prose read into a scene by rules.
//
//   node --test tests/film.test.mjs
//
// Every promise the plan makes about reading prose is a test here: speakers
// come from tags, then the paragraph, then the novel's alternation — and the
// last is always marked "guessed"; pronouns are never guessed; a wish is not a
// deed; the camera never crosses the line; every clip the page asks for
// exists in the free packs it ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readStory, findCast, block, shotAt, cameraFor, placesAt, sideOf, clock, CLIPS, SAMPLE, LIMIT_SECONDS, PITCH, trimBounds } from "../web/film.mjs";

const P = { Maya: "she", Tom: "he", Sam: "they", Ruth: "she" };
const beats = (text, pronouns = P) => readStory(text, { pronouns }).scenes.flatMap(s => s.beats);
const lines = (text, pronouns = P) => beats(text, pronouns).filter(b => b.kind === "line");
const acts = (text, pronouns = P) => beats(text, pronouns).filter(b => b.kind === "action").map(b => `${b.who}:${b.move}`);

// The clip names inside the shipped animation files, read from the GLBs themselves.
function glbAnimations(path) {
  const b = readFileSync(new URL(path, import.meta.url));
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString("utf8"));
  return (json.animations || []).map(a => a.name);
}
const SHIPPED = new Set([...glbAnimations("../web/film/assets/moves-1.glb"), ...glbAnimations("../web/film/assets/moves-2.glb")]);

test("the cast is the story's names, not the words that start its sentences", () => {
  assert.deepEqual(findCast(SAMPLE).sort(), ["Maya", "Tom"]);
  assert.deepEqual(findCast(`Later, Detective Reyes came in. "Sit," said Reyes.`), ["Detective Reyes", "Reyes"]);
  const c = findCast(`"No. Don't," she said. "Who? Why? Tonight." Then Paul said nothing. It's late. Monday came.`);
  assert.deepEqual(c, ["Paul"]);
  // A name at a sentence's start counts when what follows reads as a deed.
  assert.deepEqual(findCast("Anna waited. The bus came."), ["Anna"]);
  assert.deepEqual(findCast("Rain. Silence. Nothing."), []);
  assert.deepEqual(findCast("The bus came for Anna."), ["Anna"]);
  assert.deepEqual(findCast(`"Go," said Anna.`), ["Anna"]);
});

test("a speaker comes from the tag, before or after the quote, and the tag's verb is the manner", () => {
  const l = lines(`"Stop," Maya whispered.\n\nTom said, "Why?"\n\n"Because," said Maya. "They're here."\n\n"GET OUT," Tom shouted.`);
  assert.deepEqual(l.map(x => [x.speaker, x.how, x.manner]), [
    ["Maya", "tag", "quiet"], ["Tom", "tag", "ask"], ["Maya", "tag", "plain"], ["Maya", "continued", "plain"], ["Tom", "tag", "angry"]]);
  assert.equal(l[0].text, "Stop", "a quote cut by its tag loses the comma");
});

test("someone acting in a paragraph speaks its untagged quotes", () => {
  const l = lines(`Tom poured a drink. "You want one?"\n\nMaya shook her head. "No."`);
  assert.deepEqual(l.map(x => [x.speaker, x.how]), [["Tom", "paragraph"], ["Maya", "paragraph"]]);
});

test("untagged lines alternate between two people — and are marked guessed", () => {
  const l = lines(`"Where were you?" Maya asked.\n\n"Out."\n\n"Out where?"\n\n"Just out."`);
  // With only Maya named, the second person is unknown: nothing to alternate with.
  assert.deepEqual(l.map(x => [x.speaker, x.how]), [["Maya", "tag"], [null, "unknown"], [null, "unknown"], [null, "unknown"]]);
  const two = lines(`Tom was on the sofa.\n\n"Where were you?" Maya asked.\n\n"Out."\n\n"Out where?"\n\n"Just out."`);
  assert.deepEqual(two.map(x => [x.speaker, x.how]), [["Maya", "tag"], ["Tom", "guessed"], ["Maya", "guessed"], ["Tom", "guessed"]]);
});

test("with three people in the room, an untagged line is not given to anyone", () => {
  const r = readStory(`Tom, Maya and Ruth sat in the kitchen.\n\n"Well?" said Ruth.\n\n"Nothing."`, { pronouns: P });
  const l = r.scenes.flatMap(s => s.beats).filter(b => b.kind === "line");
  assert.deepEqual(l.map(x => x.speaker), ["Ruth", null]);
  assert.ok(r.notes.some(n => /Nobody is given “Nothing\.”/.test(n)), r.notes.join("\n"));
  // Even once two of the three have been talking, a third could be answering.
  const later = lines(`Tom, Maya and Ruth sat in the kitchen.\n\n"Well?" said Ruth.\n\n"No," said Tom.\n\n"Why not?"`);
  assert.deepEqual(later.map(x => x.speaker), ["Ruth", "Tom", null]);
});

test("pronouns are asked, never guessed", () => {
  const r = readStory(`Tom sat down. "Hi," she said.`, { pronouns: {} });
  assert.equal(r.scenes[0].beats.find(b => b.kind === "line").speaker, null);
  assert.ok(r.notes.some(n => /Say who is “she”/.test(n)));
  // Two women in the room: "she" could be either, so nobody.
  const two = readStory(`Maya and Ruth waited. "Now," she said.`, { pronouns: P });
  assert.equal(two.scenes[0].beats.find(b => b.kind === "line").speaker, null);
  assert.ok(two.notes.some(n => /could be Maya or Ruth/.test(n)), two.notes.join("\n"));
  // One woman, one man: "she" and "her" are hers.
  assert.deepEqual(acts(`Tom and Maya waited. Her phone rang. She answered the phone.`), ["Maya:phone"]);
  assert.deepEqual(lines(`Tom and Maya waited. "Now," he said.`).map(l => l.speaker), ["Tom"]);
});

test("the words' deeds become moves; wishes, refusals and speech tags do not", () => {
  assert.deepEqual(acts(`Maya let herself in. Tom sat down and nodded. He stood up, crossed his arms and walked to the window.`),
    ["Maya:enter", "Tom:sit", "Tom:nod", "Tom:stand", "Tom:arms", "Tom:walk"]);
  assert.deepEqual(acts(`Tom wanted to sit down. Maya didn't nod. He tried to leave. She would never drink it.`), []);
  assert.deepEqual(acts(`"Fine," Tom answered. Maya answered the phone.`), ["Maya:phone"], "a tag is not an action; answering a phone is");
  assert.deepEqual(acts(`Tom drew a gun. Maya shot him. He fell. He died.`), ["Tom:gun", "Maya:shoot", "Tom:fall", "Tom:die"]);
  assert.deepEqual(acts(`She shot him a look.`), []);
});

test("a verb with no move is listed, not acted out as something else", () => {
  const r = readStory(`Tom contemplated the ceiling. Maya hesitated.`, { pronouns: P });
  assert.deepEqual(r.scenes[0].beats, []);
  assert.ok(r.notes.some(n => /No move for “contemplated”/.test(n)), r.notes.join("\n"));
  assert.ok(r.notes.some(n => /No move for “hesitated”/.test(n)));
});

test("scenes break on a blank line with a new place or a time jump, not on a blank line alone", () => {
  const r = readStory(`Tom sat in the living room.\n\n"Hi," said Maya.\n\nThat night, Maya waited in the kitchen.\n\n"Well?" said Tom.\n\nTom went out to the street.`, { pronouns: P });
  assert.deepEqual(r.scenes.map(s => s.place), ["living room", "kitchen", "street"]);
  assert.equal(r.scenes[1].time, "That night");
  assert.ok(r.notes.some(n => /3 scenes/.test(n)));
});

test("the sample reads as its writer meant, with one guess shown", () => {
  const r = readStory(SAMPLE, { pronouns: P });
  const b = r.scenes[0].beats;
  assert.deepEqual(b.map(x => x.kind === "line" ? `${x.speaker}:${x.how}` : `${x.who}:${x.move}`), [
    "Maya:enter", "Maya:tag", "Tom:sit", "Tom:paragraph", "Maya:guessed", "Tom:stand", "Tom:paragraph",
    "Maya:no", "Maya:paragraph", "Maya:phone", "Maya:walk", "Maya:paragraph", "Tom:tag", "Tom:continued"]);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.cast.map(c => [c.name, c.lines]), [["Maya", 4], ["Tom", 4]]);
});

const film = block(readStory(SAMPLE, { pronouns: P }));

test("every clip the page asks for is in the free packs it ships", () => {
  assert.equal(SHIPPED.size, 84);
  for (const c of Object.values(CLIPS).flat().filter(Boolean)) assert.ok(SHIPPED.has(c), `${c} is not in moves-1/2.glb`);
  for (const p of Object.values(film.people)) for (const [, clip] of p.timeline) assert.ok(SHIPPED.has(clip), clip);
});

test("lines run in order, never overlap, and each speaker talks while speaking", () => {
  for (let i = 1; i < film.lines.length; i++) assert.ok(film.lines[i][0] >= film.lines[i - 1][1], `line ${i} overlaps`);
  for (const [a, b, who] of film.lines) {
    for (const t of [a + 0.01, (a + b) / 2, b - 0.01]) {
      const clip = placesAt(film, t)[who].seg[1];
      assert.match(clip, /Talking/, `${who} at ${t} is ${clip}`);
    }
  }
  // Nobody talks when they have no line.
  for (let t = 0; t < film.length; t += 0.1) for (const [name, p] of Object.entries(placesAt(film, t))) {
    if (!/Talking_Loop$/.test(p.seg[1]) || /Phone/.test(p.seg[1])) continue;
    assert.ok(film.lines.some(([a, b, w]) => w === name && t >= a - 0.01 && t <= b + 0.3), `${name} talks at ${t.toFixed(1)} with no line`);
  }
});

test("the length is counted, and a story over two minutes says so", () => {
  assert.ok(film.length > 25 && film.length < 60, `${film.length} s`);
  assert.equal(film.over, false);
  assert.equal(clock(107), "1:47");
  assert.equal(clock(59.6), "1:00");
  assert.equal(clock(-0.02), "0:00");
  const long = SAMPLE + "\n\n" + Array.from({ length: 30 }, (_, i) => `"This is line number ${i} and it goes on for a while, as lines in an argument do," said ${i % 2 ? "Tom" : "Maya"}.`).join("\n\n");
  const f = block(readStory(long, { pronouns: P }));
  assert.ok(f.length > LIMIT_SECONDS && f.over === true, `${f.length}`);
});

test("the camera: wide to open, the speaker while they speak", () => {
  assert.equal(shotAt(film, 0.5), "wide");
  for (const [a, b, who] of film.lines) assert.equal(shotAt(film, (a + b) / 2), who);
  const walk = film.actions.find(a => a[3] === "enter");
  assert.equal(shotAt(film, (walk[0] + walk[1]) / 2), "wide");
});

test("the 180° rule: between two wide shots, every shot is from the same side of the line between them", () => {
  // A wide shot re-establishes the room (people may have moved); within each
  // run of closer shots after it, the camera never crosses the line.
  const head = ({ at }) => [at[0], 1.5, at[1]];
  const runs = [];
  let run = null, frames = 0;
  for (let t = 0; t < film.length; t += 0.05) {
    const places = placesAt(film, t);
    const shot = shotAt(film, t);
    if (shot === "wide" || places.Maya.off || places.Tom.off) { run = null; continue; }
    if (!run) runs.push(run = new Set());
    const heads = { Maya: head(places.Maya), Tom: head(places.Tom) };
    const cam = cameraFor(shot, heads, { Maya: places.Maya.facing, Tom: places.Tom.facing }, ["Maya", "Tom"]);
    run.add(sideOf(heads.Maya, heads.Tom, cam.at));
    frames++;
  }
  assert.ok(frames > 200 && runs.length >= 2, `${frames} frames in ${runs.length} runs`);
  runs.forEach((r, i) => { assert.equal(r.size, 1, `run ${i} crossed the line`); assert.ok(!r.has(0)); });
});

test("fuzz: odd prose never throws, and every line is given to someone or explained", () => {
  const stories = [
    "", "   \n\n  ", `"`, `"Unclosed quote`, `He said.`, `"Hi."`, `Tom.`, SAMPLE.replace(/"/g, "“").replace(/“([^“]*)“/g, "“$1”"),
    `“Curly quotes,” said Maya. “Work too.”`, `Maya’s phone rang. “Yes?” she said.`,
    Array.from({ length: 50 }, () => `"x," said Tom.`).join(" "), "Tom " + "and Tom ".repeat(200) + "sat.",
  ];
  for (const s of stories) {
    const r = readStory(s, { pronouns: P });
    const f = block(r);
    assert.ok(Number.isFinite(f.length));
    for (const b of r.scenes.flatMap(x => x.beats).filter(b => b.kind === "line"))
      assert.ok(b.speaker || r.notes.some(n => n.includes("Nobody is given")), `${JSON.stringify(s).slice(0, 40)}: ${b.text}`);
  }
  const curly = lines(`“Curly quotes,” said Maya. “Work too.”`);
  assert.deepEqual(curly.map(l => [l.speaker, l.text]), [["Maya", "Curly quotes"], ["Maya", "Work too."]]);
  assert.deepEqual(lines(`Maya’s phone rang. “Yes?” she said.`).map(l => l.speaker), ["Maya"]);
});

test("a recorded line lasts as long as its recording, and the scene moves up or down to fit", () => {
  const story = readStory(SAMPLE, { pronouns: P });
  const first = story.scenes[0].beats.find(b => b.kind === "line");
  first.key = "0:x";
  const before = block(story);
  first.seconds = 6.5;
  const after = block(story);
  const [a, b, , , , key] = after.lines[0];
  assert.equal(key, "0:x", "each line carries its key to the video's voice track");
  assert.ok(Math.abs(b - a - 6.65) < 1e-6, `${b - a}`);
  const shift = (b - a) - (before.lines[0][1] - before.lines[0][0]);
  assert.ok(Math.abs(after.lines[1][0] - before.lines[1][0] - shift) < 1e-6, "later lines move by the difference");
  assert.ok(Math.abs(after.length - before.length - shift) < 0.01);
  first.seconds = 999;
  assert.ok(block(story).lines[0][1] - block(story).lines[0][0] <= 30.2, "a runaway recording is capped");
});

test("silence is trimmed from both ends of a take, relative to its loudest moment", () => {
  const rate = 1000, s = new Float32Array(3000);
  for (let i = 1000; i < 2000; i++) s[i] = 0.02 * Math.sin(i);   // a quiet voice, 1 s in
  for (let i = 0; i < 3000; i++) s[i] += 0.0003;                  // room noise
  const [a, b] = trimBounds(s, rate);
  assert.ok(a >= 900 && a <= 1000, `start ${a}`);
  assert.ok(b >= 2000 && b <= 2100, `end ${b}`);
  assert.equal(trimBounds(new Float32Array(500), rate), null, "a silent take is no take");
});

test("one pitch setting shapes both the phone's voice and the recording", () => {
  for (const [name, p] of Object.entries(PITCH)) {
    assert.ok(p.tts > 0 && p.tts <= 2, name);
    assert.ok(p.rate > 0.5 && p.rate < 1.5, name);
    assert.equal(Math.sign(p.tts - 1), Math.sign(p.rate - 1), `${name} moves both the same way`);
  }
});
