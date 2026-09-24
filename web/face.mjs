// Selfie mode: a person drawn as a hand-drawn caricature, from their own photo,
// on their own device. docs/selfie.md is the plan and the reasons.
//
// MediaPipe measures (478 face points, a hair mask); everything here is the
// page's: the caricature, the colours, the ink and the animation. No model
// draws anything. These functions are pure where they can be — they take
// points, pixels and numbers and return points, numbers and SVG text — so
// tests/face.test.mjs checks them without a browser. The few that touch the
// DOM (setPose, the live loop) are at the bottom.
//
// Face space: the two eye centres sit at (-0.5, 0) and (0.5, 0), y points
// down. Photo size, distance from the camera and head tilt drop out.
import rough from "./rough.mjs";
import { MEAN_FACE } from "./face-mean.mjs";

// ---------------------------------------------------------------------------
// MediaPipe face-mesh indices. "Right" is the person's right: image-left in a
// photo that is not mirrored.
export const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export const EYE = {
  right: { upper: [33, 246, 161, 160, 159, 158, 157, 173, 133], lower: [33, 7, 163, 144, 145, 153, 154, 155, 133],
    iris: [468, 469, 470, 471, 472] },
  left: { upper: [263, 466, 388, 387, 386, 385, 384, 398, 362], lower: [263, 249, 390, 373, 374, 380, 381, 382, 362],
    iris: [473, 474, 475, 476, 477] },
};
export const BROW = {
  right: { upper: [70, 63, 105, 66, 107], lower: [46, 53, 52, 65, 55] },   // outer -> inner
  left: { upper: [300, 293, 334, 296, 336], lower: [276, 283, 282, 295, 285] },
};
export const LIPS = {
  outerUpper: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
  outerLower: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  innerUpper: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
  innerLower: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
};
export const NOSE = {
  wings: [[129, 64, 98, 97, 2], [2, 326, 327, 294, 358]],
  bridge: [168, 6, 197, 195, 5, 4],
  tip: 4,
  all: [129, 64, 98, 97, 2, 326, 327, 294, 358, 168, 6, 197, 195, 5, 4, 1, 19, 94],
};
const CHEEKS = [50, 280, 101, 330, 205, 425, 187, 411];
const uniq = a => [...new Set(a)];
const EYE_ALL = side => uniq([...EYE[side].upper, ...EYE[side].lower]);
const BROW_ALL = side => [...BROW[side].upper, ...BROW[side].lower];
const LIPS_ALL = uniq(Object.values(LIPS).flat());

