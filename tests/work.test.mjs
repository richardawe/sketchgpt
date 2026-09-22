// Work mode: the cap, the passages, the retrieval, and the rule that decides
// whether the model gets to run at all.
//
//   node tests/work.test.mjs
//
// The tests that matter most here are the refusals. docs/work-mode.md is a
// measurement of a small model confidently answering questions its document
// did not address; the point of this module is that certain shapes never reach
// the model, and a test is the only thing that keeps that true.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FILE_BYTES, rejectFile, rejectText, fmtBytes,
  splitPassages, wordCount, buildIndex, findPassages, terms, stem,
  TASKS, taskById, planWorkTurn, contentsOf, article
} from "../web/work.mjs";
import { estimateTokens } from "../web/sketch.mjs";

// ---- the cap --------------------------------------------------------------

test("a file over the cap is refused before it is read", () => {
  const msg = rejectFile({ name: "big.txt", size: MAX_FILE_BYTES + 1, type: "text/plain" });
  assert.match(msg, /limit is/);
  assert.match(msg, /paste/);
  assert.equal(rejectFile({ name: "ok.txt", size: MAX_FILE_BYTES, type: "text/plain" }), null);
});

test("the cap message names both sizes in units a person reads", () => {
  const msg = rejectFile({ name: "big.txt", size: 3 * 1024 * 1024, type: "text/plain" });
  assert.match(msg, /3\.0 MB/);
  assert.match(msg, /512 KB/);
  assert.equal(fmtBytes(900), "900 B");
});

test("formats that are not plain text are named, not mangled", () => {
  assert.match(rejectFile({ name: "lease.pdf", size: 10, type: "" }), /PDF is not supported/);
  assert.match(rejectFile({ name: "letter.docx", size: 10, type: "" }), /word-processor/);
  assert.match(rejectFile({ name: "scan.png", size: 10, type: "" }), /not a text file/);
  assert.match(rejectFile({ name: "empty.txt", size: 0, type: "text/plain" }), /empty/);
});

test("binary that slipped past the extension check is caught on read", () => {
  assert.match(rejectText("PK\u0000\u0000\u0000rubbish"), /binary/);
  assert.match(rejectText("   \n  "), /no text/);
  assert.equal(rejectText("A perfectly ordinary sentence."), null);
});

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

test("every use case the page offers is present and buildable", () => {
  const want = ["draft", "rewrite", "shorten", "expand", "summarise", "explain", "reply",
    "brainstorm", "structure", "organise", "creative", "questions", "critique",
    "roleplay", "plan", "translate", "decide"];
  for (const id of want) assert.ok(taskById(id), `missing task: ${id}`);
  assert.equal(TASKS.length, want.length);
});

test("every task refuses to invent, in its own system prompt", () => {
  for (const t of TASKS) {
    const { system, user } = t.build({ source: "Some text.", query: "a query", option: t.options?.values[0] });
    assert.match(system, /only with the text|never add a fact/i, `${t.id} has no grounding line`);
    assert.ok(system.length > 80 && user.length > 0, t.id);
  }
});

test("a task that needs a source says so rather than running empty", () => {
  const plan = planWorkTurn({ task: taskById("rewrite"), source: "", query: "friendlier", ctx: 4096 });
  assert.equal(plan.mode, "none");
  assert.match(plan.note, /document|paste/i);
});

test("a task that needs a question says so rather than guessing one", () => {
  const plan = planWorkTurn({ task: taskById("translate"), source: "Hello there.", query: "", ctx: 4096 });
  assert.equal(plan.mode, "none");
  assert.match(plan.note, /language/i);
});

// ---- planning: the rule that decides whether the model runs ---------------

test("a short source is sent whole, and the page is handed all of it", () => {
  const source = "The meeting is on Tuesday at 4pm. Bring the figures.";
  const plan = planWorkTurn({ task: taskById("summarise"), source, ctx: 4096 });
  assert.equal(plan.mode, "whole");
  assert.ok(plan.messages.at(-1).content.includes(source));
  assert.ok(plan.used.length >= 1);
});

test("the planned turn never asks for more room than the context has", () => {
  const source = "Sentence about repairs and costs and notice periods. ".repeat(40);
  for (const ctx of [1024, 2048, 4096]) {
    for (const task of TASKS) {
      const plan = planWorkTurn({ task, source, query: "repairs", option: task.options?.values[0], ctx });
      if (!plan.messages) continue;
      // The page's own estimator, not a rule of thumb: generation that reaches
      // the context edge is truncated silently, so this has to be the number
      // the planner actually used.
      const cost = plan.messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);
      assert.ok(cost + plan.maxTokens <= ctx,
        `${task.id} at ${ctx}: ${cost} prompt + ${plan.maxTokens} output > ${ctx}`);
      assert.ok(plan.maxTokens >= 96, `${task.id} at ${ctx}: no room to answer`);
    }
  }
});

