// Voices in the saved video. A page can't record the phone's own voices
// (speechSynthesis plays outside its audio), so when "Voices in the video" is
// on, the lines are spoken by Kokoro-82M (Apache-2.0, an AI model; the owner's
// call) run in this tab by kokoro-js (Apache-2.0, vendor/kokoro.web.js).
//
// What it fetches, all of it checked in the bundle: the model (92 MB, q8) and
// the voices from huggingface.co, and the ONNX runtime's wasm from
// cdn.jsdelivr.net (21.6 MB), about 115 MB in all. The text never leaves the tab: it is spoken here. The
// bundle has no POST, beacon or analytics address. Files land in the browser's
// Cache API ("transformers-cache", "kokoro-voices"), so it downloads once.
//
// Measured in Book before (docs/story-rules.md): slower than real time on one
// CPU core, because GitHub Pages can't be cross-origin isolated and the wasm
// gets one thread. Here that is fine: the voices are made once, before the
// video, and kept for the tab.

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let loading = null;

/** Load Kokoro once. onProgress(fraction 0..1, bytes so far, bytes in all). */
export function loadVoices(onProgress) {
  return loading ||= (async () => {
    const { KokoroTTS } = await import("../vendor/kokoro.web.js?v=1");
    const files = {};
    const load = () => KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "wasm", progress_callback: p => {
      if (p.status !== "progress" || !p.total) return;
      files[p.file] = [p.loaded, p.total];
      const [got, all] = Object.values(files).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
      onProgress?.(got / all, got, all);
    } });
    // One dropped request fails the whole load; the files that arrived are cached, so once more is cheap.
    try { return await load(); } catch { return await load(); }
  })().catch(e => { loading = null; throw e; });
}

/** One line in one voice: { samples: Float32Array, rate }. */
export async function speak(tts, text, voice) {
  const out = await tts.generate(String(text).slice(0, 500), { voice });
  return { samples: trim(out.audio, out.sampling_rate), rate: out.sampling_rate };
}

// Silence at the ends would hold the scene for nothing: keep 50 ms either side.
function trim(s, rate) {
  const loud = 0.01, pad = Math.round(rate * 0.05);
  let a = 0, b = s.length - 1;
  while (a < b && Math.abs(s[a]) < loud) a++;
  while (b > a && Math.abs(s[b]) < loud) b--;
  return s.slice(Math.max(0, a - pad), Math.min(s.length, b + pad + 1));
}
