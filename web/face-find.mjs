// Finding a face, its hair and the person in a photo — in this tab, with
// nothing that phones home.
//
// The models are MediaPipe's (Apache-2.0): a face detector, the 478-point
// face landmark model, a hair segmenter and a person segmenter. They are only
// weights. MediaPipe's own JavaScript runtime was tried first and rejected:
// its bundle posts usage statistics to a Google endpoint from every task it
// creates (scripts/vendor-face.mjs names it). So the models run on LiteRT.js (Google's plain .tflite runtime,
// Apache-2.0, vendored in vendor/litert/ — it fetches only the files it is
// given), and the steps MediaPipe's graph did between the models are here:
// anchors, decoding, the rotated crop, and mapping points back.
//
// Everything runs on the CPU (WebAssembly): each model runs once per photo,
// so a GPU would gain little and would compete with anything else on it.

const BASE = new URL("./vendor/", import.meta.url).href;
let ready = null;

/** Load the runtime and the four models (about 13 MB, cached after the first time). */
export function loadFinder() {
  if (!ready) ready = (async () => {
    const L = await import("./vendor/litert/litert.mjs");
    await L.loadLiteRt(BASE + "litert/");
    const load = name => L.loadAndCompile(BASE + "models/" + name + ".tflite", { accelerator: "wasm" });
    const [detector, landmarks, hair, person] = await Promise.all(
      ["face_detector", "face_landmarks_detector", "hair_segmenter", "selfie_segmenter"].map(load));
    return { L, detector, landmarks, hair, person };
  })().catch(err => { ready = null; throw err; });
  return ready;
}

async function run(L, model, input, shape) {
  const t = new L.Tensor(input, shape);
  const outs = await model.run(t);
  t.delete();
  const arrays = outs.map(o => Float32Array.from(o.toTypedArray()));
  for (const o of outs) o.delete();
  return arrays;
}

// ---------------------------------------------------------------------------
// Pixels in: a square crop of the source, rotated and scaled, as NHWC floats.

/**
 * Sample a rotated square of the source (centre cx,cy, side, angle) into an
 * n×n float tensor. range: [lo, hi] for pixel values 0..255.
 */
function crop(source, { cx, cy, side, angle = 0 }, n, [lo, hi], channels = 3) {
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const k = n / side, cos = Math.cos(-angle), sin = Math.sin(-angle);
  const a = k * cos, b = k * sin, cc = -k * sin, d = k * cos;
  ctx.setTransform(a, b, cc, d, n / 2 - (a * cx + cc * cy), n / 2 - (b * cx + d * cy));
  ctx.drawImage(source, 0, 0);
  const px = ctx.getImageData(0, 0, n, n).data;
  const out = new Float32Array(n * n * channels);
  const scale = (hi - lo) / 255;
  for (let i = 0, j = 0; i < n * n; i++) {
    out[j++] = px[i * 4] * scale + lo; out[j++] = px[i * 4 + 1] * scale + lo; out[j++] = px[i * 4 + 2] * scale + lo;
    if (channels === 4) out[j++] = 0;   // the hair model's "previous mask": none, it is one photo
  }
  return out;
}
/** A crop box that holds the whole image, letterboxed (no stretching). */
const whole = (w, h) => ({ cx: w / 2, cy: h / 2, side: Math.max(w, h), angle: 0 });
/** From a point in an n×n crop back to the source image. */
function fromCrop([u, v], { cx, cy, side, angle = 0 }, n) {
  const x = (u / n - 0.5) * side, y = (v / n - 0.5) * side;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [cx + x * cos - y * sin, cy + x * sin + y * cos];
}

// ---------------------------------------------------------------------------
// The face detector (BlazeFace, short range): 896 anchors on a 128 grid.

let anchors = null;
function makeAnchors() {
  // MediaPipe's SSD anchor options for this model: strides 8,16,16,16, two
  // anchors per layer, fixed size — 16×16×2 + 8×8×6 = 896.
  const out = [];
  const strides = [8, 16, 16, 16];
  for (let i = 0; i < strides.length;) {
    let per = 0, j = i;
    while (j < strides.length && strides[j] === strides[i]) { per += 2; j++; }
    const fm = Math.ceil(128 / strides[i]);
    for (let y = 0; y < fm; y++) for (let x = 0; x < fm; x++)
      for (let a = 0; a < per; a++) out.push([(x + 0.5) / fm, (y + 0.5) / fm]);
    i = j;
  }
  return out;
}

