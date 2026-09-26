// A film as a link: the whole story after the "#" (docs/film-plan.md, stage 6).
// The fragment never reaches the server, so nothing is uploaded — the link IS
// the story. What travels: the words, who is "she"/"he"/"they", each person's
// look, voice (by name) and pitch, the speakers the writer chose, and the sound
// switches. What never travels: recordings (they are the writer's own voice)
// and anything from a photo. Opening a link rebuilds the same film from rules.
import { cleanLook, PITCH } from "../film.mjs?v=6";

export const LIMITS = { text: 6000, name: 40, cast: 8, voice: 80, speakers: 300, key: 400 };

const toB64 = bytes => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const fromB64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
// Decompression stops at a cap: a small link must not inflate into gigabytes in someone's tab.
const MAX_BYTES = 256 * 1024;
async function through(stream, bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((n += value.length) > MAX_BYTES) { reader.cancel(); throw new Error("too big"); }
    parts.push(value);
  }
  const out = new Uint8Array(n); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";

/** Everything decoded from a link is capped and type-checked: a link is someone else's input. */
export function cleanFilm(o = {}) {
  o = o && typeof o === "object" ? o : {};
  const names = obj => Object.entries(obj && typeof obj === "object" ? obj : {}).slice(0, LIMITS.cast)
    .map(([k, v]) => [str(k, LIMITS.name).trim(), v]).filter(([k]) => k);
  return {
    text: str(o.text, LIMITS.text),
    pronouns: Object.fromEntries(names(o.pronouns).filter(([, v]) => ["she", "he", "they"].includes(v))),
    looks: Object.fromEntries(names(o.looks).map(([k, v]) => [k, cleanLook(v)])),
    voices: Object.fromEntries(names(o.voices).map(([k, v]) => [k, str(v, LIMITS.voice)]).filter(([, v]) => v)),
    pitch: Object.fromEntries(names(o.pitch).filter(([, v]) => v in PITCH)),
    speakers: Object.fromEntries(Object.entries(o.speakers && typeof o.speakers === "object" ? o.speakers : {}).slice(0, LIMITS.speakers)
      .map(([k, v]) => [str(k, LIMITS.key), str(v, LIMITS.name)]).filter(([k]) => k)),
    fx: o.fx !== false, amb: o.amb === true, music: o.music === true,
  };
}

/** "film=z…" (deflate-raw), or "film=j…" where CompressionStream is missing. */
export async function encodeFilm(film) {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, ...cleanFilm(film) }));
  if (typeof CompressionStream === "function") return "film=z" + toB64(await through(new CompressionStream("deflate-raw"), bytes));
  return "film=j" + toB64(bytes);
}

/** A film back out of a fragment ("#film=…"), cleaned; throws a sentence a person can read. */
export async function decodeFilm(fragment) {
  const m = String(fragment || "").match(/^#?film=([zj])([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error("This link does not hold a film.");
  let bytes;
  if (m[2].length > MAX_BYTES) throw new Error("This link is too long to be a film from this page.");
  try { bytes = fromB64(m[2]); } catch { throw new Error("This link is damaged — part of it may be missing."); }
  if (m[1] === "z") {
    if (typeof DecompressionStream !== "function") throw new Error("This browser is too old to open a shared film.");
    try { bytes = await through(new DecompressionStream("deflate-raw"), bytes); } catch { throw new Error("This link is damaged — part of it may be missing."); }
  }
  let o;
  try { o = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("This link is damaged — part of it may be missing."); }
  if (!o || o.v !== 1) throw new Error("This link was made by a newer version of the page.");
  return cleanFilm(o);
}
