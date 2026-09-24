// Selfie mode's rules, checked without a browser.
//
//   node --test tests/face.test.mjs
//
// The ones that matter most: the caricature never changes nose width, lip
// fullness or eye shape, at any slider value (docs/selfie.md — "for everyone");
// skin is drawn at the photo's own lightness; and nothing vendored for this
// page can log anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  alignFace, meanFace, caricature, measure, skinTone, lightness, rgbToLab, labToRgb, outlines, simplify,
  hairStrokes, shadeCells, renderPortrait, mouthShapes, poseAt, LOOP_MS, EYE, OVAL, insidePolygon, dominantColour,
} from "../web/face.mjs";

// A face to work with: the average face, made less average in every way the
// caricature could grab — wide nose, full lips, big eyes, long jaw.
function person() {
  const pts = meanFace().map(p => [...p]);
  const widen = (idx, k, around) => { for (const i of idx) pts[i][0] = around + (pts[i][0] - around) * k; };
  widen([129, 64, 98, 97, 2, 326, 327, 294, 358], 1.25, 0);                               // nose
  for (const i of [0, 37, 267, 39, 269, 17, 84, 314, 181, 405]) pts[i][1] += (pts[i][1] > 1.2 ? 0.05 : -0.04); // lips
  for (const i of OVAL) if (pts[i][1] > 1) pts[i][1] += 0.15;                                // jaw
  widen([...new Set([61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 146, 91, 181, 84, 17, 314, 405, 321, 375, 78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 95, 88, 178, 87, 14, 317, 402, 318, 324])], 1.2, 0); // wide mouth
  // The average face's lips are parted; this person's are closed.
  [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308].forEach((i, k) => { pts[i] = [...pts[[78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308][k]]]; });
  const iris = (c, r) => [c, ...[0, 1, 2, 3].map(k => [c[0] + r * Math.cos(k * Math.PI / 2), c[1] + r * Math.sin(k * Math.PI / 2)])];
  return [...pts, ...iris([-0.5, 0], 0.17), ...iris([0.5, 0], 0.17)];
}
const eyeShape = (P, side) => {           // height/width of the eye, and where the lid peaks
  const up = EYE[side].upper.map(i => P[i]), lo = EYE[side].lower.map(i => P[i]);
  const w = Math.hypot(up[0][0] - up[8][0], up[0][1] - up[8][1]);
  return up.map((p, i) => (lo[i][1] - p[1]) / w);
};
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("the caricature never changes nose width, lip fullness or eye shape", () => {
  const P = person(), m0 = measure(P);
  for (const amount of [0, 0.5, 1, 1.5, 2]) {
    const C = caricature(P, amount), m = measure(C);
    close(m.noseWidth, m0.noseWidth, 1e-9, `nose width at ${amount}`);
    close(m.lipHeight, m0.lipHeight, 1e-9, `lip fullness at ${amount}`);
    for (const side of ["right", "left"]) eyeShape(C, side).forEach((v, i) => close(v, eyeShape(P, side)[i], 1e-9, `${side} eye shape at ${amount}`));
  }
});

test("the caricature does exaggerate what it may: head shape, eye size", () => {
  const P = person(), C = caricature(P, 1.5);
  assert.ok(measure(C).faceLength > measure(P).faceLength + 0.05, "a long face gets longer");
  assert.deepEqual(caricature(P, 0), P, "0 is a straight portrait");
});

test("a turned head is caricatured less", () => {
  const P = person(), T = P.map(p => [...p]);
  T[4] = [0.3, T[4][1]];
  const moved = (A, B) => OVAL.reduce((s, i) => s + Math.hypot(A[i][0] - B[i][0], A[i][1] - B[i][1]), 0);
  assert.ok(moved(caricature(T, 2), T) < moved(caricature(P, 2), P) * 0.6);
});

test("face space does not depend on the photo's size, position or tilt", () => {
  const P = person();
  const photo = (s, a, dx, dy) => P.map(([x, y]) => [dx + s * (x * Math.cos(a) - y * Math.sin(a)), dy + s * (x * Math.sin(a) + y * Math.cos(a))]);
  const ref = alignFace(photo(100, 0, 300, 200)).pts;
  for (const [s, a, dx, dy] of [[57, 0.3, 40, 90], [240, -0.5, 900, 50]]) {
    const { pts, toImage } = alignFace(photo(s, a, dx, dy));
    pts.forEach((p, i) => { close(p[0], ref[i][0], 1e-9, `x${i}`); close(p[1], ref[i][1], 1e-9, `y${i}`); });
    const back = toImage(pts[10]), orig = photo(s, a, dx, dy)[10];
    close(back[0], orig[0], 1e-6, "round trip x"); close(back[1], orig[1], 1e-6, "round trip y");
  }
});

test("skin keeps the photo's lightness exactly, for every tone", () => {
  // From very dark to very light, and odd casts a phone camera produces.
  for (const rgb of [[45, 30, 24], [82, 52, 38], [120, 80, 60], [160, 110, 80], [198, 142, 106], [230, 190, 165],
    [245, 222, 205], [120, 130, 90], [150, 150, 170], [60, 40, 70]]) {
    const L = rgbToLab(rgb)[0];
    close(lightness(skinTone(rgb)), L, 0.8, `L* of ${rgb}`);
  }
});

test("Lab conversion round-trips", () => {
  for (const rgb of [[0, 0, 0], [255, 255, 255], [198, 142, 106], [3, 88, 145]])
    labToRgb(rgbToLab(rgb)).forEach((v, i) => close(v, rgb[i], 1, `channel ${i} of ${rgb}`));
});