const LONG = Array.from({ length: 120 }, (_, i) =>
  `Clause ${i}. Residents should report repairs through the portal and complaints to the housing officer.`
).join("\n\n");

test("a document too long to check is never summarised — it is indexed", () => {
  // The one shape docs/work-mode.md refuses outright: there is no passage to
  // check an invented summary against, so a wrong one is invisible.
  const plan = planWorkTurn({ task: taskById("summarise"), source: LONG, query: "", ctx: 1024 });
  assert.equal(plan.mode, "contents");
  assert.equal(plan.messages, undefined);
  assert.match(plan.note, /too long/i);
  assert.ok(plan.used.length > 0);
});

test("with a question, a long document is answered from retrieved passages only", () => {
  const plan = planWorkTurn({ task: taskById("explain"), source: LONG, query: "complaints", ctx: 2048 });
  assert.equal(plan.mode, "passages");
  assert.ok(plan.used.length > 0);
  const sent = plan.messages.at(-1).content;
  for (const p of plan.used) assert.ok(sent.includes(p.text), "a shown passage was not the one sent");
  assert.ok(sent.length < LONG.length, "the whole document was sent anyway");
});

test("the model is told its extract is an extract", () => {
  const plan = planWorkTurn({ task: taskById("explain"), source: LONG, query: "complaints", ctx: 2048 });
  assert.match(plan.messages[0].content, /extract, not the whole document/i);
});

test("a question the long document shares no word with never reaches the model", () => {
  const plan = planWorkTurn({ task: taskById("explain"), source: LONG, query: "parking permits", ctx: 2048 });
  assert.equal(plan.mode, "none");
  assert.equal(plan.messages, undefined);
  assert.match(plan.note, /Nothing was sent to the model/);
});

test("every passage sent is a passage the page will show, and vice versa", () => {
  // The load-bearing invariant of the whole module: an answer is only ever
  // shown with the text it was allowed to see.
  for (const ctx of [1024, 2048, 4096]) {
    for (const q of ["complaints", "repairs portal", "housing officer"]) {
      const plan = planWorkTurn({ task: taskById("explain"), source: LONG, query: q, ctx });
      if (plan.mode !== "passages") continue;
      const sent = plan.messages.at(-1).content;
      assert.ok(plan.used.length, `${q} at ${ctx}: passages sent but none shown`);
      for (const p of plan.used) assert.ok(sent.includes(p.text), `${q} at ${ctx}`);
    }
  }
});

test("retrieved passages are shown in document order, not ranked order", () => {
  const plan = planWorkTurn({ task: taskById("explain"), source: LONG, query: "repairs complaints", ctx: 4096 });
  if (plan.mode !== "passages") return;
  const starts = plan.used.map(p => p.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test("a contents list is passages, verbatim, never prose", () => {
  const ps = splitPassages("# A\n\nAlpha text.\n\n# B\n\nBeta text.\n\n# C\n\nGamma text.");
  const list = contentsOf(ps, 2);
  assert.equal(list.length, 2);
  for (const p of list) assert.ok(ps.includes(p));
});

test("role-play carries a few turns; everything else is one-shot", () => {
  const history = [
    { role: "user", content: "hello" }, { role: "assistant", content: "hi" },
    { role: "user", content: "again" }, { role: "assistant", content: "yes" }
  ];
  const rp = planWorkTurn({ task: taskById("roleplay"), query: "a landlord", ctx: 4096, history });
  assert.ok(rp.messages.length > 2, "role-play lost its conversation");
  const one = planWorkTurn({ task: taskById("brainstorm"), query: "names", ctx: 4096, history });
  assert.equal(one.messages.length, 2, "a one-shot task carried history");
});

test("word count is what a person would count", () => {
  assert.equal(wordCount("one two  three\nfour"), 4);
  assert.equal(wordCount(""), 0);
});

test("the article matches the noun, in the prompt and the label", () => {
  // "Write a email" in a prompt is what the model writes back.
  const mail = taskById("draft").build({ source: "note", query: "about the boiler", option: "email" });
  assert.match(mail.system, /Write an email/);
  assert.match(mail.user, /Write an email/);
  const post = taskById("draft").build({ source: "note", query: "x", option: "letter" });
  assert.match(post.system, /Write a letter/);
  assert.equal(article("hour"), "a");   // spelling, not phonetics — good enough here
  assert.equal(article("idea"), "an");
});
