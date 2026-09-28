// Passage splitting and BM25 retrieval, kept for scripts/retrieval-bench.mjs.
//
// This used to ship in web/work.mjs as the retrieval layer of Work mode. Work
// mode was replaced by Desk (web/desk.mjs), which takes short pasted text only
// and never retrieves, so the code left the page. The measurements it produced
// are in docs/work-mode.md; the bench still runs it against the embedder, and
// tests/retrieval.test.mjs still holds it to the behaviour those numbers
// describe.

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
