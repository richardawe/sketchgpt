// A book in a link, and the edits a person makes to it. PROTOTYPE, behind
// ?animate=1 (a link made there opens anywhere).
//
// The whole book travels after the "#": title, cast, each page's words and
// the list of things its picture holds, the cover's list, and the voice's
// name. Browsers never send the fragment to the server, so GitHub never sees
// the story, and the person opening it needs no model: the page redraws the
// same pictures from the lists, and renderSketch is seeded, so they come out
// the same. Voices belong to devices; only the name travels.
//
// Everything decoded here came from a link anyone could have written, so it
// is capped and type-checked before the page touches it, and the page shows
// it as text, never markup.
import { drawAs, nameWords, SHAPE, storyMessages } from "./book.mjs?v=8";

export const LIMITS = { title: 120, name: 40, is: 20, pages: 8, text: 600, things: 24, thing: 48, voice: 80 };
const str = (v, max) => (typeof v === "string" ? v : "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const list = (v, n, max) => (Array.isArray(v) ? v : []).slice(0, n * 4).map(x => str(x, max)).filter(Boolean).slice(0, n);

/** A book, checked and capped: what the page will draw, whatever the link said. */
export function cleanBook(b) {
  if (!b || typeof b !== "object") throw new Error("This link does not hold a book.");
  const pages = (Array.isArray(b.pages) ? b.pages : []).slice(0, LIMITS.pages)
    .map(p => ({ text: str(p && p.text, LIMITS.text), things: list(p && p.things, LIMITS.things, LIMITS.thing) }))
    .filter(p => p.text);
  if (!pages.length) throw new Error("This link does not hold a book.");
  return {
    title: str(b.title, LIMITS.title) || "A story",
    cast: (Array.isArray(b.cast) ? b.cast : []).slice(0, 3)
      .map(c => ({ name: str(c && c.name, LIMITS.name), is: str(c && c.is, LIMITS.is).toLowerCase() }))
      .filter(c => c.name && c.is),
    pages,
    cover: list(b.cover, LIMITS.things, LIMITS.thing),
    voice: str(b.voice, LIMITS.voice),
  };
}

// Short keys: the link is the whole book, and every byte is in someone's message.
const pack = b => ({ v: 1, t: b.title, c: b.cast.map(c => [c.name, c.is]), p: b.pages.map(p => [p.text, p.things]),
  k: b.cover, s: b.voice || undefined });
const unpack = o => ({ title: o.t, cast: (o.c || []).map(c => ({ name: c && c[0], is: c && c[1] })),
  pages: (o.p || []).map(p => ({ text: p && p[0], things: p && p[1] })), cover: o.k, voice: o.s });

const toB64 = bytes => { let s = ""; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const fromB64 = t => { const s = atob(t.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, c => c.charCodeAt(0)); };
async function through(stream, bytes) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * The fragment for a book: "book=z…" compressed (deflate-raw, every current
 * browser), or "book=j…" plain where CompressionStream is missing.
 */
export async function encodeBook(book) {
  const bytes = new TextEncoder().encode(JSON.stringify(pack(cleanBook(book))));
  if (typeof CompressionStream === "function")
    return "book=z" + toB64(await through(new CompressionStream("deflate-raw"), bytes));
  return "book=j" + toB64(bytes);
}

/** A book back out of a fragment ("#book=…" or "book=…"), cleaned; throws on anything else. */
export async function decodeBook(fragment) {
  const m = String(fragment || "").match(/^#?book=([zj])([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error("This link does not hold a book.");
  let bytes;
  try { bytes = fromB64(m[2]); } catch { throw new Error("This link is damaged — part of it may be missing."); }
  if (m[1] === "z") {
    if (typeof DecompressionStream !== "function") throw new Error("This browser is too old to open a shared book.");
    try { bytes = await through(new DecompressionStream("deflate-raw"), bytes); }
    catch { throw new Error("This link is damaged — part of it may be missing."); }
  }
  let o;
  try { o = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("This link is damaged — part of it may be missing."); }
  if (!o || o.v !== 1) throw new Error("This link was made by a newer version of the page.");
  return cleanBook(unpack(o));
}

// ---- Edits -------------------------------------------------------------------
// The page corrects the model, never the person: an edit is taken as typed,
// and nothing here tidies it. These only carry an edit to everywhere it
// belongs — a new name to every page, a new kind of character to every picture.

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every whole-word use of `from` in `text` becomes `to`. */
export function replaceName(text, from, to) {
  if (!from || from === to) return text;
  return text.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escape(from)}(?=$|[^\\p{L}\\p{N}])`, "gu"), `$1${to}`);
}

/**
 * Apply a change to one character everywhere: a new name to the title and
 * every page's words; a new kind (dog → cat) to every picture's list, so the
 * same picture stays the same character on every page.
 */
export function changeCharacter(book, index, next) {
  const was = book.cast[index];
  if (!was) return book;
  const now = { name: str(next.name, LIMITS.name) || was.name, is: str(next.is, LIMITS.is).toLowerCase() || was.is };
  const oldWord = drawAs(was), newWord = drawAs(now);
  // Names can appear on their own ("Mr. Gull" is also "Gull"): replace the
  // full name first, then a lone word of it that identifies them.
  const oldBits = nameWords(was.name), newBits = nameWords(now.name);
  const rename = t => {
    let out = replaceName(t, was.name, now.name);
    if (oldBits.length === 1 && newBits.length === 1 && was.name !== now.name) {
      const lone = was.name.split(/\s+/).find(w => w.toLowerCase().replace(/[^a-z'-]/g, "") === oldBits[0]);
      const to = now.name.split(/\s+/).find(w => w.toLowerCase().replace(/[^a-z'-]/g, "") === newBits[0]);
      if (lone && to) out = replaceName(out, lone, to);
    }
    return out;
  };
  const redraw = things => oldWord && newWord && oldWord !== newWord
    ? things.map(e => e.replace(new RegExp(`(^|\\s)${escape(oldWord)}(?=\\s|$)`), `$1${newWord}`)) : things;
  return {
    ...book,
    title: rename(book.title),
    cast: book.cast.map((c, i) => i === index ? now : c),
    pages: book.pages.map(p => ({ text: rename(p.text), things: redraw(p.things) })),
    cover: redraw(book.cover),
  };
}

/** The picture's list as a person edits it: one thing per line, blanks dropped. */
export const thingsFrom = text => list(String(text).split(/\n|,/), LIMITS.things, LIMITS.thing);

// ---- "Rewrite this page" -------------------------------------------------------
// The one edit that asks the model. Its answer goes into the editor, not the
// book: the person reads it, keeps it or not, and can undo it after. On the
// phone's 0.6B it will be shaky — visibly, which is the kind that may ship.
export const REWRITE_SCHEMA = JSON.stringify({ type: "object", required: ["text"], additionalProperties: false,
  properties: { text: { type: "string", maxLength: 400 } } });

export function rewriteMessages(book, index, draft) {
  const names = book.cast.map(c => `${c.name} (${c.is})`).join(", ");
  const before = index > 0 ? ` The page before says: "${book.pages[index - 1].text}"` : "";
  const job = SHAPE[index] ? ` This page is for: ${SHAPE[index]}.` : "";
  return [storyMessages("")[0], { role: "user", content:
    `This is page ${index + 1} of ${book.pages.length} of the picture book "${book.title}". The characters: ${names}.` +
    `${before}${job} This page now says: "${draft}" Write this page again in two or three short, simple sentences, ` +
    `keeping the same characters and names. Reply in JSON with the text.` }];
}

/** The model's rewrite, or null if it did not write one. */
export function readRewrite(raw) {
  let t = String(raw || "");
  const end = t.indexOf("</think>");
  if (end !== -1) t = t.slice(end + 8);
  try { const o = JSON.parse(t.trim()); if (o && typeof o.text === "string" && o.text.trim()) return str(o.text, LIMITS.text); } catch {}
  const m = t.match(/"text"\s*:\s*"((?:[^"\\]|\\.)+)/);
  return m ? str(m[1].replace(/\\"/g, '"'), LIMITS.text) : null;
}
