// Work mode — the page works on text you supplied, and on nothing else.
//
// Read docs/work-mode.md before changing anything here. The short version,
// because it is the whole design:
//
//   A small model asked "what does this document say about X" invents an
//   answer. Measured: Qwen3-0.6B invented answers to 3 of 5 questions its
//   document did not address, and asking it to quote the source made it 4 of
//   5. Qwen3-1.7B quoted perfectly and still concluded things the quote did
//   not support. A quote check catches invented sources; it does not catch
//   unsupported conclusions drawn from real ones.
//
// So the split this module enforces is not "chat vs RAG", it is:
//
//   The source fits in the window  ->  the model may work on it, and the page
//                                      shows the whole source beside the answer.
//                                      Every sentence is checkable, so a wrong
//                                      answer is the VISIBLE kind.
//   The source does not fit        ->  retrieval first. The passages are the
//                                      answer. Anything generated sits under
//                                      the passages it came from, never instead
//                                      of them.
//   No query and nothing fits      ->  generate nothing at all. Show where
//                                      things are; refuse to say what they say.
//
// Retrieval here is BM25, not an embedder. docs/work-mode.md specifies
// `snowflake-arctic-embed-s-b4`, which measures better (4/4 top-3) but costs a
// 67 MB download, 239 MB of GPU reserve, and depends on an untested gate — two
// WebLLM engines resident in one tab. BM25 needs none of that, runs on every
// device, and shares the property that actually matters: it returns existing
// text or nothing, so it cannot hallucinate. scripts/retrieval-bench.mjs runs
// both over the same document and prints the gap. The embedder remains the
// upgrade, and `findPassages` is the seam it plugs into.

import { estimateTokens } from "./sketch.mjs";

// ---- The file cap ---------------------------------------------------------
// Nothing here is uploaded: the text is read in the tab, held in a variable,
// and never written to storage. The cap is not about bandwidth, then — it is
// about the three costs that are real on a phone:
//
//   memory     the string, its passages and the index all sit in the tab
//   indexing   BM25 is linear in words; 512 KB is ~85k words, tens of ms
//   honesty    only a few hundred tokens of it ever reach the model, and a
//              page that accepts a 40 MB log implies otherwise
//
// 512 KB is roughly a 250-page book in plain text — far more than retrieval
// has been measured on, and small enough that the slow part is still the model.
export const MAX_FILE_BYTES = 512 * 1024;

// Text only, deliberately. PDF means pdf.js and a much larger surface (a
// scanned PDF has no text layer at all and would need OCR), so it is named as
// unsupported rather than failing as mojibake.
export const FILE_ACCEPT = ".txt,.md,.markdown,.text,.csv,.tsv,.log,.json,text/plain";

const EXT_OK = /\.(txt|md|markdown|text|csv|tsv|log|json)$/i;

