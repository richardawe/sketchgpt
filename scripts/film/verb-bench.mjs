// How much of real writing can Film act out? (docs/film-plan.md, stage 3)
//
//   node scripts/film/verb-bench.mjs <cache dir>
//
// Public-domain short fiction from Project Gutenberg, cut into passages of 15
// paragraphs (about a scene each), read by web/film.mjs's own readStory —
// exactly what a writer would paste. Counts, per passage and in total:
//   - lines, and how each speaker was found (tag, paragraph, continued,
//     guessed, unknown) — twice: with no pronouns (a first paste, the floor),
//     and with each name's pronoun guessed the way a writer would set it at
//     step 2 (the bench guesses: "he"/"she" most often in the sentence after
//     the name). The page never guesses pronouns; this estimates its best;
//   - moves the page acts out, by kind;
//   - verbs it could not act out ("No move for …"), ranked — the list the
//     verb table is sized from, the way the stamp vocabulary should have been.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readStory, findCast } from "../../web/film.mjs";

const BOOKS = {
  1661: "Doyle, The Adventures of Sherlock Holmes",
  2814: "Joyce, Dubliners",
  2776: "O. Henry, The Four Million",
  1429: "Mansfield, The Garden Party",
  13415: "Chekhov, The Lady with the Dog and Other Stories",
};
const dir = process.argv[2] || ".";
mkdirSync(dir, { recursive: true });

async function text(id) {
  const file = join(dir, `pg${id}.txt`);
  if (!existsSync(file)) {
    const r = await fetch(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`);
    if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
    writeFileSync(file, await r.text());
  }
  let t = readFileSync(file, "utf8").replace(/\r/g, "");
  const a = t.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/), b = t.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/);
  if (a >= 0) t = t.slice(t.indexOf("\n", a) + 1, b > 0 ? b : undefined);
  // Paragraphs are separated by blank lines; lines inside one are wrapped.
  return t.split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(p => p.length > 30 && !/^(CHAPTER|[IVXLC]+\.|Contents|ADVENTURE)\b/i.test(p) && !/^[A-Z .,'-]+$/.test(p));
}

const how = { tag: 0, paragraph: 0, continued: 0, guessed: 0, unknown: 0, chosen: 0 };
const howP = { tag: 0, paragraph: 0, continued: 0, guessed: 0, unknown: 0, chosen: 0 };
// The bench's stand-in for a writer choosing pronouns at step 2.
function guessPronouns(passage) {
  const out = {};
  for (const name of findCast(passage)) {
    let she = 0, he = 0;
    for (const m of passage.matchAll(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^.!?]*[.!?]\\s+[^.!?]*`, "g"))) {
      she += (m[0].match(/\b(she|her)\b/gi) || []).length; he += (m[0].match(/\b(he|him|his)\b/gi) || []).length;
    }
    if (she || he) out[name] = she > he ? "she" : "he";
  }
  return out;
}
const moves = {}, unmapped = {};
let passages = 0, lines = 0, actions = 0, words = 0;
for (const [id, name] of Object.entries(BOOKS)) {
  const paras = await text(id);
  let bookLines = 0, bookMoves = 0, bookUnmapped = 0;
  for (let i = 0; i + 15 <= paras.length; i += 15) {
    const passage = paras.slice(i, i + 15).join("\n\n");
    words += passage.split(/\s+/).length;
    const r = readStory(passage, { pronouns: {} });
    passages++;
    for (const b of r.scenes.flatMap(s => s.beats)) {
      if (b.kind === "line") { lines++; bookLines++; how[b.how]++; }
      else { actions++; bookMoves++; moves[b.move] = (moves[b.move] || 0) + 1; }
    }
    const rp = readStory(passage, { pronouns: guessPronouns(passage) });
    for (const b of rp.scenes.flatMap(s => s.beats)) if (b.kind === "line") howP[b.how]++;
    for (const n of r.notes) {
      const m = n.match(/^No move for “(.+?)”/);
      if (m) { const v = m[1].toLowerCase().split(" ")[0]; unmapped[v] = (unmapped[v] || 0) + 1; bookUnmapped++; }
    }
  }
  console.log(`${name}: ${paras.length} paragraphs, ${bookLines} lines, ${bookMoves} moves acted, ${bookUnmapped} verbs with no move`);
}
const pct = (a, b) => `${(100 * a / Math.max(1, b)).toFixed(1)}%`;
const noMove = Object.values(unmapped).reduce((a, b) => a + b, 0);
console.log(`\n${passages} passages, ${words} words, ${lines} lines, ${actions} moves acted, ${noMove} verbs (first mention per passage) with no move`);
console.log(`speakers, no pronouns: ${Object.entries(how).filter(([, n]) => n).map(([k, n]) => `${k} ${n} (${pct(n, lines)})`).join(", ")}`);
console.log(`speakers, pronouns set: ${Object.entries(howP).filter(([, n]) => n).map(([k, n]) => `${k} ${n} (${pct(n, lines)})`).join(", ")}`);
console.log(`moves acted: ${Object.entries(moves).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
console.log(`verbs acted / (acted + not): ${pct(actions, actions + noMove)}`);
console.log(`\nverbs with no move, most common first:`);
console.log(Object.entries(unmapped).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([v, n]) => `${v} ${n}`).join(", "));
