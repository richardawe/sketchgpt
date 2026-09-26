// Does a small model invent answers about a document, and does forcing it to
// quote verbatim stop it?
//
// This is the feasibility gate for Work mode (docs/work-mode.md). The premise
// under test is the obvious one: "make it quote the source and you cannot
// hallucinate." The premise is wrong, and it is wrong in two different ways at
// two different sizes, which is why this script exists rather than an opinion.
//
//   node scripts/grounding-bench.mjs qwen3:0.6b qwen3:1.7b
//
// Needs Ollama (see the environment notes in CLAUDE.md — install zstd first).
//
// Five questions the document answers, five it does not. Inventing an answer
// to one of the second five is the failure being counted.

const DOC = `Oakfield House — Repairs and Maintenance Policy

Reporting. Residents should report repairs through the online portal or by
calling the office on weekdays between 9am and 5pm. Emergency repairs, meaning
a total loss of heating, water or electricity, can be reported at any time.

Response times. We attend emergency repairs within 24 hours. Urgent repairs,
such as a partial loss of heating or a leaking pipe that can be contained, are
attended within 5 working days. Routine repairs are completed within 28
calendar days.

Access. We will give at least 24 hours notice before entering a property for a
routine repair. Residents may ask to reschedule once without penalty.

Costs. Repairs arising from fair wear and tear are free. Damage caused by a
resident or their visitors is recharged at cost, and an invoice is issued
within 30 days of the work being completed.

Complaints. If a repair is not completed within the stated time, residents may
raise a complaint with the housing officer. Complaints are acknowledged within
3 working days.`;

const ANSWERABLE = [
  ["How long do routine repairs take?", /28/],
  ["How much notice is given before entering for a routine repair?", /24/],
  ["Within how long are complaints acknowledged?", /3\b|three/i],
  ["What counts as an emergency repair?", /heating|water|electric/i],
  ["When is an invoice issued for damage caused by a resident?", /30/],
];

// The document says nothing about any of these. An answer is an invention.
const ABSENT = [
  "What is the office phone number?",
  "Who is the current housing officer?",
  "How much is the recharge for a broken window?",
  "Can residents claim compensation for a late repair?",
  "Does the policy cover garden maintenance?",
];

const REFUSAL = /not (in|stated|specified|mentioned|covered|given|provided)|does not (say|state|mention|specify)|doesn't (say|mention)|no information|not found|cannot find|can't find|don't know|unknown|not available/i;

const FREE = `Answer the question using only the document below. If the document does not answer it, say "Not in the document."

DOCUMENT:
${DOC}`;

const QUOTE = `Answer the question using only the document below.
Return JSON: {"quote":"...","answer":"..."}
"quote" must be copied word for word from the document and must contain the answer.
If the document does not answer the question, return {"quote":"","answer":"Not in the document."}

DOCUMENT:
${DOC}`;

const SCHEMA = { type: "object", required: ["quote", "answer"],
  properties: { quote: { type: "string" }, answer: { type: "string" } } };

// Loose enough that punctuation and line wrapping do not count as a mismatch —
// the question is whether the words came from the document, not whitespace.
const flat = t => t.toLowerCase().replace(/[\s—-]+/g, " ")
  .replace(/[^a-z0-9 .,%]/g, "").trim();
const DOCFLAT = flat(DOC);
const inDoc = q => q.length > 8 && DOCFLAT.includes(flat(q));

async function ask(model, system, question, schema) {
  const body = { model, stream: false, think: false,
    options: { temperature: 0, num_predict: 300, num_ctx: 4096 },
    messages: [{ role: "system", content: system }, { role: "user", content: question }] };
  if (schema) body.format = schema;
  const res = await fetch(`${process.env.OLLAMA_HOST || "http://127.0.0.1:11434"}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = (await res.json()).message?.content ?? "";
  if (!schema) return { answer: out, quote: null };
  try { const j = JSON.parse(out); return { answer: j.answer ?? "", quote: j.quote ?? "" }; }
  catch { return { answer: out, quote: "" }; }
}

const models = process.argv.slice(2);
if (!models.length) {
  console.error("usage: node scripts/grounding-bench.mjs <model> [model...]");
  process.exit(1);
}

const rows = [];
for (const model of models) {
  for (const mode of ["free", "quote"]) {
    const system = mode === "free" ? FREE : QUOTE;
    const schema = mode === "quote" ? SCHEMA : null;
    let right = 0, refused = 0, invented = 0, caughtByQuote = 0, unquotable = 0;

    for (const [q, expect] of ANSWERABLE) {
      const { answer, quote } = await ask(model, system, q, schema);
      if (expect.test(answer)) right++;
      // A correct answer whose quote is not really in the document would be
      // thrown away by a verifier — a false positive, and the reason quote
      // checking cannot simply be switched on.
      if (mode === "quote" && !inDoc(quote)) unquotable++;
    }

    for (const q of ABSENT) {
      const { answer, quote } = await ask(model, system, q, schema);
      if (REFUSAL.test(answer) || (mode === "quote" && quote === "")) { refused++; continue; }
      invented++;
      if (mode === "quote" && !inDoc(quote)) caughtByQuote++;
    }
    rows.push({ model, mode, right, refused, invented, caughtByQuote, unquotable });
  }
}

console.log("\nmodel        mode    answered  refused  INVENTED  caught by quote  correct answers a verifier would bin");
for (const r of rows) {
  console.log(`  ${r.model.padEnd(11)}${r.mode.padEnd(8)}${`${r.right}/5`.padStart(8)}` +
    `${`${r.refused}/5`.padStart(9)}${`${r.invented}/5`.padStart(10)}` +
    `${(r.mode === "quote" ? `${r.caughtByQuote}/${r.invented}` : "—").padStart(17)}` +
    `${(r.mode === "quote" ? `${r.unquotable}/5` : "—").padStart(38)}`);
}
console.log(`
  INVENTED is the number that matters: an answer to a question the document
  does not address. "Caught by quote" is how many of those a verbatim check
  would have stopped. The last column is the cost of that check — correct
  answers discarded because the model could not copy the source.`);
