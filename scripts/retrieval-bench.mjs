// What an embedder alone can do with a document — no chat model anywhere.
//
// Work mode's Layer 1 (docs/work-mode.md) claims an embedder is the
// load-bearing part and cannot hallucinate. That is worth more than an
// assertion, and it answers a fair question: if there is no chat model, can
// it still summarise?
//
//   ollama pull snowflake-arctic-embed:s
//   node scripts/retrieval-bench.mjs
//
// Three things get measured:
//   1. Can the embedder generate at all? (No — it refuses.)
//   2. Extractive summary: pick sentences by centrality, generate nothing.
//   3. Query-anchored retrieval: hit rate, and whether the score itself can
//      say "this document does not cover that".
const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const MODEL = process.env.EMBED_MODEL || "snowflake-arctic-embed:s";

// Arctic-embed is asymmetric: queries take a prefix, passages take none.
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

const DOC = `Residents should report repairs through the online portal or by calling the office on weekdays between 9am and 5pm.
Emergency repairs, meaning a total loss of heating, water or electricity, can be reported at any time.
The office is closed on bank holidays, though the emergency line remains staffed.
We attend emergency repairs within 24 hours.
Urgent repairs, such as a partial loss of heating or a leaking pipe that can be contained, are attended within 5 working days.
Routine repairs are completed within 28 calendar days.
Our contractors are vetted annually and carry photographic identification at all times.
We will give at least 24 hours notice before entering a property for a routine repair.
Residents may ask to reschedule once without penalty.
A second cancellation may be charged at the contractor's call-out rate.
Repairs arising from fair wear and tear are free of charge to the resident.
Damage caused by a resident or their visitors is recharged at cost.
An invoice is issued within 30 days of the work being completed.
Payment plans are available for recharges over two hundred pounds.
If a repair is not completed within the stated time, residents may raise a complaint with the housing officer.
Complaints are acknowledged within 3 working days.
We publish our repair performance figures each quarter on the residents' noticeboard.
Oakfield House was built in 1974 and comprises forty-two flats over seven floors.
The building's communal areas are cleaned twice weekly by an external company.`;

// The index is the sentence that answers it; -1 means the document does not.
const QUERIES = [
  ["How long do routine repairs take?", 5],
  ["How much notice before someone enters my flat?", 7],
  ["What happens if I damage something myself?", 11],
  ["How do I complain?", 14],
  ["Who owns the building?", -1],
  ["Is there parking?", -1],
];

const SENTENCES = DOC.split("\n").map(s => s.trim()).filter(Boolean);

async function embed(input) {
  const res = await fetch(`${HOST}/api/embed`, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, input }) });
  const json = await res.json();
  if (!json.embeddings) throw new Error(json.error || "no embeddings returned");
  return json.embeddings;
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cos = (a, b) => dot(a, b) / (Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b)));

// ---- 0. the layer that actually ships --------------------------------------
// web/work.mjs retrieves with BM25, not with an embedder: no download, no
// second engine in the tab, no untested co-residency gate. It shares the
// property that matters — it returns existing text or nothing — so the fair
// question is what the embedder buys over it. Same document, same queries.
// This part needs no Ollama, so it always runs.
const { buildIndex, findPassages } = await import("../web/work.mjs");

const lexIndex = buildIndex(SENTENCES.map((s, i) => ({ i, text: s, start: 0, end: 0, heading: "" })));
let lexHits = 0, lexScored = 0, lexFirst = 0;
const lexHitCov = [], lexMissCov = [], lexEmpty = [];
console.log("BM25 (web/work.mjs) — what the page does today:");
for (const [q, want] of QUERIES) {
  const { hits, coverage, missing } = findPassages(lexIndex, q, { limit: 3 });
  const top = hits.map(h => h.passage.i);
  if (want === -1) {
    lexMissCov.push(coverage);
    if (!hits.length) lexEmpty.push(q);
    console.log(`  ${coverage.toFixed(3)}  ${hits.length ? "(nothing to find)" : "DECLINED        "}  ${q}`);
  } else {
    lexScored++;
    if (top.includes(want)) lexHits++;
    if (top[0] === want) lexFirst++;
    lexHitCov.push(coverage);
    console.log(`  ${coverage.toFixed(3)}  ${top[0] === want ? "HIT@1" : top.includes(want) ? "hit@3" : "MISS "}` +
      `             ${q}${missing.length ? `   (no match for ${missing.map(m => `"${m}"`).join(", ")})` : ""}`);
  }
}
const lexLowHit = Math.min(...lexHitCov), lexHighMiss = Math.max(...lexMissCov);
console.log(`\n  ${lexHits}/${lexScored} found the right sentence in the top 3, ${lexFirst} of them first.`);
console.log(`  Coverage on answerable queries ${lexLowHit.toFixed(3)}–${Math.max(...lexHitCov).toFixed(3)};` +
  ` unanswerable ${Math.min(...lexMissCov).toFixed(3)}–${lexHighMiss.toFixed(3)}.`);