export const fmtBytes = n => n < 1024 ? `${n} B`
  : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB`
  : `${(n / (1024 * 1024)).toFixed(1)} MB`;

// Checked before the file is read, so an oversized or binary file costs
// nothing. Returns null when the file is fine, or a sentence to show.
export function rejectFile(file) {
  if (!file) return "No file chosen.";
  if (file.size > MAX_FILE_BYTES)
    return `That file is ${fmtBytes(file.size)}. The limit is ${fmtBytes(MAX_FILE_BYTES)} — ` +
      `paste the part you care about instead.`;
  if (file.size === 0) return "That file is empty.";
  if (/\.pdf$/i.test(file.name))
    return "PDF is not supported yet. Open it, copy the text, and paste it below.";
  if (/\.(docx?|pptx?|xlsx?|odt|rtf|pages)$/i.test(file.name))
    return "That is a word-processor file, not plain text. Copy the text out and paste it below.";
  if (/\.(png|jpe?g|gif|webp|svg|heic|mp[34]|mov|zip|gz|tar)$/i.test(file.name))
    return "That is not a text file.";
  if (!EXT_OK.test(file.name) && file.type && !/^text\//.test(file.type))
    return `${file.name} does not look like plain text. Rename it to .txt if it is.`;
  return null;
}

// A file that passes rejectFile() can still be binary — a .log that is really
// a core dump, a .json that is gzipped. NUL bytes are the cheap tell, and a
// high share of control characters catches the rest.
export function rejectText(text) {
  if (!text.trim()) return "That file has no text in it.";
  if (text.includes("\u0000")) return "That file is binary, not text.";
  const sample = text.slice(0, 4096);
  // eslint-disable-next-line no-control-regex
  const control = (sample.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  if (control > sample.length * 0.02) return "That file is binary, not text.";
  return null;
}

// ---- Passages -------------------------------------------------------------
// A passage is what the page can show you. Everything downstream is a choice
// among these, never a rewrite of them, so they carry their offsets in the
// original text and are never normalised: what is shown is what you supplied.

const MAX_PASSAGE_CHARS = 700;   // long enough to hold an argument, short
                                 // enough that showing one is not showing the
                                 // whole document back
const MIN_PASSAGE_CHARS = 2;

const HEADING = /^(#{1,6}\s+\S|\s*\d+(\.\d+)*[.)]\s+\S|[A-Z][A-Za-z0-9 ,'’&/-]{2,60}:\s*$)/;

const isHeading = line =>
  HEADING.test(line) || (line.length <= 72 && line.trim().length > 2 &&
    line === line.toUpperCase() && /[A-Z]{3}/.test(line));

// Sentence ends: a terminator, optional quote/bracket, then whitespace. The
// lookbehind for a single capital keeps "J. Smith" and "e.g. this" together.
const SENTENCE_END = /(?<![A-Z])(?<!\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|No|Fig))([.!?]["'”’)\]]?)\s+/g;

function sentences(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length;
    out.push([last, end]);
    last = end;
  }
  if (last < text.length) out.push([last, text.length]);
  return out;
}

// Greedy pack of sentences up to MAX_PASSAGE_CHARS. A sentence longer than the
// cap on its own is kept whole rather than cut mid-word: showing a person half
// of their own sentence is worse than showing a long one.
function packed(text, offset) {
  const spans = sentences(text);
  const out = [];
  let from = null, to = null;
  for (const [s, e] of spans) {
    if (from === null) { from = s; to = e; continue; }
    if (e - from > MAX_PASSAGE_CHARS) { out.push([from, to]); from = s; to = e; }
    else to = e;
  }
  if (from !== null) out.push([from, to]);
  return out.map(([s, e]) => [s + offset, e + offset]);
}

/**
 * Split supplied text into passages, keeping each one's place in the original.
 * Blank lines are the primary boundary; a paragraph over MAX_PASSAGE_CHARS is
 * packed into sentence groups. Headings are carried, not emitted: a heading on
 * its own is not a passage anyone wants shown as an answer, but it is what
 * tells you where a passage sits.
 */
export function splitPassages(text) {
  const passages = [];
  let heading = "";
  let at = 0;
  for (const block of text.split(/\n[ \t]*\n+/)) {
    const start = text.indexOf(block, at);
    at = start + block.length;
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = block.split("\n");
    // A block that is only a heading labels what follows rather than standing
    // as a passage of its own.
    if (lines.length === 1 && isHeading(trimmed) && trimmed.length <= 90) {
      heading = trimmed.replace(/^#+\s*/, "").replace(/:\s*$/, "");
      continue;
    }
    // A heading glued to the top of its paragraph: take it and keep the rest.
    let body = block, bodyStart = start;
    if (lines.length > 1 && isHeading(lines[0].trim()) && lines[0].trim().length <= 90) {
      heading = lines[0].trim().replace(/^#+\s*/, "").replace(/:\s*$/, "");
      const skip = lines[0].length + 1;
      body = block.slice(skip); bodyStart = start + skip;
      if (!body.trim()) continue;
    }

    for (const [s, e] of packed(body, bodyStart)) {
      const slice = text.slice(s, e);
      if (slice.trim().length < MIN_PASSAGE_CHARS) continue;
      passages.push({ i: passages.length, start: s, end: e, text: slice.trim(), heading });
    }
  }
  return passages;
}

export const wordCount = text => (text.match(/\S+/g) || []).length;

// ---- Retrieval ------------------------------------------------------------
// BM25 over the passages. The point of this layer is not that it is clever;
// it is that it can only ever hand back text the person supplied.

const STOP = new Set(("a an the and or but if of to in on at by for with from as is are was were " +
  "be been being do does did doing have has had i you he she it we they this that these those " +
  "there here what which who whom whose when where why how can could should would will shall may " +
  "might must not no nor so than then too very s t don now my your our their me him her us them " +
  "about into over under again further once " +
  // Indefinites: they carry no topic, and stemming mangles them into noise
  // ("something" -> "someth") that then shows up in "no match for …".
  "something someone somebody somewhere anything anyone anybody anywhere everything everyone " +
  "everybody nothing nobody myself yourself himself herself itself ourselves themselves " +
  "get got let please just also").split(" "));

// Deliberately shallow. An aggressive stemmer buys a little recall and loses
// the ability to explain a miss; the vocabulary gap it leaves is measured in
// scripts/retrieval-bench.mjs rather than assumed away.
export function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("sses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed") && !w.endsWith("eed")) return w.slice(0, -2);
  return w;
}

/**
 * Content terms, stemmed. `spelled` collects stem -> the word as it was
 * written, so anything shown back to a person is their own word rather than
 * the stem: "no match for someth" is a bug report waiting to happen.
 */
export function terms(text, spelled = null) {
  const out = [];
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []) {
    const w = raw.replace(/['’]s$/, "");
    if (w.length < 2 || STOP.has(w)) continue;
    const s = stem(w);
    if (spelled && !spelled.has(s)) spelled.set(s, w);
    out.push(s);
  }
  return out;
}

const K1 = 1.5, B = 0.75;
const PREFIX = 5;

/** Build a BM25 index over passages. Pure data — safe to hold and to drop. */
export function buildIndex(passages) {
  const docs = passages.map(p => {
    const tf = new Map();
    const t = terms(p.text);
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    return { tf, len: t.length };
  });
  const df = new Map();
  for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length || 1;
  const avgdl = docs.reduce((s, d) => s + d.len, 0) / N || 1;

  // Measured: "How do I complain?" found nothing in a document that answers it
  // twice, because it says "complaint" and "complaints". No stemmer merges
  // those — they are different words, not inflections — so the fix is a prefix
  // bucket rather than a deeper stemmer. It turned that query from a MISS into
  // a HIT@1 and changed no other result on the bench document.
  const byPrefix = new Map();
  for (const w of df.keys()) {
    if (w.length < PREFIX) continue;
    const k = w.slice(0, PREFIX);
    if (!byPrefix.has(k)) byPrefix.set(k, []);
    byPrefix.get(k).push(w);
  }

  // Map a query term onto a term the document actually uses: itself if it is
  // there, otherwise the shortest word that extends it or that it extends.
  const resolve = w => {
    if (df.has(w)) return w;
    if (w.length < PREFIX) return null;
    const bucket = byPrefix.get(w.slice(0, PREFIX));
    if (!bucket) return null;
    let best = null;
    for (const v of bucket) {
      if (!v.startsWith(w) && !w.startsWith(v)) continue;
      if (!best || v.length < best.length) best = v;
    }
    return best;
  };

  const idf = w => {
    const n = df.get(w) || 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };
  return { passages, docs, df, N, avgdl, idf, resolve };
}

/**
 * Rank passages against a query.
 *
 * Returns `{ hits, coverage, terms, missing }`. `coverage` is the share of the
 * query's information — measured in idf, so rare words count for most — that
 * the best passage contains.
 *
 * READ THIS BEFORE USING `coverage` AS A THRESHOLD. It does not work as one.
 * docs/work-mode.md records that the embedder's *scores* separate answerable
 * queries (0.642–0.798) from unanswerable ones (max 0.574), which is what lets
 * the page decline. BM25 coverage does not separate at all. Measured on the
 * same document and the same six queries:
 *
 *   answerable    0.277, 0.553, 0.413, 1.000
 *   unanswerable  0.413, 0.000
 *
 * "Who owns the building?" scores 0.413 — above one query the document answers
 * and exactly level with another — because the document is full of the word
 * "building"; it just never says who owns it. Lexical overlap cannot tell
 * "topic absent" from "topic present, question unanswered", and no threshold
 * over those numbers keeps the hits and drops the misses.
 *
 * So this layer declines on the one signal that is true by construction:
 * `hits` is empty, meaning no passage shares a single content word with the
 * query. Everything else is shown to the reader with its passages, and the
 * reader judges — being shown the wrong paragraph is visible, which is the
 * failure this project ships. An embedder would buy back the graded refusal;
 * see the note at the top of this file.
 */
export function findPassages(index, query, { limit = 5 } = {}) {
  const spelled = new Map();
  const asked = [...new Set(terms(query, spelled))];
  const word = s => spelled.get(s) || s;
  // Query terms mapped onto the document's own vocabulary; unmatched ones are
  // reported — as the person spelled them — so the page can say what it could
  // not find.
  const found = [], missing = [];
  for (const w of asked) {
    const r = index.resolve(w);
    if (r) found.push(r); else missing.push(word(w));
  }

  const ranked = index.docs.map((d, i) => {
    let score = 0;
    for (const w of found) {
      const f = d.tf.get(w) || 0;
      if (!f) continue;
      score += index.idf(w) * (f * (K1 + 1)) /
        (f + K1 * (1 - B + B * d.len / index.avgdl));
    }
    return { passage: index.passages[i], score, i };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);

  const total = asked.reduce((s, w) => s + index.idf(index.resolve(w) || w), 0);
  const hits = ranked.slice(0, limit);
  let coverage = 0;
  if (hits[0] && total) {
    const tf = index.docs[hits[0].i].tf;
    coverage = found.reduce((s, w) => s + (tf.has(w) ? index.idf(w) : 0), 0) / total;
  }
  return { hits, coverage, terms: asked.map(word), missing };
}

// ---- Tasks ----------------------------------------------------------------
// Every one of these works on text the person supplied, or on nothing at all.
// None of them may introduce a fact, and the system line says so on every turn.
//
// `shape` is the load-bearing field and it is the project's oldest finding:
//
//   open    no single correct answer (draft, rewrite, brainstorm, role-play).
//           Failure looks like mediocrity, which you can see. Safe at 0.6B.
//   closed  there IS a correct answer (summarise, explain, translate).
//           Failure is confident and well-formed. Only ever shown with the
//           source beside it, and never over a document too long to check.

const GROUND =
  "You work only with the text the person gives you. You cannot browse, you " +
  "know nothing about their situation beyond what is written, and you cannot " +
  "check anything. Never add a fact, name, number, date or claim that is not " +
  "in their text. If their text does not contain what is needed, say that in " +
  "one short line instead of guessing.";

const src = s => `Their text:\n"""\n${s}\n"""`;

export const TONES = ["clearer", "friendlier", "shorter", "more professional",
  "warmer", "firmer", "simpler", "more formal", "less formal"];

export const FORMATS = ["text message", "WhatsApp message", "email", "letter"];

// "Write a email" in a prompt teaches the model to write it back. The article
// is cheap to get right and the option labels use the same helper.
export const article = w => /^[aeiou]/i.test(w) ? "an" : "a";

export const TASKS = [
  {
    id: "draft", label: "Draft a message", group: "Write", shape: "open",
    source: "optional", temp: 0.7, options: { key: "format", label: "As a", values: FORMATS },
    ask: "What should it say? Who is it to?",
    build: ({ query, source, option }) => {
      const kind = option || "message";
      return {
        system: `${GROUND} Write ${article(kind)} ${kind} for them. Use only the details they ` +
          `give — where a detail is missing, leave an obvious blank like [date] rather than ` +
          `inventing one. No preamble, no explanation: just the message.`,
        user: source ? `${src(source)}\n\nWrite ${article(kind)} ${kind}: ${query}` : query
      };
    }
  },
  {
    id: "rewrite", label: "Rewrite it", group: "Improve", shape: "open",
    source: "required", temp: 0.6, options: { key: "tone", label: "Make it", values: TONES },
    ask: "Anything specific to change? (optional)",
    build: ({ source, query, option }) => ({
      system: `${GROUND} Rewrite their text to be ${option || "clearer"}. Keep every fact, name ` +
        `and number exactly as they wrote it. Change the wording, never the meaning. ` +
        `Return only the rewrite.`,
      user: `${src(source)}\n\nRewrite it to be ${option || "clearer"}.` + (query ? ` ${query}` : "")
    })
  },
  {
    id: "shorten", label: "Shorten it", group: "Improve", shape: "open",
    source: "required", temp: 0.4, ask: "How short? (optional)",
    build: ({ source, query }) => ({
      system: `${GROUND} Cut their text down. Drop repetition and padding, keep every fact and ` +
        `the original voice. Return only the shortened text.`,
      user: `${src(source)}\n\nShorten it.` + (query ? ` ${query}` : "")
    })
  },
  {
    id: "expand", label: "Expand it", group: "Improve", shape: "open",
    source: "required", temp: 0.7, ask: "What should it cover? (optional)",
    build: ({ source, query }) => ({
      system: `${GROUND} Develop their idea into fuller writing. You may add structure, ` +
        `transitions and phrasing — you may NOT add facts, examples or figures they did not ` +
        `give. Where an example would help, mark it [example needed]. Return only the writing.`,
      user: `${src(source)}\n\nExpand this.` + (query ? ` ${query}` : "")
    })
  },
  {
    id: "summarise", label: "Summarise it", group: "Understand", shape: "closed",
    source: "required", temp: 0.3, ask: "Summarise with what in mind? (optional)",
    needsWhole: true,
    build: ({ source, query }) => ({
      system: `${GROUND} Summarise their text in a few short sentences or bullets. Every point ` +
        `must come from the text. Do not conclude, recommend or infer — if it is not stated, ` +
        `it does not go in.`,
      user: `${src(source)}\n\nSummarise it.` + (query ? ` Focus on: ${query}` : "")
    })
  },
  {
    id: "explain", label: "Explain what it means", group: "Understand", shape: "closed",
    source: "required", temp: 0.3, ask: "What part is unclear? (optional)",
    build: ({ source, query }) => ({
      system: `${GROUND} Explain in plain words what their text says. Explain only what is ` +
        `written — do not tell them what it implies for them, what they should do, or what is ` +
        `normal elsewhere. If they ask something the text does not answer, say the text does ` +
        `not say.`,
      user: `${src(source)}\n\n` + (query ? `Explain: ${query}` : "Explain what this means.")
    })
  },
  {
    id: "reply", label: "Suggest a reply", group: "Write", shape: "open",
    source: "required", temp: 0.7, ask: "How do you want to answer?",
    build: ({ source, query }) => ({
      system: `${GROUND} Draft a reply to the message they received. Give two options of ` +
        `different length, labelled "Short" and "Fuller". Use only what they told you; leave ` +
        `[blanks] for anything you would have to invent.`,
      user: `${src(source)}\n\nDraft a reply.` + (query ? ` I want to say: ${query}` : "")
    })
  },
  {
    id: "brainstorm", label: "Brainstorm ideas", group: "Think", shape: "open",
    source: "optional", temp: 0.9, ask: "What are we thinking about?",
    build: ({ source, query }) => ({
      system: `${GROUND} Give a short list of distinct ideas — different in kind, not ` +
        `rewordings of each other. One line each, no preamble. Ideas are suggestions, not ` +
        `claims about the world.`,
      user: (source ? `${src(source)}\n\n` : "") + `Ideas for: ${query}`
    })
  },
  {
    id: "structure", label: "Turn rough notes into writing", group: "Write", shape: "open",
    source: "required", temp: 0.6, ask: "What is it for? (optional)",
    build: ({ source, query }) => ({
      system: `${GROUND} Turn their rough thoughts into structured prose. Keep their points and ` +
        `their order of priority; add only connective wording. Nothing that is not in the notes ` +
        `may appear in the writing.`,
      user: `${src(source)}\n\nTurn this into structured writing.` + (query ? ` It is for: ${query}` : "")
    })
  },
  {
    id: "organise", label: "Organise messy notes", group: "Write", shape: "open",
    source: "required", temp: 0.3, ask: "Group them how? (optional)",
    build: ({ source, query }) => ({
      system: `${GROUND} Reorganise their notes under headings, keeping the wording close to ` +
        `theirs. Group what belongs together and keep every item — if something fits nowhere, ` +
        `put it under "Loose ends". Add nothing.`,
      user: `${src(source)}\n\nOrganise these notes.` + (query ? ` Group by: ${query}` : "")
    })
  },
  {
    id: "creative", label: "Creative writing", group: "Write", shape: "open",
    source: "optional", temp: 1.0, ask: "What shall I write?",
    build: ({ source, query }) => ({
      system: `${GROUND} Write what they ask for. This is fiction: invention inside the story ` +
        `is the job. Do not present anything invented as a fact about them or the real world.`,
      user: (source ? `${src(source)}\n\n` : "") + query
    })
  },
  {
    id: "questions", label: "Generate questions", group: "Think", shape: "open",
    source: "required", temp: 0.7, ask: "Questions for what purpose? (optional)",
    build: ({ source, query }) => ({
      system: `${GROUND} Write questions their text raises but does not answer. Each question ` +
        `must be answerable by a person, not by you, and must arise from something actually ` +
        `written. One line each.`,
      user: `${src(source)}\n\nWhat questions does this raise?` + (query ? ` For: ${query}` : "")
    })
  },
  {
    id: "critique", label: "Critique it", group: "Think", shape: "open",
    source: "required", temp: 0.5, ask: "What should I look at? (optional)",
    build: ({ source, query }) => ({
      system: `${GROUND} Give specific, usable criticism of what they wrote. Quote the phrase ` +
        `you are talking about, say what is weak, and say what would be stronger. Three to five ` +
        `points. No score, no summary of how good it is overall.`,
      user: `${src(source)}\n\nCritique this.` + (query ? ` Look at: ${query}` : "")
    })
  },
  {
    id: "roleplay", label: "Role-play a conversation", group: "Think", shape: "open",
    source: "optional", temp: 0.8, ask: "Who am I talking to, and about what?",
    multiTurn: true,
    build: ({ source, query }) => ({
      system: `${GROUND} Play the part they describe so they can rehearse. Stay in character, ` +
        `answer as that person would, keep replies to a few lines. Invent only what the role ` +
        `needs — never a fact about the person's real situation. If they type "stop", drop the ` +
        `character.`,
      user: (source ? `${src(source)}\n\n` : "") + query
    })
  },
  {
    id: "plan", label: "Plan it out", group: "Think", shape: "open",
    source: "optional", temp: 0.5, ask: "What are you planning, and what are the constraints?",
    build: ({ source, query }) => ({
      system: `${GROUND} Turn their constraints into an ordered plan. Every step must respect ` +
        `every constraint they gave. Do not add budget, timing or requirements they did not ` +
        `state — where something is missing, write it as an open question at the end.`,
      user: (source ? `${src(source)}\n\n` : "") + `Plan this: ${query}`
    })
  },
  {
    id: "translate", label: "Translate it", group: "Understand", shape: "closed",
    source: "required", temp: 0.2, ask: "Into which language?",
    needsQuery: true, needsWhole: true,
    build: ({ source, query }) => ({
      system: `${GROUND} Translate their text. Translate everything and add nothing — no notes, ` +
        `no explanations, no alternatives. Keep names, numbers and formatting as they are. If a ` +
        `phrase has no good equivalent, keep the original in brackets after your best attempt.`,
      user: `${src(source)}\n\nTranslate into ${query}.`
    })
  },
  {
    id: "decide", label: "Think a decision through", group: "Think", shape: "open",
    source: "optional", temp: 0.6, ask: "What are you deciding between?",
    build: ({ source, query }) => ({
      system: `${GROUND} Help them think, do not decide for them. Lay out what each option ` +
        `costs and gains ACCORDING TO WHAT THEY SAID, name the one thing that would settle it, ` +
        `and end with the question they still have to answer. Never claim a fact about the ` +
        `world, a market, a law or a person to support an option. Do not recommend.`,
      user: (source ? `${src(source)}\n\n` : "") + `I am deciding: ${query}`
    })
  }
];

