// Passage splitting and BM25, as Work mode shipped them. The page no longer
// uses either (Desk takes short pasted text and never retrieves), but
// scripts/retrieval-bench.mjs does, and its numbers are only worth quoting
// while the code behaves as it did when they were measured.
//
//   node --test tests/retrieval.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPassages, buildIndex, findPassages, terms, stem } from "../scripts/lib/retrieval.mjs";

// ---- passages -------------------------------------------------------------

test("paragraphs become passages that point back at the original text", () => {
  const doc = "First paragraph here.\n\nSecond paragraph here.";
  const ps = splitPassages(doc);
  assert.equal(ps.length, 2);
  for (const p of ps) assert.equal(doc.slice(p.start, p.end).trim(), p.text);
});

test("a long paragraph is packed into sentences, not cut mid-word", () => {
  const sentence = "This is a sentence of a reasonable length that says something. ";
  const ps = splitPassages(sentence.repeat(20));
  assert.ok(ps.length > 1, "should split");
  for (const p of ps) assert.ok(p.text.endsWith("."), `passage ended mid-sentence: ${p.text.slice(-40)}`);
});

test("a heading labels the passages under it instead of becoming one", () => {
  const ps = splitPassages("# Repairs\n\nWe attend within 24 hours.\n\n## Costs\n\nWear and tear is free.");
  assert.equal(ps.length, 2);
  assert.equal(ps[0].heading, "Repairs");
  assert.equal(ps[1].heading, "Costs");
  assert.ok(!ps.some(p => p.text === "# Repairs"));
});

test("passage text is never rewritten, only trimmed", () => {
  const doc = "Pay £200.50 by 3rd March — no VAT.\n\nSecond.";
  assert.equal(splitPassages(doc)[0].text, "Pay £200.50 by 3rd March — no VAT.");
});

// ---- retrieval ------------------------------------------------------------

const DOC = [
  "Residents should report repairs through the online portal.",
  "We attend emergency repairs within 24 hours.",
  "Routine repairs are completed within 28 calendar days.",
  "We will give at least 24 hours notice before entering a property.",
  "Damage caused by a resident or their visitors is recharged at cost.",
  "If a repair is late, residents may raise a complaint with the housing officer.",
  "Complaints are acknowledged within 3 working days."
];
const index = buildIndex(DOC.map((text, i) => ({ i, text, start: 0, end: 0, heading: "" })));

test("retrieval returns the passage that answers the question", () => {
  const { hits } = findPassages(index, "How long do routine repairs take?");
  assert.equal(hits[0].passage.i, 2);
});

test("a query word the document spells differently still finds it", () => {
  // "complain" is in no sentence; "complaint" and "complaints" are. No stemmer
  // merges those, so the prefix bucket is what makes this work. Measured: this
  // exact query was a MISS before it existed.
  const { hits, missing } = findPassages(index, "How do I complain?");
  assert.ok(hits.slice(0, 3).some(h => h.passage.i === 5 || h.passage.i === 6));
  assert.deepEqual(missing, []);
});

test("a query sharing no word with the document returns nothing at all", () => {
  const { hits, missing } = findPassages(index, "Is there parking?");
  assert.equal(hits.length, 0);
  assert.deepEqual(missing, ["parking"]);
});

test("unmatched words are reported as the person spelled them", () => {
  // Not as stems: "no match for someth" is not a sentence to show anybody.
  const { missing } = findPassages(index, "What happens with parking?");
  assert.ok(missing.includes("parking"), missing.join());
  assert.ok(!missing.some(w => /^someth|^happen$/.test(w) && w.length < 6), missing.join());
});

test("retrieval only ever returns passages that were indexed", () => {
  const { hits } = findPassages(index, "repairs damage complaint notice");
  for (const h of hits) assert.ok(DOC.includes(h.passage.text));
});

test("stemming is shallow and reversible enough to explain a miss", () => {
  assert.equal(stem("repairs"), "repair");
  assert.equal(stem("policies"), "policy");
  assert.equal(stem("address"), "address");
  assert.ok(!terms("Something happened to someone").includes("someth"));
});

// ---- tasks ----------------------------------------------------------------