// ---------------------------------------------------------------------------
// Small geometry
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = a => Math.hypot(a[0], a[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const centroid = pts => mul(pts.reduce(add, [0, 0]), 1 / pts.length);
const capLen = (v, max) => { const l = len(v); return l > max ? mul(v, max / l) : v; };
const pick = (pts, idx) => idx.map(i => pts[i]);

export function insidePolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A small, seeded random source, so a drawing is the same every time. */
export function rng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => ((s = Math.imul(48271, s) & 0x7fffffff) / 0x7fffffff);
}

// ---------------------------------------------------------------------------
// Alignment

/**
 * Rotate, scale and move points (pixels, 468 or 478 of them) into face space.
 * Returns the points and the two maps between the spaces.
 */
export function alignFace(pts) {
  const r = centroid(pick(pts, EYE_ALL("right"))), l = centroid(pick(pts, EYE_ALL("left")));
  const d = sub(l, r), angle = Math.atan2(d[1], d[0]), scale = 1 / len(d), mid = lerp(r, l, 0.5);
  const c = Math.cos(-angle), s = Math.sin(-angle);
  const toFace = p => { const q = sub(p, mid); return [(q[0] * c - q[1] * s) * scale, (q[0] * s + q[1] * c) * scale]; };
  const ci = Math.cos(angle), si = Math.sin(angle);
  const toImage = ([x, y]) => [mid[0] + (x * ci - y * si) / scale, mid[1] + (x * si + y * ci) / scale];
  return { pts: pts.map(toFace), toFace, toImage, eyeDistancePx: len(d), rollDeg: angle * 180 / Math.PI };
}

let meanPts = null;
/** MediaPipe's canonical (average) face, in face space. */
export function meanFace() {
  if (!meanPts) {
    meanPts = [];
    for (let i = 0; i < MEAN_FACE.length; i += 2) meanPts.push([MEAN_FACE[i], MEAN_FACE[i + 1]]);
  }
  return meanPts;
}

const width = (pts, a, b) => len(sub(pts[a], pts[b]));
/** The few measurements the caricature works with. */
export function measure(pts) {
  return {
    eyeWidth: { right: width(pts, 33, 133), left: width(pts, 263, 362) },
    mouthWidth: width(pts, 61, 291),
    // The two things the caricature must never change, measured so tests can
    // hold it to that.
    noseWidth: width(pts, 98, 327),
    lipHeight: len(sub(pts[0], pts[17])),
    faceWidth: width(pts, 234, 454),
    faceLength: len(sub(pts[10], pts[152])),
    // Turned head: the nose tip leaves the middle of the eyes.
    yaw: pts[4][0],
  };
}

// ---------------------------------------------------------------------------
// The caricature, and what it may and may not exaggerate (docs/selfie.md §3).
//
// Exaggerated: head shape (the oval), the eyes' size, the brows' height and
// arch, where the nose and mouth sit, and the mouth's width.
// Drawn true, never exaggerated: nose width, lip fullness, the shape of the
// eyes (they are scaled, never reshaped — no fold is added or removed) and
// skin tone. Exaggerating every difference from one average face would push
// the features that differ most between ethnic groups hardest, which is how a
// caricature becomes a racist one.

/** amount: the person's slider, 0 (a straight portrait) to 2. */
export function caricature(pts, amount = 1, mean = meanFace()) {
  // A turned head is not a frontal face with odd proportions: comparing it to
  // the average face would read the turn as features, so it gets less.
  const turn = clamp(1 - Math.abs(pts[4][0]) / 0.35, 0.3, 1);
  const k = clamp(amount, 0, 2) * 0.45 * turn;
  const out = pts.map(p => [p[0], p[1]]);
  if (!mean.length || k === 0) return out;
  const move = (idx, f) => { for (const i of idx) out[i] = f(out[i], i); };

  for (const i of OVAL) out[i] = add(pts[i], mul(capLen(sub(pts[i], mean[i]), 0.35), k));

  for (const side of ["right", "left"]) {
    const idx = [...EYE_ALL(side), ...EYE[side].iris].filter(i => i < pts.length);
    const c = centroid(pick(pts, EYE_ALL(side)));
    const [a, b] = side === "right" ? [33, 133] : [263, 362];
    const s = clamp(Math.pow(width(pts, a, b) / width(mean, a, b), k * 1.6), 0.8, 1.3);
    move(idx, p => add(c, mul(sub(p, c), s)));

    const bu = BROW[side].upper, bl = BROW[side].lower;
    const shift = capLen(sub(centroid(pick(pts, bu)), centroid(pick(mean, bu))), 0.2);
    const [o, n] = [pts[bu[0]], pts[bu[bu.length - 1]]];
    bu.forEach((u, j) => {
      const t = j / (bu.length - 1), base = lerp(o, n, t)[1];
      const lift = (pts[u][1] - base) * 0.6 * k;
      out[u] = add(pts[u], [0, lift + shift[1] * k]);
      out[bl[j]] = add(pts[bl[j]], [0, lift + shift[1] * k]);
    });
  }

  const noseShift = capLen(sub(pts[NOSE.tip], mean[NOSE.tip]), 0.15);
  move(NOSE.all, p => add(p, [0, noseShift[1] * k]));

  const mc = centroid(pick(pts, LIPS_ALL)), mm = centroid(pick(mean, LIPS_ALL));
  const mouthShift = capLen(sub(mc, mm), 0.15);
  const sx = clamp(Math.pow(width(pts, 61, 291) / width(mean, 61, 291), k * 1.4), 0.85, 1.2);
  move(LIPS_ALL, p => [mc[0] + (p[0] - mc[0]) * sx, p[1] + mouthShift[1] * k]);

  // The chin must stay below the mouth whatever the two moves did.
  const lipBottom = Math.max(...pick(out, LIPS.outerLower).map(p => p[1]));
  const chin = out[152][1];
  const need = lipBottom + 0.28 - chin;
  if (need > 0) for (const i of OVAL) if (out[i][1] > lipBottom - 0.1) out[i] = add(out[i], [0, need]);
  return out;
}

// ---------------------------------------------------------------------------
// Colour. Skin keeps its lightness exactly; only hue and chroma are held to a
// believable range, so a cold or green-cast photo does not give someone grey
// or green skin. Never lighten or darken a person.

const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const fromLin = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export function rgbToLab([r, g, b]) {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B),
    z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function labToRgb([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = t => t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z]
    .map(v => clamp(Math.round(fromLin(clamp(v, 0, 1))), 0, 255));
}
export const hex = rgb => "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("");
export const unhex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

/** Per-channel median of [r,g,b] samples. */
export function medianColour(samples) {
  if (!samples.length) return null;
  const med = k => { const v = samples.map(s => s[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  return [med(0), med(1), med(2)];
}

/** The most common colour (coarse bins), for clothes: the fabric, not the zip. */
export function dominantColour(samples) {
  if (!samples.length) return null;
  const bins = new Map();
  for (const s of samples) { const k = (s[0] >> 5) * 64 + (s[1] >> 5) * 8 + (s[2] >> 5); bins.set(k, (bins.get(k) || 0) + 1); }
  const top = [...bins].sort((a, b) => b[1] - a[1])[0][0];
  return medianColour(samples.filter(s => (s[0] >> 5) * 64 + (s[1] >> 5) * 8 + (s[2] >> 5) === top));
}

/** Skin as drawn: the photo's own lightness, hue held between 20° and 80°. */
export function skinTone(rgb) {
  const [L, a, b] = rgbToLab(rgb);
  let C = Math.hypot(a, b), h = Math.atan2(b, a) * 180 / Math.PI;
  h = clamp(h, 20, 80);
  C = clamp(C, 8, 38);
  return hex(labToRgb([L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180)]));
}
/** A colour with its lightness moved by dL (for shadows and hair strokes). */
export function shade(h, dL) {
  const [L, a, b] = rgbToLab(unhex(h));
  return hex(labToRgb([clamp(L + dL, 0, 100), a, b]));
}
export const lightness = h => rgbToLab(unhex(h))[0];

// ---------------------------------------------------------------------------
// Masks to outlines (marching squares), and the hair's own strokes.

/**
 * Closed outlines of a binary mask (1 = inside), in mask pixel units, largest
 * first. Loops smaller than minArea are dropped.
 */
export function outlines(mask, w, h, minArea = 20) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]) ? 1 : 0;
  const next = new Map();
  const key = p => p[0] + "," + p[1];
  const seg = (a, b) => next.set(key(a), b);
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const c = at(x, y) * 8 + at(x + 1, y) * 4 + at(x + 1, y + 1) * 2 + at(x, y + 1);
    if (c === 0 || c === 15) continue;
    // Corners are pixel centres (x,y)..(x+1,y+1); vertices sit on the edges' midpoints.
    const T = [x + 0.5, y], R = [x + 1, y + 0.5], B = [x + 0.5, y + 1], L = [x, y + 0.5];
    // Each edge keeps "inside" on its right, so every loop runs the same way.
    switch (c) {
      case 1: seg(B, L); break; case 2: seg(R, B); break; case 3: seg(R, L); break;
      case 4: seg(T, R); break; case 5: seg(T, L); seg(B, R); break; case 6: seg(T, B); break;
      case 7: seg(T, L); break; case 8: seg(L, T); break; case 9: seg(B, T); break;
      case 10: seg(L, B); seg(R, T); break; case 11: seg(R, T); break; case 12: seg(L, R); break;
      case 13: seg(B, R); break; case 14: seg(L, B); break;
    }
  }
  const loops = [];
  const seen = new Set();
  for (const [k0, first] of next) {
    if (seen.has(k0)) continue;
    const loop = [];
    let k = k0, p = first;
    while (p && !seen.has(k)) { seen.add(k); loop.push(p); k = key(p); p = next.get(k); }
    if (loop.length > 3) loops.push(loop);
  }
  const area = l => Math.abs(l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  return loops.map(l => ({ l, a: area(l) })).filter(o => o.a >= minArea).sort((a, b) => b.a - a.a).map(o => o.l);
}

