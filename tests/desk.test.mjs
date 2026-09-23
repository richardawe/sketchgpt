// Desk: two tools, the rule that decides whether the model runs, and the
// checks the page makes on what comes back.
//
//   node --test tests/desk.test.mjs
//
// The checks matter most. Each one is here because a real model failed in the
// way it catches — the failing outputs below are verbatim from Qwen3 on
// Ollama (docs/desk.md), not invented to make a test pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, TONES, toolById, planDeskTurn, maxWords, wordCount,
         parseChecklist, listFromProse, collapseRepeats,
         stripPreamble, checkRewrite, leftOut } from "../web/desk.mjs";
import { estimateTokens } from "../web/sketch.mjs";

const dump = toolById("dump");
const polish = toolById("polish");

test("Desk offers exactly two tools, brain dump first", () => {
  assert.deepEqual(TOOLS.map(t => t.id), ["dump", "polish"]);
});

test("every tool forbids inventing facts, in its own system prompt", () => {
  for (const t of TOOLS) {
    const { system } = t.build({ text: "x", option: TONES[0] });
    assert.match(system, /Never add a fact/, t.id);
  }
});

test("the tone reaches the prompt, and a missing tone still means something", () => {
  assert.match(polish.build({ text: "hi", option: "firmer" }).system, /firmer/);
  assert.match(polish.build({ text: "hi", option: "" }).system, /clearer/);
});

test("nothing typed means nothing runs, and the page says what to type", () => {
  for (const t of TOOLS) {
    const p = planDeskTurn({ tool: t, text: "   " });
    assert.equal(p.run, false);
    assert.equal(p.note, t.ask);
  }
});

test("a turn never asks for more room than the context has left", () => {
  for (const ctx of [1024, 2048, 4096]) for (const t of TOOLS) {
    const p = planDeskTurn({ tool: t, text: "word ".repeat(maxWords(t, ctx)), ctx });
    assert.equal(p.run, true, `${t.id} at ${ctx}: the advertised limit did not fit`);
    const sent = p.messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);
    assert.ok(sent + p.maxTokens <= ctx, `${t.id} at ${ctx}: ${sent} + ${p.maxTokens} > ${ctx}`);
  }
});

test("text that does not fit is refused with numbers, never cut short", () => {
  const text = "word ".repeat(maxWords(dump, 1024) * 3);
  const p = planDeskTurn({ tool: dump, text, ctx: 1024 });
  assert.equal(p.run, false);
  assert.match(p.note, new RegExp(`That is ${wordCount(text)} words`));
  assert.match(p.note, /about \d+ at once/);
});

test("a turn that runs always leaves room for a reply worth reading", () => {
  // Just past the limit is the case that matters: the prompt fits, and the
  // reply would be cut off after a few words, which reads as a broken model.
  for (const ctx of [1024, 4096]) for (const t of TOOLS) {
    for (let n = maxWords(t, ctx); n < maxWords(t, ctx) + 120; n += 5) {
      const p = planDeskTurn({ tool: t, text: "word ".repeat(n), ctx });
      if (p.run) assert.ok(p.maxTokens >= 160, `${t.id} at ${ctx}, ${n} words: only ${p.maxTokens} tokens left`);
    }
  }
});

test("the word limit the composer shows grows with the context", () => {
  for (const t of TOOLS) assert.ok(maxWords(t, 4096) > maxWords(t, 1024) * 3);
});

// ---- the checklist is the page's, not the model's --------------------------

test("list items are found however a small model bullets them", () => {
  assert.deepEqual(parseChecklist("- Buy milk\n* Call mum\n1. Renew passport\n2) Email Sam"),
    ["Buy milk", "Call mum", "Renew passport", "Email Sam"]);
  assert.deepEqual(parseChecklist("- [ ] one\n- [x] two"), ["one", "two"]);
  assert.deepEqual(parseChecklist("- **Bold** item\n- plain"), ["Bold item", "plain"]);
});

test("a bullet inside a bullet is one item, as Qwen3-0.6B wrote it", () => {
  assert.deepEqual(parseChecklist("- - Email Sam about the budget  \n- - Buy milk  "),
    ["Email Sam about the budget", "Buy milk"]);
});

test("quoted and repeated items are cleaned (Qwen2.5-0.5B and SmolLM2-360M, verbatim)", () => {
  assert.deepEqual(parseChecklist('- "book flights for June"\n- "pay the gas bill"\n- "reply to Priya"'),
    ["book flights for June", "pay the gas bill", "reply to Priya"]);
  assert.deepEqual(parseChecklist("- buy milk\n- call mum back\n- renew passport\n- call mum back"),
    ["buy milk", "call mum back", "renew passport"]);
});

