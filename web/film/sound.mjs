// Film's sounds, made on the page: no files, no download, nothing recorded
// from anywhere. Each function schedules one sound on any AudioContext —
// an OfflineAudioContext for the video, the live one for Watch — so the
// preview and the file hear the same thing. Which sounds, and when, is
// decided by rule in film.mjs (soundCues, ambience); this file only makes them.

// A little randomness that is the same every time for the same film.
function rng(seed) {
  let a = Math.floor(seed * 1e4) >>> 0 || 1;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const noises = new WeakMap();
function noise(ctx) {
  if (!noises.has(ctx)) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0), r = rng(0.4242);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    noises.set(ctx, b);
  }
  return noises.get(ctx);
}
// Noise through a filter, shaped by an envelope: most of what follows.
function burst(ctx, dest, t, { type = "lowpass", freq = 800, q = 0.7, attack = 0.003, decay = 0.1, gain = 0.3, sweepTo = null, len = null }) {
  const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + (len || decay));
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + (len || decay));
  src.connect(f).connect(g).connect(dest);
  src.start(t, (t * 7.3) % 1.5); src.stop(t + attack + (len || decay) + 0.05);
}
function tone(ctx, dest, t, { freq = 440, to = null, type = "sine", attack = 0.005, decay = 0.2, gain = 0.2, hold = 0 }) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + hold + decay);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack);
  if (hold) g.gain.setValueAtTime(gain, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
  o.connect(g).connect(dest); o.start(t); o.stop(t + attack + hold + decay + 0.05);
}

/** One event: gunshot, punch, thud, clink, ring, door, step. */
export function cue(ctx, dest, t, kind, seed = t) {
  const r = rng(seed + 0.1);
  switch (kind) {
    case "gunshot":
      // Measured peaks keep every cue under full scale (a gunshot at 0.9 × 0.8 clipped at 1.25).
      burst(ctx, dest, t, { type: "highpass", freq: 300, attack: 0.001, decay: 0.18, gain: 0.55 });
      tone(ctx, dest, t, { freq: 110, to: 40, attack: 0.002, decay: 0.25, gain: 0.45 });
      burst(ctx, dest, t + 0.02, { type: "lowpass", freq: 900, attack: 0.02, decay: 0.9, gain: 0.18 });   // the room answering
      break;
    case "punch":
      tone(ctx, dest, t, { freq: 140, to: 55, attack: 0.002, decay: 0.12, gain: 0.7 });
      burst(ctx, dest, t, { type: "bandpass", freq: 1400, q: 0.8, attack: 0.001, decay: 0.07, gain: 0.45 });
      break;
    case "thud":
      tone(ctx, dest, t, { freq: 75, to: 38, attack: 0.004, decay: 0.3, gain: 0.7 });
      burst(ctx, dest, t, { type: "lowpass", freq: 380, attack: 0.004, decay: 0.22, gain: 0.35 });
      break;
    case "clink":
      tone(ctx, dest, t, { freq: 2900 + r() * 300, attack: 0.001, decay: 0.35, gain: 0.07 });
      tone(ctx, dest, t, { freq: 4200 + r() * 400, attack: 0.001, decay: 0.25, gain: 0.05 });
      break;
    case "ring":   // a phone: two short double-rings
      for (const at of [0, 0.6]) for (const f of [1300, 1600]) tone(ctx, dest, t + at, { freq: f, type: "square", attack: 0.01, hold: 0.35, decay: 0.03, gain: 0.07 });
      break;
    case "door":
      burst(ctx, dest, t, { type: "highpass", freq: 2500, attack: 0.001, decay: 0.02, gain: 0.2 });    // the latch
      tone(ctx, dest, t + 0.05, { freq: 95, to: 60, attack: 0.005, decay: 0.2, gain: 0.35 });
      break;
    case "step":
      burst(ctx, dest, t, { type: "lowpass", freq: 520 + r() * 200, attack: 0.002, decay: 0.07, gain: 0.5 + r() * 0.15 });
      break;
  }
}

/**
 * The sound of a place from `start` to `end`: a bar's murmur and glasses, a
 * street's traffic and passing cars, a park's wind and birds (crickets at
 * night). A room is quiet: no room tone (the owner heard the old one as a hum).
 * Returns a gain node; disconnecting it stops the sound (the live preview does).
 */
export function place(ctx, dest, kind, light, start, end) {
  const out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
  const night = light === "night", r = rng(start + kind.length);
  const bed = (type, freq, gain, lfo = 0.2) => {
    const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = gain;
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = lfo; lg.gain.value = gain * 0.5; l.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(out);
    g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(gain, start + 0.6);
    g.gain.setValueAtTime(gain, Math.max(start + 0.6, end - 0.5)); g.gain.linearRampToValueAtTime(0, end);
    src.start(start); src.stop(end + 0.1); l.start(start); l.stop(end + 0.1);
  };
  if (kind === "bar") {
    bed("bandpass", 450, 0.05, 0.37); bed("bandpass", 900, 0.03, 0.23);
    for (let t = start + 1 + r() * 2; t < end - 0.5; t += 2.5 + r() * 4) cue(ctx, out, t, "clink", t);
  } else if (kind === "street") {
    bed("lowpass", 260, night ? 0.05 : 0.09, 0.07);
    for (let t = start + 1.5 + r() * 3; t < end - 2; t += (night ? 12 : 6) + r() * 6) {
      burst(ctx, out, t, { type: "bandpass", freq: 300, sweepTo: 900, q: 0.9, attack: 1.2, len: 2.2, gain: night ? 0.06 : 0.11 });
    }
  } else if (kind === "park") {
    bed("bandpass", 600, 0.025, 0.11);
    if (night) for (let t = start + 0.5; t < end - 0.3; t += 0.9 + r() * 0.6)
      for (let k = 0; k < 3; k++) tone(ctx, out, t + k * 0.05, { freq: 4600, attack: 0.004, decay: 0.03, gain: 0.02 });
    else for (let t = start + 0.8 + r() * 2; t < end - 0.5; t += 1.8 + r() * 3.5) {
      const n = 2 + Math.floor(r() * 3), base = 2600 + r() * 1400;
      for (let k = 0; k < n; k++) tone(ctx, out, t + k * 0.13, { freq: base, to: base * 1.45, attack: 0.005, decay: 0.07, gain: 0.05 });
    }
  }
  return out;
}