/** Ramer–Douglas–Peucker, then one pass of Chaikin smoothing on a closed loop. */
export function simplify(loop, tol = 0.8) {
  const rdp = (pts, lo, hi, keep) => {
    let best = 0, at = -1;
    const [a, b] = [pts[lo], pts[hi]], ab = sub(b, a), L = len(ab) || 1;
    for (let i = lo + 1; i < hi; i++) {
      const d = Math.abs(ab[0] * (a[1] - pts[i][1]) - ab[1] * (a[0] - pts[i][0])) / L;
      if (d > best) { best = d; at = i; }
    }
    if (best > tol) { rdp(pts, lo, at, keep); keep.push(pts[at]); rdp(pts, at, hi, keep); }
  };
  if (loop.length < 8) return loop;
  const half = loop.length >> 1, out = [loop[0]];
  rdp(loop, 0, half, out); out.push(loop[half]);
  rdp([...loop, loop[0]], half, loop.length, out);
  const sm = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i], q = out[(i + 1) % out.length];
    sm.push(lerp(p, q, 0.25), lerp(p, q, 0.75));
  }
  return sm;
}

/**
 * Strokes that follow the hair, traced along the photo's own texture.
 * gray: luminance 0..1 (w*h), mask: 1 where hair. Returns polylines in pixels.
 * The strand direction is the minor axis of the smoothed structure tensor.
 */