console.log(lexLowHit > lexHighMiss
  ? `  The gap is real, so coverage could be thresholded.`
  : `  NO GAP — coverage cannot be thresholded. An unanswerable query scores
  ${lexHighMiss.toFixed(3)} while a query the document answers scores ${lexLowHit.toFixed(3)}, because
  lexical overlap cannot tell "topic absent" from "topic present, question
  unanswered". So the page declines only where overlap is zero (${lexEmpty.length}/${lexMissCov.length} here)
  and otherwise shows the passages and lets the reader judge. This is the
  one thing the embedder below buys that BM25 cannot.\n`);

// ---- the embedder, for comparison ------------------------------------------
const up = await fetch(`${HOST}/api/tags`).then(r => r.ok).catch(() => false);
if (!up) {
  console.log(`No Ollama at ${HOST} — skipping the embedder comparison.`);
  console.log(`  ollama pull ${MODEL} && node scripts/retrieval-bench.mjs`);
  process.exit(0);
}

// ---- 1. it cannot write ----------------------------------------------------
const chat = await fetch(`${HOST}/api/chat`, { method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: MODEL, stream: false,
    messages: [{ role: "user", content: "Summarise this document." }] }) });
const chatJson = await chat.json();
console.log(`Asked to write prose, ${MODEL} says:`);
console.log(`  ${JSON.stringify(chatJson.error ?? chatJson.message?.content ?? chatJson).slice(0, 120)}`);
console.log("  An embedder has no decoder. It cannot hallucinate because it cannot speak.\n");

const vecs = await embed(SENTENCES);

// ---- 2. extractive summary, no generation ----------------------------------
// Centroid centrality with MMR for diversity: pick sentences the document
// already contains. Safe by construction — every word is verbatim.
const centroid = vecs[0].map((_, i) => vecs.reduce((s, v) => s + v[i], 0) / vecs.length);
const central = vecs.map(v => cos(v, centroid));
const LAMBDA = 0.6, WANT = 5;
const picked = [];
while (picked.length < WANT) {
  let best = -1, bestScore = -Infinity;
  for (let i = 0; i < SENTENCES.length; i++) {
    if (picked.includes(i)) continue;
    const redundancy = picked.length ? Math.max(...picked.map(j => cos(vecs[i], vecs[j]))) : 0;
    const score = LAMBDA * central[i] - (1 - LAMBDA) * redundancy;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  picked.push(best);
}
console.log(`Extractive summary — ${WANT} sentences chosen, none written:`);
for (const i of [...picked].sort((a, b) => a - b)) console.log(`  • ${SENTENCES[i]}`);
console.log(`
  Safe, and not very good. Centrality rewards sentences that sound like the
  average of the document, so the specific ones — the response times, the
  numbers people actually came for — read as outliers and get dropped. The
  failure is visible (you read it and think "that is not the important bit"),
  which is the acceptable kind, but it is not worth shipping on its own.\n`);

// ---- 3. query-anchored retrieval -------------------------------------------
let hits = 0, scored = 0;
const hitScores = [], missScores = [];
console.log("Query-anchored retrieval:");
for (const [q, want] of QUERIES) {
  const [qv] = await embed([QUERY_PREFIX + q]);
  const ranked = SENTENCES.map((s, i) => [cos(qv, vecs[i]), i]).sort((a, b) => b[0] - a[0]);
  const top = ranked.slice(0, 3).map(([, i]) => i);
  if (want === -1) {
    missScores.push(ranked[0][0]);
    console.log(`  ${ranked[0][0].toFixed(3)}  (nothing to find)  ${q}`);
  } else {
    scored++;
    if (top.includes(want)) hits++;
    hitScores.push(ranked[0][0]);
    const mark = top[0] === want ? "HIT@1" : top.includes(want) ? "hit@3" : "MISS ";
    console.log(`  ${ranked[0][0].toFixed(3)}  ${mark}              ${q}`);
  }
}
const lowestHit = Math.min(...hitScores), highestMiss = Math.max(...missScores);
console.log(`\n  ${hits}/${scored} found the right sentence in the top 3.`);
console.log(`  Answerable queries scored ${lowestHit.toFixed(3)}–${Math.max(...hitScores).toFixed(3)};` +
  ` unanswerable ones topped out at ${highestMiss.toFixed(3)}.`);
console.log(lowestHit > highestMiss
  ? `  The gap is real, so a threshold around ${((lowestHit + highestMiss) / 2).toFixed(2)} can say
  "this document does not cover that" — the refusal Qwen3-0.6B could not
  produce, obtained from a number rather than from a model's judgement.`
  : `  No usable gap on this sample: a threshold would reject real hits.`);
console.log(`
  Small sample: one short document, ${QUERIES.length} queries. Treat the threshold as a
  direction, not a constant, until it is run over something real.`);