export const taskById = id => TASKS.find(t => t.id === id) || null;

// ---- Planning a turn ------------------------------------------------------

const RESERVE = 64;          // template drift, role tokens, a stop token
const MIN_OUTPUT = 96;       // below this an answer is not worth starting
const MESSAGE_OVERHEAD = 4;
const msgTokens = m => estimateTokens(m.content) + MESSAGE_OVERHEAD;

/**
 * Decide what the model gets to see, and whether it gets to run at all.
 *
 * Returns `{ mode, messages, maxTokens, used, note }`.
 *
 *   mode "none"      nothing to do — the page says why, no model runs
 *   mode "whole"     the entire source fits; the page shows all of it
 *   mode "passages"  retrieved passages only; the page shows exactly these
 *   mode "contents"  too long, no query: NOTHING is generated. The page lists
 *                    where things are. This is the shape docs/work-mode.md
 *                    forbids generating over, and refusing is the feature.
 *
 * `used` is always the passages the answer may be checked against, and the
 * page is required to show them. An answer without its source is the failure
 * this whole module exists to prevent.
 */
export function planWorkTurn({ task, source = "", query = "", option = "",
                               index = null, passages = null, ctx = 4096, history = [] }) {
  if (!task) return { mode: "none", note: "Pick a task first." };

  const text = source.trim();
  if (task.source === "required" && !text)
    return { mode: "none", note: "Add a document or paste some text first." };
  if ((task.needsQuery || (!text && task.source !== "required")) && !query.trim())
    return { mode: "none", note: task.ask };

  const all = passages || (text ? splitPassages(text) : []);

  // Cost the prompt with the whole source in it, then see what is left.
  const whole = task.build({ source: text, query: query.trim(), option });
  const wholeCost = msgTokens({ content: whole.system }) + msgTokens({ content: whole.user });
  const seed = task.multiTurn ? history.slice(-4).map(m => ({ ...m })) : [];
  const seedCost = seed.reduce((n, m) => n + msgTokens(m), 0);

  if (!text || wholeCost + seedCost + RESERVE + MIN_OUTPUT <= ctx) {
    return {
      mode: "whole",
      messages: [{ role: "system", content: whole.system }, ...seed,
                 { role: "user", content: whole.user }],
      maxTokens: Math.max(MIN_OUTPUT, Math.min(1200, ctx - wholeCost - seedCost - RESERVE)),
      used: all,
      note: ""
    };
  }

  // Too long to hold. From here the model may only ever see passages, and
  // only passages the page is about to show.
  if (!query.trim()) {
    // Nothing to retrieve against and nothing that fits. Generating a summary
    // here is the one shape docs/work-mode.md refuses outright: there is no
    // passage to check it against, so a wrong one is invisible.
    return {
      mode: "contents", used: contentsOf(all),
      note: `This is too long to read whole at a ${ctx}-token context` +
        (task.needsWhole
          ? `, and ${task.label.toLowerCase()} over a document nobody can check is exactly how a ` +
            `small model misleads you. Here is where things are — ask a question to go further.`
          : `. Ask a question and the page will find the passages that answer it.`)
    };
  }

  const idx = index || buildIndex(all);
  // Six, not as many as the window holds. These are meant to be READ — that is
  // the entire design — and twelve passages push the answer off the top of a
  // phone and stop being something anyone checks. The retrieval bench measures
  // the right sentence in the top 3.
  const { hits, coverage, terms: qTerms, missing } = findPassages(idx, query, { limit: 6 });

  // The only refusal this layer can make honestly: not one passage shares a
  // content word with the question. Anything above that is shown rather than
  // judged — see findPassages for why there is no threshold here.
  if (!hits.length) {
    return {
      mode: "none", used: [], coverage, missing,
      note: `Nothing in this document mentions ` +
        (qTerms.length ? qTerms.slice(0, 4).map(t => `"${t}"`).join(", ") : "that") +
        `. Nothing was sent to the model.`
    };
  }

  // Fill the room with passages, best first, then show them in document order
  // so they read as a document rather than as a ranking.
  const probe = task.build({ source: "", query: query.trim(), option });
  const overhead = msgTokens({ content: probe.system }) + msgTokens({ content: probe.user })
    + seedCost + RESERVE + MIN_OUTPUT;
  let room = ctx - overhead;
  const picked = [];
  for (const h of hits) {
    const cost = estimateTokens(h.passage.text) + 8;
    if (cost > room) continue;
    room -= cost;
    picked.push(h.passage);
  }
  if (!picked.length) picked.push(hits[0].passage);   // one passage always beats none
  picked.sort((a, b) => a.start - b.start);

  const excerpt = picked.map(p => (p.heading ? `[${p.heading}] ` : "") + p.text).join("\n\n");
  const built = task.build({ source: excerpt, query: query.trim(), option });
  const cost = msgTokens({ content: built.system }) + msgTokens({ content: built.user }) + seedCost;

  return {
    mode: "passages",
    messages: [{ role: "system", content: built.system + " The text below is an extract, not the " +
                 "whole document. Answer only from the extract; if it does not cover the " +
                 "question, say so." }, ...seed,
               { role: "user", content: built.user }],
    maxTokens: Math.max(MIN_OUTPUT, Math.min(800, ctx - cost - RESERVE)),
    used: picked, coverage, missing,
    note: `Found ${picked.length} passage${picked.length === 1 ? "" : "s"} of ${all.length}. ` +
      `The answer can only be as good as these — read them.` +
      (missing.length ? ` Nothing in the document matches ` +
        missing.slice(0, 3).map(t => `"${t}"`).join(", ") + `.` : "")
  };
}

// The honest form of "summarise" for a document too long to check: where
// things are, not what they say. One passage per heading, in document order,
// every word verbatim. docs/work-mode.md calls this a contents list.
export function contentsOf(passages, limit = 12) {
  const out = [];
  const seen = new Set();
  for (const p of passages) {
    const key = p.heading || "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