export function hairStrokes(gray, mask, w, h, { max = 110, seed = 7 } = {}) {
  const J11 = new Float32Array(w * h), J12 = new Float32Array(w * h), J22 = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, gx = gray[i + 1] - gray[i - 1], gy = gray[i + w] - gray[i - w];
    J11[i] = gx * gx; J12[i] = gx * gy; J22[i] = gy * gy;
  }
  const r = Math.max(2, Math.round(w / 90));
  for (const J of [J11, J12, J22]) boxBlur(J, w, h, r), boxBlur(J, w, h, r);
  const dir = (x, y) => {
    const i = (y | 0) * w + (x | 0);
    const phi = 0.5 * Math.atan2(2 * J12[i], J11[i] - J22[i]) + Math.PI / 2;
    return [Math.cos(phi), Math.sin(phi)];
  };
  const inHair = (x, y) => x >= 1 && y >= 1 && x < w - 1 && y < h - 1 && mask[(y | 0) * w + (x | 0)];
  const cell = Math.max(3, w / 60), cw = Math.ceil(w / cell), used = new Uint8Array(cw * Math.ceil(h / cell));
  const cellOf = (x, y) => ((y / cell) | 0) * cw + ((x / cell) | 0);
  const rand = rng(seed), seeds = [], gap = Math.max(4, w / 32);
  for (let y = gap / 2; y < h; y += gap) for (let x = gap / 2; x < w; x += gap) {
    const sx = x + (rand() - 0.5) * gap, sy = y + (rand() - 0.5) * gap;
    if (inHair(sx, sy)) seeds.push([sx, sy, rand()]);
  }
  seeds.sort((a, b) => a[2] - b[2]);
  const step = Math.max(1, w / 250), maxSteps = Math.round(w / 6 / step), strokes = [];
  for (const [sx, sy] of seeds) {
    if (strokes.length >= max) break;
    if (used[cellOf(sx, sy)]) continue;
    const trace = sign => {
      const pts = [];
      let x = sx, y = sy, [dx, dy] = dir(sx, sy);
      dx *= sign; dy *= sign;
      for (let s = 0; s < maxSteps; s++) {
        let [nx, ny] = dir(x, y);
        if (nx * dx + ny * dy < 0) { nx = -nx; ny = -ny; }
        dx = 0.7 * dx + 0.3 * nx; dy = 0.7 * dy + 0.3 * ny;
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        x += dx * step; y += dy * step;
        if (!inHair(x, y)) break;
        const c = cellOf(x, y);
        if (used[c] === 2) break;
        pts.push([x, y]);
      }
      return pts;
    };
    const line = [...trace(-1).reverse(), [sx, sy], ...trace(1)];
    if (line.length * step < w / 30) continue;
    for (const [x, y] of line) used[cellOf(x, y)] = 2;
    const thin = line.filter((_, i) => i % 3 === 0 || i === line.length - 1);
    strokes.push(thin);
  }
  return strokes;
}
function boxBlur(a, w, h, r) {
  const tmp = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[y * w + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / (2 * r + 1);
      s += a[y * w + clamp(x + r + 1, 0, w - 1)] - a[y * w + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      a[y * w + x] = s / (2 * r + 1);
      s += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
}

/**
 * Where the face is in shadow, as cells for hatching: [x, y, level] in face
 * space. Levels are relative to the face's own median brightness, so a dark
 * face is not hatched all over and a light one is not left bare.
 */
export function shadeCells(pts, lum, { isHair = () => false, step = 0.13 } = {}) {
  const oval = pick(pts, OVAL);
  const keepOut = [
    ...["right", "left"].map(s => grow(pick(pts, [...EYE[s].upper, ...EYE[s].lower.slice().reverse()]), 1.7)),
    ...["right", "left"].map(s => grow(pick(pts, [...BROW[s].upper, ...BROW[s].lower.slice().reverse()]), 1.4)),
    grow(pick(pts, [...LIPS.outerUpper, ...LIPS.outerLower.slice().reverse()]), 1.3),
  ];
  const xs = oval.map(p => p[0]), ys = oval.map(p => p[1]);
  const cells = [];
  for (let y = Math.min(...ys); y < Math.max(...ys); y += step)
    for (let x = Math.min(...xs); x < Math.max(...xs); x += step) {
      const c = [x + step / 2, y + step / 2];
      if (!insidePolygon(c, grow(oval, 0.93)) || keepOut.some(k => insidePolygon(c, k)) || isHair(c)) continue;
      const l = lum(c);
      if (l != null) cells.push([c[0], c[1], l]);
    }
  if (!cells.length) return [];
  const sorted = cells.map(c => c[2]).sort((a, b) => a - b), med = sorted[sorted.length >> 1];
  const lvl = l => { const rel = (l - med) / Math.max(med, 0.15); return rel < -0.24 ? 2 : rel < -0.12 ? 1 : 0; };
  return cells.map(([x, y, l]) => [+x.toFixed(3), +y.toFixed(3), lvl(l)]).filter(c => c[2] > 0);
}
function grow(poly, s) { const c = centroid(poly); return poly.map(p => add(c, mul(sub(p, c), s))); }

// ---------------------------------------------------------------------------
// Drawing. The portrait is SVG text: rough.js ink over watercolour washes.

export const INK = "#2a211c";
const PAPER = "#fbf8f2";
const W = 400, H = 480;

const f1 = v => +v.toFixed(1);
/** A smooth closed (or open) Catmull-Rom path through points. */
export function smoothPath(pts, closed = true) {
  const n = pts.length;
  if (n < 3) return "";
  const P = i => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d + (closed ? " Z" : "");
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * Draw a portrait from its data (see makeData in selfie.html's module; it is
 * everything the page kept — never the photo). Returns SVG text whose moving
 * parts are groups with data-part and data-state, for setPose().
 */
export function renderPortrait(data, { amount = 1, seed = 1, credit = true } = {}) {
  const gen = rough.generator();
  const rand = rng(seed * 7919 + 13);
  const P = caricature(data.pts, amount);
  const hairGrow = 1 + 0.08 * clamp(amount, 0, 2);
  const crown = centroid(pick(P, OVAL));
  const growHair = p => add(crown, mul(sub(p, crown), hairGrow));
  const hair = (data.hair || []).map(l => l.map(growHair));
  const fringe = (data.fringe || []).map(l => l.map(growHair));
  const strokes = (data.strokes || []).map(l => l.map(growHair));

  // Fit the head (hair and oval) into the top of the frame; the body hangs below.
  const headPts = [...pick(P, OVAL), ...hair.flat()];
  const minX = Math.min(...headPts.map(p => p[0])), maxX = Math.max(...headPts.map(p => p[0]));
  const minY = Math.min(...headPts.map(p => p[1])), chinY = P[152][1];
  const S = Math.min(330 / (chinY - minY), 330 / (maxX - minX), 95);
  const ox = W / 2 - S * (minX + maxX) / 2, oy = 24 - S * minY;
  const T = ([x, y]) => [ox + S * x, oy + S * y];
  const TT = pts => pts.map(T);

  const skin = data.colours.skin, hairC = data.colours.hair, lip = data.colours.lip;
  const cloth = data.colours.cloth, iris = data.colours.iris, brow = data.colours.brow || shade(hairC, -8);
  const skinShadow = shade(skin, -12);
  const hairDark = lightness(hairC) < 28;
  const hairInk = hairDark ? shade(hairC, 16) : shade(hairC, -22);

  let n = 0;
  const sd = () => (seed * 101 + (n++) * 7) % 2147483647 || 1;
  const ink = (d, o = {}) => gen.toPaths(d).map(p =>
    `<path d="${p.d}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}"${o.op ? ` opacity="${o.op}"` : ""} stroke-linecap="round"/>`).join("");
  const curve = (pts, o = {}) => ink(gen.curve(TT(pts), { stroke: o.stroke || INK, strokeWidth: o.w || 1.4,
    roughness: o.r ?? 0.7, bowing: 0.6, seed: sd(), disableMultiStroke: !!o.single }), o);
  const wash = (d, fill, o = {}) => `<path d="${d}" fill="${fill}"${o.op ? ` opacity="${o.op}"` : ""} filter="url(#wash)"/>`;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-portrait="1" data-scale="${f1(S)}">`);
  out.push(`<defs><filter id="wash" x="-5%" y="-5%" width="110%" height="110%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed % 97}"/>` +
    `<feDisplacementMap in="SourceGraphic" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`);

  // --- body: neck and shoulders, small under a big head, as caricatures go
  const jawL = P[OVAL[25]], jawR = P[OVAL[11]];
  const neckW = Math.abs(jawR[0] - jawL[0]) * 0.3, cx = P[152][0];
  const neckTop = chinY - 0.35, shoulderY = chinY + 0.55, bottom = (H - oy) / S;
  const neck = [[cx - neckW, neckTop], [cx + neckW, neckTop], [cx + neckW * 1.05, shoulderY + 0.1], [cx - neckW * 1.05, shoulderY + 0.1]];
  const sw = Math.max(1.55, (maxX - minX) * 0.62);
  const body = [[cx - neckW * 1.1, shoulderY - 0.02], [cx - sw * 0.55, shoulderY + 0.08], [cx - sw * 0.92, shoulderY + 0.35],
    [cx - sw, bottom + 0.2], [cx + sw, bottom + 0.2], [cx + sw * 0.92, shoulderY + 0.35], [cx + sw * 0.55, shoulderY + 0.08],
    [cx + neckW * 1.1, shoulderY - 0.02]];
  out.push(`<g data-part="body">`);
  out.push(wash(smoothPath(TT(neck)), skin));
  out.push(wash(smoothPath(TT([[cx - neckW, chinY - 0.05], [cx, chinY + 0.08], [cx + neckW, chinY - 0.05], [cx, chinY + 0.22]])), skinShadow, { op: 0.45 }));
  out.push(curve([[cx - neckW, neckTop + 0.1], [cx - neckW * 1.02, shoulderY - 0.1], [cx - neckW * 1.08, shoulderY]], { w: 1.2 }));
  out.push(curve([[cx + neckW, neckTop + 0.1], [cx + neckW * 1.02, shoulderY - 0.1], [cx + neckW * 1.08, shoulderY]], { w: 1.2 }));
  out.push(wash(smoothPath(TT(body)), cloth));
  out.push(curve(body.slice(0, 4), { w: 1.6 }));
  out.push(curve(body.slice(4), { w: 1.6 }));
  out.push(curve([[cx - neckW * 1.25, shoulderY - 0.03], [cx, shoulderY + 0.2], [cx + neckW * 1.25, shoulderY - 0.03]], { w: 1.3 }));
  out.push(`</g>`);

  // --- head
  const pivot = T(P[152]);
  out.push(`<g data-part="head" data-pivot="${f1(pivot[0])} ${f1(pivot[1])}">`);
  for (const l of hair) out.push(wash(smoothPath(TT(l)), hairC));

  // ears, where the hair does not cover them
  for (const [side, i, sign] of [["right", 234, -1], ["left", 454, 1]]) {
    if (data.ears && data.ears[side] === false) continue;
    const e = P[i], top = add(e, [0, -0.2]), bot = add(e, [sign * -0.02, 0.62]);
    const ear = [top, add(e, [sign * 0.2, -0.12]), add(e, [sign * 0.26, 0.2]), add(e, [sign * 0.14, 0.5]), bot, add(e, [sign * -0.06, 0.2])];
    out.push(wash(smoothPath(TT(ear)), skin));
    out.push(curve(ear.slice(0, 5), { w: 1.3 }));
    out.push(curve([add(e, [sign * 0.08, 0]), add(e, [sign * 0.16, 0.12]), add(e, [sign * 0.1, 0.35])], { w: 0.9, op: 0.7 }));
  }

  const oval = pick(P, OVAL);
  // Skin between the brows' line and the hair (forehead, a bald crown): the
  // face points stop below the hairline and would leave paper there.
  const skinTop = (data.skinTop || []).map(l => l.map(growHair));
  for (const l of skinTop) out.push(wash(smoothPath(TT(l)), skin));
  if (!hair.length) for (const l of skinTop) out.push(curve(l.concat([l[0]]).filter((_, i) => i % 2 === 0), { w: 1.4 }));
  out.push(`<clipPath id="faceclip-${seed}"><path d="${smoothPath(TT(oval))}"/></clipPath>`);
  out.push(wash(smoothPath(TT(oval)), skin));
  // The jaw is inked; the forehead is left soft (hair usually meets it).
  const jaw = [...OVAL.slice(5, 32)].map(i => P[i]);
  out.push(curve(jaw, { w: 1.7 }));

  // shading: hatching where the photo was darker than the face's middle
  // Hatching by hand is loose: strokes wander off the grid, vary in length
  // and angle, and a second direction only where it is darkest.
  const hatch = [];
  for (const [x0, y0, level] of data.shade || []) {
    for (let k = 0; k < level + 1; k++) {
      const x = x0 + (rand() - 0.5) * 0.11, y = y0 + (rand() - 0.5) * 0.11;
      const a = (k < 2 ? -0.8 : 0.75) + (rand() - 0.5) * 0.35, l = 0.035 + rand() * 0.04;
      if (level < 2 && k > 0 && rand() < 0.5) continue;
      hatch.push([[x - Math.cos(a) * l, y - Math.sin(a) * l], [x + Math.cos(a) * l, y + Math.sin(a) * l]]);
    }
  }
  if (hatch.length) out.push(`<g data-part="shade" opacity="0.5" clip-path="url(#faceclip-${seed})">` + hatch.map(([a, b]) => {
    const [A, B] = [T(a), T(b)];
    return `<path d="M${f1(A[0])} ${f1(A[1])} L${f1(B[0])} ${f1(B[1])}" stroke="${shade(skin, -26)}" stroke-width="0.9" stroke-linecap="round"/>`;
  }).join("") + `</g>`);

  // cheeks: a faint warm wash
  for (const i of [205, 425]) if (P[i]) {
    const c = T(P[i]);
    out.push(`<ellipse cx="${f1(c[0])}" cy="${f1(c[1])}" rx="${f1(0.2 * S)}" ry="${f1(0.13 * S)}" fill="${shade(lip, 6)}" opacity="0.18" clip-path="url(#faceclip-${seed})"/>`);
  }

  // nose: the wings and a shadow down one side — how illustrators draw noses
  for (const wing of NOSE.wings) out.push(curve(pick(P, wing), { w: 1.3 }));
  const lightFromRight = (data.light ?? 1) > 0;
  const side = lightFromRight ? -1 : 1;
  const bridge = pick(P, NOSE.bridge).slice(2).map((p, i, a) => add(p, [side * 0.12 * (1 - i / a.length * 0.3), 0]));
  out.push(curve(bridge, { w: 1, op: 0.55, single: true }));

  // eyes: three openings, drawn once each; the live loop and the GIF switch
  for (const sideName of ["right", "left"]) {
    const E = EYE[sideName];
    const up = pick(P, E.upper), lo = pick(P, E.lower);
    const ic = P[E.iris[0]] || centroid(up.concat(lo));
    const ir = P[E.iris[1]] ? Math.max(...E.iris.slice(1).map(i => len(sub(P[i], ic)))) : 0.17;
    out.push(`<g data-part="eye-${sideName}">`);
    for (const [state, t] of [["open", 1], ["half", 0.45], ["closed", 0.02]]) {
      const upT = up.map((p, i) => lerp(lo[i], p, t));
      const poly = [...upT, ...lo.slice(1, -1).reverse()];
      const id = `clip-${sideName}-${state}-${seed}`;
      out.push(`<g data-state="${state}"${state === "open" ? "" : ' style="display:none"'}>`);
      if (t > 0.1) {
        out.push(`<clipPath id="${id}"><path d="${smoothPath(TT(poly))}"/></clipPath>`);
        out.push(`<path d="${smoothPath(TT(poly))}" fill="#f6f1e8"/>`);
        const c = T(ic);
        out.push(`<g clip-path="url(#${id})"><g class="iris">` +
          `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="${f1(ir * S)}" fill="${iris}"/>` +
          `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="${f1(ir * S)}" fill="none" stroke="${INK}" stroke-width="0.8" opacity="0.6"/>` +
          `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="${f1(ir * S * 0.45)}" fill="#15100d"/>` +
          `<circle cx="${f1(c[0] + ir * S * 0.35)}" cy="${f1(c[1] - ir * S * 0.35)}" r="${f1(Math.max(1.2, ir * S * 0.18))}" fill="#fff"/>` +
          `</g></g>`);
      }
      out.push(curve(upT, { w: 2.3, r: 0.5 }));
      const outer = upT[0], lash = add(outer, [(sideName === "right" ? -1 : 1) * 0.07, -0.04]);
      out.push(curve([upT[1], outer, lash], { w: 1.6, r: 0.4, single: true }));
      if (t > 0.1) out.push(curve(lo.slice(2, 8), { w: 0.9, op: 0.65, single: true }));
      out.push(`</g>`);
    }
    out.push(`</g>`);
  }

  // brows: short hair strokes along the brow, two heights
  for (const sideName of ["right", "left"]) {
    const B = BROW[sideName], up = pick(P, B.upper), lo = pick(P, B.lower);
    const along = (arr, t) => { const f = t * (arr.length - 1), i = Math.min(Math.floor(f), arr.length - 2); return lerp(arr[i], arr[i + 1], f - i); };
    const outward = sideName === "right" ? -1 : 1;
    let lines = "";
    const rb = rng(seed + (sideName === "right" ? 3 : 5));
    for (let j = 0; j < 26; j++) {
      const t = (j + rb() * 0.8) / 26, a = along(lo, t), b = along(up, t);
      const base = lerp(a, b, 0.15 + rb() * 0.5), v = sub(b, a), l = len(v) || 0.05;
      // Brow hairs lean outward, more at the inner end.
      const rot = outward * (0.35 + 0.6 * t), ux = v[0] / l, uy = v[1] / l;
      const dir = [ux * Math.cos(rot) - uy * Math.sin(rot), ux * Math.sin(rot) + uy * Math.cos(rot)];
      const tip = add(base, mul(dir, l * (0.8 + rb() * 0.5)));
      const [A, C] = [T(base), T(tip)];
      lines += `<path d="M${f1(A[0])} ${f1(A[1])} L${f1(C[0])} ${f1(C[1])}" stroke="${brow}" stroke-width="${f1(1 + rb() * 0.6)}" stroke-linecap="round"/>`;
    }
    out.push(`<g data-part="brow-${sideName}">` +
      `<g data-state="rest">${lines}</g>` +
      `<g data-state="up" style="display:none" transform="translate(0 ${f1(-0.08 * S)})">${lines}</g></g>`);
  }

  // mouth: rest, smile and three open shapes, all from the person's own lips
  const mouthStates = mouthShapes(P);
  out.push(`<g data-part="mouth">`);
  for (const [state, m] of Object.entries(mouthStates)) {
    out.push(`<g data-state="${state}"${state === "rest" ? "" : ' style="display:none"'}>`);
    out.push(wash(smoothPath(TT([...m.ou, ...m.ol.slice(1, -1).reverse()])), lip, { op: 0.85 }));
    if (m.open > 0) {
      const inner = [...m.iu, ...m.il.slice(1, -1).reverse()];
      const id = `mclip-${state}-${seed}`;
      out.push(`<clipPath id="${id}"><path d="${smoothPath(TT(inner))}"/></clipPath>`);
      out.push(`<path d="${smoothPath(TT(inner))}" fill="#3b1c1a"/>`);
      const teeth = [...m.iu, ...m.iu.slice().reverse().map(p => add(p, [0, Math.max(0.07, gapOf(m) * 0.55)]))];
      out.push(`<path d="${smoothPath(TT(teeth))}" fill="#f4efe6" clip-path="url(#${id})"/>`);
      out.push(curve(m.iu, { w: 1.4 }));
      out.push(curve(m.il, { w: 1.1, op: 0.8 }));
    } else {
      out.push(curve(m.iu.map((p, i) => lerp(p, m.il[i], 0.5)), { w: 1.8, r: 0.5 }));
    }
    out.push(curve(m.ou.slice(2, 9), { w: 0.8, op: 0.5, single: true }));
    out.push(curve(m.ol.slice(3, 8).map(p => add(p, [0, 0.06])), { w: 1, op: 0.5, single: true }));
    out.push(`</g>`);
  }
  out.push(`</g>`);

  // hair on top: the fringe over the forehead, then every stroke
  for (const l of fringe) out.push(wash(smoothPath(TT(l)), hairC));
  for (const l of hair) out.push(curve(l.concat([l[0]]).filter((_, i) => i % 2 === 0), { w: 1.3, op: 0.9 }));
  const hs = strokes.map(l => TT(l)).filter(l => l.length > 2)
    .map((l, i) => `<path d="${smoothPath(l, false)}" fill="none" stroke="${i % 5 === 0 ? INK : hairInk}" stroke-width="${i % 5 === 0 ? 0.9 : 0.75}" stroke-linecap="round" opacity="0.85"/>`);
  out.push(`<g data-part="hair-strokes">${hs.join("")}</g>`);
  out.push(`</g>`);

  if (credit) out.push(`<text data-part="credit" x="${W - 10}" y="${H - 10}" text-anchor="end" font-family="Georgia, serif" font-size="11" fill="#8a7f76">drawn on-device · sketchgpt</text>`);
  out.push(`</svg>`);
  return out.join("");
}

// How far apart the inner lips are in the middle: a smile with teeth showing.
const gapOf = m => [3, 4, 5, 6, 7].reduce((s, i) => s + (m.il[i][1] - m.iu[i][1]), 0) / 5;

/** The person's own lips in five poses: rest, smile, and open small/wide/round. */
export function mouthShapes(P) {
  const get = k => pick(P, LIPS[k]);
  const base = { ou: get("outerUpper"), ol: get("outerLower"), iu: get("innerUpper"), il: get("innerLower") };
  const all = [...base.ou, ...base.ol];
  const c = centroid(all), half = Math.max(...all.map(p => Math.abs(p[0] - c[0]))) || 0.3;
  const pose = ({ smile = 0, open = 0, narrow = 1 }) => {
    const f = (p, lower) => {
      const w = clamp(Math.abs(p[0] - c[0]) / half, 0, 1);
      let x = c[0] + (p[0] - c[0]) * narrow, y = p[1];
      x += Math.sign(p[0] - c[0]) * 0.05 * smile * w;
      y -= 0.1 * smile * w * w;
      if (lower) y += open * 0.3 * (1 - w * w);
      else y -= open * 0.03 * (1 - w * w);
      return [x, y];
    };
    const shaped = { ou: base.ou.map(p => f(p, false)), iu: base.iu.map(p => f(p, false)),
      ol: base.ol.map(p => f(p, true)), il: base.il.map(p => f(p, true)) };
    return { ...shaped, open: open > 0 || gapOf(shaped) > 0.035 ? Math.max(open, 0.01) : 0 };
  };
  return { rest: pose({}), smile: pose({ smile: 1 }), o1: pose({ open: 0.35, smile: 0.2 }),
    o2: pose({ open: 0.7 }), o3: pose({ open: 0.6, narrow: 0.8 }) };
}

// ---------------------------------------------------------------------------
// Poses and time. poseAt(t) is the GIF's loop, the same every time; the live
// page runs idleLoop instead, which is not.

export const LOOP_MS = 2400;
/** The exported loop: a nod, a blink, a glance and a smile, back where it started. */
export function poseAt(ms) {
  const t = ((ms % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const blink = t > 500 && t < 780 ? (t < 580 || t > 700 ? "half" : "closed") : "open";
  const smile = t > 1100 && t < 2000;
  const glance = t > 1500 && t < 2100 ? [0.05, 0] : [0, 0];
  return { eyes: blink, mouth: smile ? (t > 1250 && t < 1850 ? "o1" : "smile") : "rest",
    brows: smile && t < 1500 ? "up" : "rest", glance, tilt: 1.6 * Math.sin(t / LOOP_MS * 2 * Math.PI), bob: 0 };
}

/** Apply a pose to a portrait <svg> element (live, or a detached clone for export). */
export function setPose(svg, pose) {
  const show = (part, state) => {
    for (const g of svg.querySelectorAll(`[data-part="${part}"] > [data-state]`))
      g.style.display = g.getAttribute("data-state") === state ? "" : "none";
  };
  show("eye-right", pose.eyes); show("eye-left", pose.eyes);
  show("mouth", pose.mouth);
  show("brow-right", pose.brows); show("brow-left", pose.brows);
  const [gx, gy] = pose.glance || [0, 0];
  const irisScale = parseFloat(svg.getAttribute("data-scale") || "70");
  for (const g of svg.querySelectorAll(".iris")) g.setAttribute("transform", `translate(${f1(gx * irisScale)} ${f1(gy * irisScale)})`);
  const head = svg.querySelector('[data-part="head"]');
  if (head) {
    const [px, py] = (head.getAttribute("data-pivot") || "200 300").split(" ").map(Number);
    head.setAttribute("transform", `rotate(${f1(pose.tilt || 0)} ${px} ${py}) translate(0 ${f1(pose.bob || 0)})`);
  }
}

/**
 * The live page's idle life: blinks every 3–6 s, glances, a slow sway, and a
 * smile now and then. talking() says whether the mouth should move (read
 * aloud). Returns a stop function.
 */
export function idleLoop(svg, { talking = () => false, seed = 3, reduced = false } = {}) {
  const rand = rng(seed);
  let raf = 0, nextBlink = 1500, blinkAt = -1, nextGlance = 2500, glanceUntil = 0, glance = [0, 0];
  let nextSmile = 5000, smileUntil = 0, mouthTick = 0, mouthState = "rest";
  const start = performance.now();
  const frame = now => {
    const t = now - start;
    let eyes = "open";
    if (t > nextBlink) { blinkAt = t; nextBlink = t + 3000 + rand() * 3000; }
    const b = t - blinkAt;
    if (blinkAt >= 0 && b < 260) eyes = b < 70 || b > 190 ? "half" : "closed";
    if (t > nextGlance) { glance = [(rand() - 0.5) * 0.1, (rand() - 0.5) * 0.03]; glanceUntil = t + 900 + rand() * 900; nextGlance = t + 4000 + rand() * 4000; }
    if (t > glanceUntil) glance = [0, 0];
    if (t > nextSmile) { smileUntil = t + 1800; nextSmile = t + 6000 + rand() * 6000; }
    let mouth = t < smileUntil ? "smile" : "rest";
    if (talking()) {
      if (t > mouthTick) { mouthState = ["o1", "o2", "rest", "o3", "o1", "smile"][Math.floor(rand() * 6)]; mouthTick = t + 90 + rand() * 90; }
      mouth = mouthState;
    }
    setPose(svg, { eyes, mouth, brows: t < smileUntil && t > smileUntil - 1800 && t < smileUntil - 1200 ? "up" : "rest",
      glance, tilt: reduced ? 0 : 1.4 * Math.sin(t / 2600), bob: reduced ? 0 : 0.8 * Math.sin(t / 900) });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
