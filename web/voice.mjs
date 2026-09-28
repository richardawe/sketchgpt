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

// How much nicer a voice is likely to sound: the device's own enhanced or
// natural voices first, then the well-known good ones, then any local voice.
// Local voices work offline; network voices (some of Chrome's) do not.
const score = v => (/(premium|enhanced|natural|neural)/i.test(v.name) ? 4 : 0) +
  (/^(samantha|daniel|karen|moira|serena|ava|allison|susan|google uk english female)/i.test(v.name) ? 2 : 0) +
  (v.localService ? 1 : 0) + (v.default ? 0.5 : 0);
const speaks = (v, lang) => (v.lang || "").toLowerCase().startsWith(lang.toLowerCase());

/** The nicest voice on offer for a language, or null. */
export function pickVoice(voices, lang = "en") {
  return voices.filter(v => speaks(v, lang)).sort((a, b) => score(b) - score(a))[0] || null;
}

/**
 * The device's voices, for a picker: the reader's language first, then other
 * English, then the rest; the nicer-sounding first within each. Voices that
 * need the network say so, because they fail offline.
 */
export function voiceOptions(voices, lang = "en") {
  const group = v => speaks(v, lang) ? 0 : speaks(v, "en") ? 1 : 2;
  return [...voices].sort((a, b) => group(a) - group(b) || score(b) - score(a) || a.name.localeCompare(b.name))
    .map(v => ({ voice: v, id: v.voiceURI || v.name,
      label: `${v.name} · ${v.lang}${v.localService === false ? " · online" : ""}` }));
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