test("clothes take the fabric's colour, not the zip's", () => {
  const blue = [3, 87, 145], samples = [...Array(80).fill(blue), ...Array(30).fill([240, 240, 240]), ...Array(20).fill([10, 10, 10])];
  assert.deepEqual(dominantColour(samples), blue);
});

test("mask outlines: a ring gives an outer and an inner loop, largest first", () => {
  const w = 40, h = 40, m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const r = Math.hypot(x - 20, y - 20); if (r < 15 && r > 7) m[y * w + x] = 1; }
  const loops = outlines(m, w, h, 5);
  assert.equal(loops.length, 2);
  assert.ok(insidePolygon([20, 9], simplify(loops[0])), "outer loop holds the ring");
  assert.ok(insidePolygon([20, 20], simplify(loops[1])), "inner loop is the hole");
});

test("hair strokes follow the hair's direction and stay inside it", () => {
  const w = 120, h = 120, gray = new Float32Array(w * h), mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    gray[y * w + x] = 0.5 + 0.4 * Math.sin(x * 0.9);          // vertical strands
    if (x > 20 && x < 100 && y > 10 && y < 110) mask[y * w + x] = 1;
  }
  const strokes = hairStrokes(gray, mask, w, h);
  assert.ok(strokes.length > 5, "some strokes");
  for (const s of strokes) {
    for (const [x, y] of s) assert.ok(mask[(y | 0) * w + (x | 0)], "inside the mask");
    const dx = Math.abs(s.at(-1)[0] - s[0][0]), dy = Math.abs(s.at(-1)[1] - s[0][1]);
    assert.ok(dy > dx, "runs along the strands");
  }
});

test("shading is relative to the face's own brightness", () => {
  const P = person();
  const flat = shadeCells(P, () => 0.2);                        // a dark face, evenly lit
  assert.equal(flat.length, 0, "an evenly lit dark face is not hatched");
  const sided = shadeCells(P, ([x]) => x < 0 ? 0.25 : 0.7);
  assert.ok(sided.length > 0 && sided.every(c => c[0] < 0), "only the shadowed side is hatched");
});

test("an open smile shows teeth; the mouth has five poses", () => {
  const P = person();
  const m = mouthShapes(P);
  assert.deepEqual(Object.keys(m), ["rest", "smile", "o1", "o2", "o3"]);
  assert.equal(m.rest.open, 0);
  const grin = P.map(p => [...p]);
  for (const i of [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]) grin[i][1] += 0.1;
  assert.ok(mouthShapes(grin).rest.open > 0, "lips apart in the photo: drawn open, with teeth");
});

test("the portrait is the same every time for the same seed, and has its moving parts", () => {
  const data = { pts: person(), hair: [], fringe: [], strokes: [], shade: [[0.5, 0.5, 2]],
    colours: { skin: "#8a5a3c", hair: "#1d1611", lip: "#7b4934", iris: "#241a12", cloth: "#035791" } };
  const a = renderPortrait(data, { seed: 4 }), b = renderPortrait(data, { seed: 4 });
  assert.equal(a, b);
  for (const part of ["eye-right", "eye-left", "brow-right", "brow-left", "mouth", "head", "body"]) assert.match(a, new RegExp(`data-part="${part}"`));
  for (const state of ["open", "half", "closed", "rest", "smile", "o1", "o2", "o3", "up"]) assert.match(a, new RegExp(`data-state="${state}"`));
  assert.match(a, /fill="#8a5a3c"/, "skin drawn in the measured colour");
  assert.doesNotMatch(renderPortrait(data, { seed: 4, credit: false }), /sketchgpt/);
});

test("the GIF loop ends where it starts", () => {
  const a = poseAt(0), b = poseAt(LOOP_MS);
  assert.deepEqual(a, b);
  const eyes = new Set(Array.from({ length: 24 }, (_, i) => poseAt(i * LOOP_MS / 24).eyes));
  assert.ok(eyes.has("closed"), "it blinks");
});

test("nothing vendored for Selfie mode can log anywhere", () => {
  // MediaPipe's runtime was dropped for posting usage statistics. Nothing that
  // ships with this page may contain a logging or analytics endpoint, and the
  // page must not load MediaPipe's runtime again.
  const files = [];
  const walk = d => { for (const e of readdirSync(new URL(d, import.meta.url), { withFileTypes: true }))
    e.isDirectory() ? walk(d + e.name + "/") : /\.(m?js|html)$/.test(e.name) && files.push(d + e.name); };
  walk("../web/vendor/");
  files.push("../web/selfie.html", "../web/face.mjs", "../web/face-find.mjs");
  assert.ok(files.length >= 7);
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /odml\.pa\.googleapis|google-analytics|googletagmanager|sendBeacon|\/v1\/log\b|sentry\.io|segment\.io|mixpanel|applicationinsights/i, f);
    assert.doesNotMatch(src, /@mediapipe\/tasks|vision_bundle|tasks-vision/, `${f} loads MediaPipe's runtime`);
  }
});

test("the page is not allowed to connect anywhere but its own site", () => {
  const html = readFileSync(new URL("../web/selfie.html", import.meta.url), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, "has a CSP");
  assert.match(csp[1], /connect-src 'self' blob: data:;/);
});

test("export reads the drawing's data, never the photo", () => {
  // Structural: the functions that make files take their input from `data`
  // and renderPortrait, and never touch the photo's element or pixels.
  const html = readFileSync(new URL("../web/selfie.html", import.meta.url), "utf8");
  const exporter = html.slice(html.indexOf("// ---- export"), html.indexOf("// ---- wiring"));
  assert.ok(exporter.length > 200);
  assert.doesNotMatch(exporter, /\$\("photo"\)|getImageData\(0, 0, w, h\)|canvas\.toDataURL|portraitData/);
  assert.match(exporter, /renderPortrait\(data/);
});