test("prose instead of a list is split by the page (SmolLM2-360M, verbatim)", () => {
  // The phone bug: "after a few chats" the list came back as prose. SmolLM2
  // did this in 4 of 12 runs. These are two of them.
  assert.deepEqual(listFromProse('"Buy milk. Worried about Monday. Renew passport. Call mum back. The car is making a noise.'),
    ["Buy milk", "Worried about Monday", "Renew passport", "Call mum back", "The car is making a noise"]);
  assert.deepEqual(listFromProse("book flights for June\npay the gas bill\nfinish the slides for Thursday"),
    ["book flights for June", "pay the gas bill", "finish the slides for Thursday"]);
});

test("a refusal or a single sentence is not dressed up as a list", () => {
  assert.equal(listFromProse("I'm sorry, but I can't assist with that."), null);
  assert.equal(listFromProse("Here is your list:"), null);
});

test("a repetition loop is cut and reported (SmolLM2-360M, verbatim shape)", () => {
  const loop = "\"I'm not doing overtime again this weekend.\n[No. I'm not doing overtime again this weekend.\n" +
    "I'm not doing overtime again this weekend.\n".repeat(40) + "I'm not";
  const r = collapseRepeats(loop);
  assert.equal(r.looped, true);
  assert.ok(r.text.split("\n").length <= 3, r.text);
  assert.ok(!/I'm not$/.test(r.text), "the half-line where the budget ran out was kept");
  assert.deepEqual(collapseRepeats("one\ntwo\none"), { text: "one\ntwo\none", looped: false });
});

test("brain dump asks for no more room than a list needs", () => {
  const p = planDeskTurn({ tool: dump, text: "buy milk, call mum", ctx: 4096 });
  assert.ok(p.maxTokens <= 320, `a to-do list was given ${p.maxTokens} tokens to loop in`);
});

test("one line is not a checklist, so a non-answer is not dressed up as one", () => {
  assert.equal(parseChecklist("I can't help with that."), null);
  assert.equal(parseChecklist("- only one"), null);
});

test("a chatty opening line is stripped, and only that", () => {
  assert.equal(stripPreamble("Sure! Here's a friendlier version of your message:\nHi Sam"), "Hi Sam");
  assert.equal(stripPreamble("Here is the list:\n- a\n- b"), "- a\n- b");
  // The ONLY content the 0.6B returned in two runs was the preamble. Stripped,
  // nothing is left, and the page reports that rather than showing a blank.
  assert.equal(stripPreamble("Sure! Here's a firmer version of your message:"), "");
  assert.equal(stripPreamble("Sure thing, I can't make it."), "Sure thing, I can't make it.");
});

// ---- the checks -------------------------------------------------------------

test("a rewrite that drops a 'won't' is flagged (Qwen3-0.6B, verbatim)", () => {
  const w = checkRewrite("hi, the report wont be ready friday because the data came late, sorry",
    "Hi, the report will be ready Friday due to the data being delayed. Thank you for your understanding.");
  assert.equal(w.length, 1);
  assert.match(w[0], /will not happen/);
});

test("a rewrite that keeps the negation in other words is not flagged", () => {
  assert.deepEqual(checkRewrite("hi, the report wont be ready friday",
    "The report will not be ready on Friday."), []);
  assert.deepEqual(checkRewrite("i wont be able to pay the full rent",
    "I will be unable to pay the full rent this month."), []);
});

test("a rewrite that loses a number says which one", () => {
  const w = checkRewrite("Pay half now and half on the 15th, total 1,200", "Pay half now and half later, total 1,200.");
  assert.equal(w.length, 1);
  assert.match(w[0], /"15"/);
  assert.deepEqual(checkRewrite("by 5pm", "by 5 p.m."), []);
});

test("a brain-dump item missing from the list is named (Qwen3-1.7B dropped 'dentist')", () => {
  const out = leftOut(
    "dentist, email Sam about the budget, buy milk, worried about Monday, renew passport, call mum back, the car is making a noise",
    ["Call Mum back", "Email Sam about the budget", "Buy milk", "Renew passport", "Tell the car to be checked for noise"]);
  assert.deepEqual(out, ["dentist", "worried about Monday"]);
});

test("nothing is reported missing when everything made the list", () => {
  assert.deepEqual(leftOut("buy milk\ncall mum and renew passport",
    ["Buy milk", "Call mum", "Renew the passport"]), []);
});
