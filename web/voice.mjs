// Reading the book aloud, with the voice the device already has. PROTOTYPE,
// behind ?animate=1.
//
// Kokoro (82M, kokoro-js) was tried first and measured in Chromium: 11-15 s to
// make 4-5 s of speech on one CPU core — about 3x slower than it speaks. A
// page on GitHub Pages cannot be cross-origin isolated, so its WASM gets one
// thread, and a phone is not faster. It also costs a 92 MB download. The
// system voice costs nothing, starts at once, works offline, and is on every
// iPhone. Its timing events are per utterance, not per word (Safari's word
// boundaries are unreliable), so the page reads — and highlights — one
// sentence at a time.

/**
 * A page's words as sentences, the unit that is spoken and highlighted. "Mr."
 * is not the end of one: the first test split "Mr. Gull flies down" in two,
 * and the voice would have paused in the middle of a name.
 */
const TITLE = /\b(Mr|Mrs|Ms|Dr|St|Mt|Prof|Capt|Sgt)\.$/;
export function sentences(text) {
  const out = [];
  for (const piece of String(text).trim().split(/(?<=[.!?…]["'’”)]?)\s+/)) {
    if (out.length && TITLE.test(out.at(-1))) out[out.length - 1] += " " + piece;
    else out.push(piece);
  }
  return out.map(s => s.trim()).filter(Boolean);
}

/**
 * The nicest voice on offer for a language: the device's own enhanced or
 * natural voices first, then any local voice, then anything in the language.
 * Local voices work offline; network voices (some of Chrome's) do not.
 */
export function pickVoice(voices, lang = "en") {
  const inLang = voices.filter(v => (v.lang || "").toLowerCase().startsWith(lang.toLowerCase()));
  if (!inLang.length) return null;
  const score = v => (/(premium|enhanced|natural|neural)/i.test(v.name) ? 4 : 0) +
    (/^(samantha|daniel|karen|moira|serena|ava|allison|susan|google uk english female)/i.test(v.name) ? 2 : 0) +
    (v.localService ? 1 : 0) + (v.default ? 0.5 : 0);
  return [...inLang].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Read a list of parts aloud: [{ text, onStart }]. Every utterance is queued
 * at once, inside the tap that started it — iOS speaks only what a user
 * gesture asked for, and a chain that queues the next sentence from the last
 * one's `end` can be refused. Returns { stop(), done } where done resolves
 * when the reading ends or is stopped.
 */
export function readAloud(parts, { synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance,
  voice = null, rate = 0.9 } = {}) {
  synth.cancel();
  let finish;
  const done = new Promise(r => { finish = r; });
  parts.forEach((part, i) => {
    const u = new Utterance(part.text);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = rate;                                  // a little slower: a child is listening
    u.onstart = () => part.onStart && part.onStart();
    if (i === parts.length - 1) { u.onend = () => finish("ended"); u.onerror = () => finish("error"); }
    synth.speak(u);
  });
  if (!parts.length) finish("ended");
  return { done, stop() { synth.cancel(); finish("stopped"); } };
}