async function detect(finder, source, w, h) {
  anchors ||= makeAnchors();
  const box = whole(w, h);
  const [reg, cls] = await run(finder.L, finder.detector, crop(source, box, 128, [-1, 1]), [1, 128, 128, 3]);
  const found = [];
  for (let i = 0; i < 896; i++) {
    const score = 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, cls[i]))));
    if (score < 0.5) continue;
    const r = reg.subarray(i * 16, i * 16 + 16), [ax, ay] = anchors[i];
    const cx = r[0] / 128 + ax, cy = r[1] / 128 + ay, bw = r[2] / 128, bh = r[3] / 128;
    const kp = [];
    for (let k = 0; k < 6; k++) kp.push(fromCrop([(r[4 + 2 * k] / 128 + ax) * 128, (r[5 + 2 * k] / 128 + ay) * 128], box, 128));
    const c = fromCrop([cx * 128, cy * 128], box, 128);
    found.push({ score, cx: c[0], cy: c[1], w: bw * box.side, h: bh * box.side, kp });
  }
  // Keep the best of each overlapping cluster.
  found.sort((a, b) => b.score - a.score);
  const iou = (a, b) => {
    const x1 = Math.max(a.cx - a.w / 2, b.cx - b.w / 2), x2 = Math.min(a.cx + a.w / 2, b.cx + b.w / 2);
    const y1 = Math.max(a.cy - a.h / 2, b.cy - b.h / 2), y2 = Math.min(a.cy + a.h / 2, b.cy + b.h / 2);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    return inter / (a.w * a.h + b.w * b.h - inter);
  };
  const kept = [];
  for (const f of found) if (!kept.some(k => iou(k, f) > 0.3)) kept.push(f);
  return kept;
}

// ---------------------------------------------------------------------------
// The landmark model: 478 points from an upright 256×256 crop of the face.

async function landmarksIn(finder, source, roi) {
  const [pts, presence] = await run(finder.L, finder.landmarks, crop(source, roi, 256, [0, 1]), [1, 256, 256, 3]);
  const out = [];
  for (let i = 0; i < 478; i++) out.push(fromCrop([pts[i * 3], pts[i * 3 + 1]], roi, 256));
  return { pts: out, presence: 1 / (1 + Math.exp(-presence[0])) };
}

/**
 * Every face in the photo, largest first: { pts: [[x,y] ×478], score }.
 * Two passes per face, as MediaPipe does between video frames: the first crop
 * comes from the detector's box and eyes, the second from the first pass's
 * own points, which is tighter and upright.
 */
export async function findFaces(finder, source, w, h) {
  const faces = [];
  for (const d of await detect(finder, source, w, h)) {
    const [re, le] = d.kp;
    let roi = { cx: d.cx, cy: d.cy, side: 1.5 * Math.max(d.w, d.h), angle: Math.atan2(le[1] - re[1], le[0] - re[0]) };
    let got = await landmarksIn(finder, source, roi);
    const xs = got.pts.map(p => p[0]), ys = got.pts.map(p => p[1]);
    const a = got.pts[33], b = got.pts[263];
    roi = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2,
      side: 1.5 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
      angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    got = await landmarksIn(finder, source, roi);
    if (got.presence < 0.5) continue;
    faces.push({ pts: got.pts, score: d.score, size: roi.side });
  }
  return faces.sort((a, b) => b.size - a.size);
}

/** Map a model's square mask back onto the w×h image, pixel by pixel. */
function toImage(mask, n, w, h, pick) {
  const box = whole(w, h), out = new Float32Array(w * h), k = n / box.side;
  const ox = n / 2 - k * box.cx, oy = n / 2 - k * box.cy;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = Math.min(n - 1, Math.max(0, Math.floor(x * k + ox))), v = Math.min(n - 1, Math.max(0, Math.floor(y * k + oy)));
    out[y * w + x] = pick(v * n + u);
  }
  return out;
}

/** Hair: 1 where the hair model says hair, else 0 (w×h). */
export async function findHair(finder, source, w, h) {
  const [logits] = await run(finder.L, finder.hair, crop(source, whole(w, h), 512, [0, 1], 4), [1, 512, 512, 4]);
  const m = toImage(logits, 512, w, h, i => logits[i * 2 + 1] > logits[i * 2] ? 1 : 0);
  return Uint8Array.from(m);
}

/** Person: probability 0..1 that each pixel is the person (w×h). */
export async function findPerson(finder, source, w, h) {
  const [p] = await run(finder.L, finder.person, crop(source, whole(w, h), 256, [0, 1]), [1, 256, 256, 3]);
  return toImage(p, 256, w, h, i => p[i]);
}
