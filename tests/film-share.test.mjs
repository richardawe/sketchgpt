// Film stage 6: a film travels as a link (web/film/link.mjs) and as a
// screenplay (Fountain, web/film.mjs).
//
//   node --test tests/film-share.test.mjs
//
// A link is someone else's input, so every field is cleaned; a recording never
// travels; a screenplay pasted in reads as the same film as its prose, and the
// prose written out as a screenplay reads back unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readStory, isFountain, fromFountain, toFountain, SAMPLE, LOOKS } from "../web/film.mjs";
import { encodeFilm, decodeFilm, cleanFilm, LIMITS } from "../web/film/link.mjs";

const P = { Nadia: "she", Leo: "he", Victor: "he" };
const PROSE = `Nadia and Leo sat in the kitchen.

"You're late," Nadia said.

"The bus," said Leo. He sat down.

That night, Nadia and Victor stood in the street.

"Where is it?" Victor whispered.

Nadia gave him the envelope. He ran.`;

const said = story => story.scenes.flatMap(s => s.beats.filter(b => b.kind === "line").map(b => [b.speaker, b.text]));

test("a film survives the link, and the link is short", async () => {
  const film = { text: PROSE, pronouns: P, looks: { Nadia: LOOKS[0] }, voices: { Leo: "Daniel" }, pitch: { Leo: "deeper" },
    speakers: { "1:The bus": "Leo" }, fx: false, amb: true, music: false };
  const frag = await encodeFilm(film);
  assert.match(frag, /^film=z[A-Za-z0-9_-]+$/);
  assert.ok(frag.length < 800, `${frag.length} characters`);
  // The longest story a link holds (real English, at the cap) compresses to fewer characters than it has.
  const words = readFileSync(new URL("../docs/film-plan.md", import.meta.url), "utf8").slice(0, LIMITS.text);
  const long = await encodeFilm({ text: words, pronouns: P });
  assert.ok(long.length < words.length, `${long.length} characters for ${words.length} of story`);
  const back = await decodeFilm("#" + frag);
  assert.equal(back.text, PROSE);
  assert.deepEqual(back.pronouns, P);
  assert.deepEqual(back.voices, { Leo: "Daniel" });
  assert.deepEqual(back.pitch, { Leo: "deeper" });
  assert.deepEqual(back.speakers, { "1:The bus": "Leo" });
  assert.equal(back.looks.Nadia.hair, LOOKS[0].hair);
  assert.deepEqual([back.fx, back.amb, back.music], [false, true, false]);
});

test("recordings never travel, and nothing unknown does", async () => {
  const back = await decodeFilm(await encodeFilm({ text: "Hi.", takes: { "0:Hi": { buffer: [1, 2, 3] } }, photo: "data:image/png;base64,AAAA" }));
  assert.deepEqual(Object.keys(back).sort(), ["amb", "fx", "looks", "music", "pitch", "pronouns", "speakers", "text", "voices"]);
});

test("a link's fields are capped and type-checked", () => {
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => ["P" + i, "she"]));
  const c = cleanFilm({ text: "x".repeat(20000), pronouns: { Bad: "it", ["N".repeat(99)]: "he", ...many }, pitch: { A: "squeaky", B: "deeper" },
    voices: { A: 7, B: "v".repeat(500) }, looks: { A: null, B: { hair: "<script>", skin: "javascript:" } }, fx: "no", amb: 1, music: "yes" });
  assert.equal(c.text.length, LIMITS.text);
  assert.ok(Object.keys(c.pronouns).length <= LIMITS.cast);
  assert.equal(c.pronouns.Bad, undefined, "only she, he or they");
  assert.equal(c.pronouns["N".repeat(LIMITS.name)], "he", "a long name is cut, not dropped");
  assert.deepEqual(c.pitch, { B: "deeper" });
  assert.deepEqual(Object.keys(c.voices), ["B"]);
  assert.equal(c.voices.B.length, LIMITS.voice);
  assert.ok(!JSON.stringify(c.looks).includes("<script>") && !JSON.stringify(c.looks).includes("javascript:"));
  assert.deepEqual([c.fx, c.amb, c.music], [true, false, false], "only real booleans switch sound on or off");
  assert.deepEqual(cleanFilm(null).text, "");
});

test("a damaged, foreign or oversized link says so in words", async () => {
  await assert.rejects(decodeFilm("#book=abc"), /does not hold a film/);
  await assert.rejects(decodeFilm("#film=z" + "A".repeat(40)), /damaged/);
  await assert.rejects(decodeFilm("#film=j" + Buffer.from('{"v":2}').toString("base64url")), /newer version/);
  // 3 MB of one letter deflates to a few KB; the page stops reading at its cap.
  const bomb = new Uint8Array(await new Response(new Blob([JSON.stringify({ v: 1, text: "a".repeat(3e6) })]).stream()
    .pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  await assert.rejects(decodeFilm("#film=z" + Buffer.from(bomb).toString("base64url")), /damaged/);
  await assert.rejects(decodeFilm("#film=j" + "A".repeat(300000)), /too long/);
});

test("prose written out as a screenplay reads back as the same film", () => {
  const story = readStory(PROSE, { pronouns: P });
  const fountain = toFountain(PROSE, story, { title: "The envelope" });
  assert.match(fountain, /^Title: The envelope/m);
  assert.match(fountain, /^INT\. KITCHEN - DAY$/m);
  assert.match(fountain, /^EXT\. STREET - NIGHT$/m);
  assert.match(fountain, /^VICTOR\n\(whispering\)|^VICTOR\n\(quietly\)/m);
  assert.ok(isFountain(fountain));
  assert.equal(isFountain(PROSE), false, "prose is not mistaken for a screenplay");
  assert.equal(isFountain(SAMPLE), false);
  const again = readStory(fromFountain(fountain), { pronouns: P });
  assert.deepEqual(said(again), said(story));
  assert.deepEqual(again.scenes.map(s => [s.set, s.light]), story.scenes.map(s => [s.set, s.light]));
});

test("a screenplay written by hand is read: headings are scenes, cues are speakers", () => {
  const sp = `INT. BAR - NIGHT

Ruth leans on the counter. SAM walks in.

SAM
(angrily)
You sold it.

RUTH
I had to!

EXT. PARK - DAY

Sam sits on the bench.

SAM
It's gone.`;
  assert.ok(isFountain(sp));
  const story = readStory(fromFountain(sp), { pronouns: { Ruth: "she", Sam: "they" } });
  assert.deepEqual(story.cast.map(c => c.name).sort(), ["Ruth", "Sam"]);
  assert.deepEqual(said(story).map(([w]) => w), ["Sam", "Ruth", "Sam"]);
  assert.deepEqual(story.scenes.map(s => s.set), ["bar", "park"]);
  assert.equal(story.scenes[0].light, "night");
  assert.notEqual(story.scenes[1].light, "night", "DAY resets the light");
});
