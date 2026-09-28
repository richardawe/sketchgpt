// Costumes: real garments on the free CC0 bodies, which come in underwear.
//
// No clothing pack is free on this rig, so each garment is made from the body
// itself, on the page: the part it covers is cut out along a clean line (a
// field over the body, clipped per triangle, so hems and cuffs are straight),
// smoothed until the muscles are gone, and lifted off the skin by the cloth's
// thickness. It keeps the body's skin weights, so it moves with every clip.
// Skirts and coat tails are new geometry: a tube that follows the hips and
// hangs from them, weighted between the pelvis and the thighs. The skin under
// a garment is not drawn, so nothing pokes through when a joint bends.
// docs/film-plan.md, "Costumes".
import * as T from "../vendor/three.mjs?v=1";
import { COSTUMES } from "../film.mjs?v=10";

const ARM = /^(upperarm|lowerarm|hand|index|middle|pinky|ring|thumb)_/, LEG = /^(thigh|calf|foot|ball)_/;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// Garments, in metres where it's a size. sleeve: 0 at the shoulder joint, 1 at the
// wrist. leg: 0 at the hip joint, 1 at the ankle. drop: how far the neckline
// falls at the front centre, over a half-width vw. hem/waist: heights on the body.
export const PIECES = {
  tee:      { kind: "top", sleeve: 0.3, hem: "waist", drop: 0.03, vw: 0.12, thick: 0.01, smooth: 18, stiff: 0.18 },
  shirt:    { kind: "top", sleeve: 0.94, hem: "waist", drop: 0.025, vw: 0.08, thick: 0.009, smooth: 16, stiff: 0.14 },
  vest:     { kind: "top", sleeve: 0.02, hem: "waist", drop: 0.1, vw: 0.13, thick: 0.007, smooth: 14, stiff: 0.14 },
  jacket:   { kind: "top", sleeve: 0.95, hem: "hip", drop: 0.2, vw: 0.085, thick: 0.02, smooth: 26, stiff: 0.2 },
  coat:     { kind: "top", sleeve: 0.96, hem: "hip", drop: 0.1, vw: 0.08, thick: 0.024, smooth: 26, stiff: 0.2, tail: { to: "knee", flare: 0.06, margin: 0.035 } },
  trousers: { kind: "bottom", leg: 0.95, thick: 0.016, smooth: 20, stiff: 0.1 },
  shorts:   { kind: "bottom", leg: 0.42, thick: 0.011, smooth: 12, stiff: 0.08 },
  skirt:    { kind: "bottom", leg: 0.1, thick: 0.009, smooth: 10, tail: { to: "below-knee", flare: 0.07, margin: 0.028 } },
  shoes:    { kind: "shoes", thick: 0.009, smooth: 4 },
};

// ---------------------------------------------------------------- the body, measured once per geometry
function measure(mesh) {
  const g = mesh.geometry;
  if (g.userData.costume) return g.userData.costume;
  const pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, uv = g.attributes.uv;
  const n = pos.count, P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2);
  const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4), armW = new Float32Array(n), legW = new Float32Array(n);
  const names = mesh.skeleton.bones.map(b => b.name);
  for (let i = 0; i < n; i++) {
    P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i);
    const v = new T.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize();
    N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
    if (uv) { UV[i * 2] = uv.getX(i); UV[i * 2 + 1] = uv.getY(i); }
    for (let k = 0; k < 4; k++) {
      const b = si.getComponent(i, k), w = sw.getComponent(i, k);
      SI[i * 4 + k] = b; SW[i * 4 + k] = w;
      if (ARM.test(names[b] || "")) armW[i] += w;
      if (LEG.test(names[b] || "")) legW[i] += w;
    }
  }
  // Joints where the skeleton was bound (bind space is the mesh's own space here).
  const joint = {};
  mesh.skeleton.bones.forEach((b, i) => { joint[b.name] = new T.Vector3().setFromMatrixPosition(new T.Matrix4().copy(mesh.skeleton.boneInverses[i]).invert()); });
  const idx = g.index ? g.index.array : Uint32Array.from({ length: n }, (_, i) => i);
  // Metres per unit of this mesh's space: the quantised glTF scales it on a parent.
  mesh.updateWorldMatrix(true, false);
  const unit = new T.Vector3().setFromMatrixScale(mesh.matrixWorld).y || 1;
  const m = { n, P, N, UV, SI, SW, armW, legW, joint, idx, unit, names };
  // Landmarks every garment is cut against.
  m.waistY = joint.spine_01.y - 0.07 / unit * 0.9;
  m.hipY = joint.thigh_l.y - 0.035 / unit;
  m.neckY = joint.neck_01.y - 0.025 / unit;
  m.kneeY = joint.calf_l.y;
  m.bone = Object.fromEntries(names.map((nm, i) => [nm, i]));
  g.userData.costume = m;
  return m;
}

// Where a vertex is along its arm (0 shoulder, 1 wrist) and its leg (0 hip, 1 ankle).
function along(m, i, a, b) {
  const x = m.P[i * 3], side = x >= 0 ? "_l" : "_r";
  const A = m.joint[a + side], B = m.joint[b + side];
  const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, len2 = dx * dx + dy * dy + dz * dz;
  return ((x - A.x) * dx + (m.P[i * 3 + 1] - A.y) * dy + (m.P[i * 3 + 2] - A.z) * dz) / len2;
}

/** The field a garment is cut by: ≤ 0 on the body where it is worn. */
export function field(m, piece) {
  const p = PIECES[piece], f = new Float32Array(m.n), u = 1 / m.unit;
  for (let i = 0; i < m.n; i++) {
    const x = m.P[i * 3], y = m.P[i * 3 + 1], z = m.P[i * 3 + 2];
    if (p.kind === "top") {
      // The neckline rises steeply away from the neck, so shoulders stay covered;
      // it falls at the front centre by `drop` (a V or a scoop).
      const r = Math.hypot(x, z - m.joint.neck_01.z);
      const front = clamp(z / (0.07 * u)) * clamp(1 - Math.abs(x) / (p.vw * u));
      const neck = y - (m.neckY + 0.8 * Math.max(0, r - 0.075 * u) - p.drop * u * front);
      const hem = (p.hem === "hip" ? m.hipY : m.waistY) - y;
      const sleeve = along(m, i, "upperarm", "hand") - p.sleeve;
      f[i] = Math.max(neck, hem, m.armW[i] > 0.5 ? sleeve : Math.min(sleeve, 0.5 - m.armW[i]));
    } else if (p.kind === "bottom") {
      const waist = y - (m.waistY + 0.03 * u);
      const leg = m.legW[i] > 0.3 ? along(m, i, "thigh", "foot") - p.leg : -1;
      f[i] = Math.max(waist, leg, m.armW[i] - 0.5);
    } else {
      f[i] = Math.max(0.93 - along(m, i, "thigh", "foot"), 0.5 - m.legW[i]);
    }
  }
  return f;
}

// ---------------------------------------------------------------- cutting, smoothing, lifting
function mergeWeights(m, a, b, t) {
  const acc = new Map();
  for (const [v, s] of [[a, 1 - t], [b, t]]) for (let k = 0; k < 4; k++) {
    const w = m.SW[v * 4 + k] * s;
    if (w > 0) acc.set(m.SI[v * 4 + k], (acc.get(m.SI[v * 4 + k]) || 0) + w);
  }
  const top = [...acc].sort((p, q) => q[1] - p[1]).slice(0, 4), sum = top.reduce((s, e) => s + e[1], 0) || 1;
  return [top.map(e => e[0]).concat([0, 0, 0, 0]).slice(0, 4), top.map(e => e[1] / sum).concat([0, 0, 0, 0]).slice(0, 4)];
}

/** The part of the body where f ≤ 0, cut along f = 0 inside each triangle. */
function cut(m, f) {
  const P = [], N = [], UV = [], SI = [], SW = [], tris = [];
  const from = new Map(), edge = new Map();
  const vert = i => {
    if (from.has(i)) return from.get(i);
    const k = P.length / 3;
    P.push(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]); N.push(m.N[i * 3], m.N[i * 3 + 1], m.N[i * 3 + 2]); UV.push(m.UV[i * 2], m.UV[i * 2 + 1]);
    for (let j = 0; j < 4; j++) { SI.push(m.SI[i * 4 + j]); SW.push(m.SW[i * 4 + j]); }
    from.set(i, k);
    return k;
  };
  const cross = (a, b) => {
    const key = a < b ? a + ":" + b : b + ":" + a;
    if (edge.has(key)) return edge.get(key);
    const t = f[a] / (f[a] - f[b]), k = P.length / 3;
    for (let c = 0; c < 3; c++) { P.push(m.P[a * 3 + c] + (m.P[b * 3 + c] - m.P[a * 3 + c]) * t); N.push(m.N[a * 3 + c] + (m.N[b * 3 + c] - m.N[a * 3 + c]) * t); }
    UV.push(m.UV[a * 2] + (m.UV[b * 2] - m.UV[a * 2]) * t, m.UV[a * 2 + 1] + (m.UV[b * 2 + 1] - m.UV[a * 2 + 1]) * t);
    const [bi, bw] = mergeWeights(m, a, b, t);
    SI.push(...bi); SW.push(...bw);
    edge.set(key, k);
    return k;
  };
  for (let t = 0; t < m.idx.length; t += 3) {
    const v = [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
    const inside = v.map(i => f[i] <= 0);
    const count = inside.filter(Boolean).length;
    if (count === 0) continue;
    if (count === 3) { tris.push(vert(v[0]), vert(v[1]), vert(v[2])); continue; }
    // Sutherland–Hodgman against f ≤ 0: one or two triangles, winding kept.
    const poly = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if (inside[e]) poly.push(vert(a));
      if (inside[e] !== inside[(e + 1) % 3]) poly.push(cross(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++) tris.push(poly[0], poly[k], poly[k + 1]);
  }
  return { P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), SI: Uint16Array.from(SI), SW: Float32Array.from(SW), tris: Uint32Array.from(tris) };
}

/** Taubin smoothing (no shrinking), the hem held still, then everything lifted along its normal. */
function smoothAndLift(s, { smooth, thick, stiff }, unit) {
  const n = s.P.length / 3;
  // Weld across UV seams by position, so smoothing and normals don't split the cloth.
  const group = new Int32Array(n), keys = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(s.P[i * 3] * 2e4)},${Math.round(s.P[i * 3 + 1] * 2e4)},${Math.round(s.P[i * 3 + 2] * 2e4)}`;
    if (!keys.has(k)) keys.set(k, keys.size);
    group[i] = keys.get(k);
  }
  const G = keys.size, pos = new Float64Array(G * 3), nb = Array.from({ length: G }, () => new Set()), edges = new Map();
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) pos[group[i] * 3 + c] = s.P[i * 3 + c];
  for (let t = 0; t < s.tris.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = group[s.tris[t + e]], b = group[s.tris[t + (e + 1) % 3]];
    if (a === b) continue;
    nb[a].add(b); nb[b].add(a);
    const key = a < b ? a * G + b : b * G + a;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  // Normals of the cloth as it is now, area-weighted, per welded point (unit length).
  function normals() {
    const nrm = new Float64Array(G * 3);
    for (let t = 0; t < s.tris.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map(e => group[s.tris[t + e]]);
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      for (const g of [a, b, c]) { nrm[g * 3] += cx; nrm[g * 3 + 1] += cy; nrm[g * 3 + 2] += cz; }
    }
    for (let g = 0; g < G; g++) { const l = Math.hypot(nrm[g * 3], nrm[g * 3 + 1], nrm[g * 3 + 2]) || 1; nrm[g * 3] /= l; nrm[g * 3 + 1] /= l; nrm[g * 3 + 2] /= l; }
    return nrm;
  }
  const fixed = new Uint8Array(G);
  for (const [key, c] of edges) if (c === 1) { fixed[Math.floor(key / G)] = 1; fixed[key % G] = 1; }
  const step = lambda => {
    const next = Float64Array.from(pos);
    for (let g = 0; g < G; g++) {
      if (fixed[g] || !nb[g].size) continue;
      let x = 0, y = 0, z = 0;
      for (const o of nb[g]) { x += pos[o * 3]; y += pos[o * 3 + 1]; z += pos[o * 3 + 2]; }
      const k = nb[g].size;
      next[g * 3] += lambda * (x / k - pos[g * 3]); next[g * 3 + 1] += lambda * (y / k - pos[g * 3 + 1]); next[g * 3 + 2] += lambda * (z / k - pos[g * 3 + 2]);
    }
    pos.set(next);
  };
  for (let it = 0; it < smooth; it++) { step(0.6); step(-0.63); }
  // Cloth spans hollows instead of following them (under the bust, the small of
  // the back): each point moves out until the surface near it is no more
  // concave than cloth of bending radius `stiff` can be (a closing with a ball).
  if (stiff) {
    const st = stiff / unit, nrm = normals(), R = st * 0.9, cell = R, grid = new Map(), out = new Float64Array(G);
    const cellOf = g => `${Math.floor(pos[g * 3] / cell)},${Math.floor(pos[g * 3 + 1] / cell)},${Math.floor(pos[g * 3 + 2] / cell)}`;
    for (let g = 0; g < G; g++) { const k = cellOf(g); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(g); }
    for (let g = 0; g < G; g++) {
      if (fixed[g]) continue;
      const cx = Math.floor(pos[g * 3] / cell), cy = Math.floor(pos[g * 3 + 1] / cell), cz = Math.floor(pos[g * 3 + 2] / cell);
      let best = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const o of grid.get(`${cx + a},${cy + b},${cz + c}`) || []) {
        if (nrm[o * 3] * nrm[g * 3] + nrm[o * 3 + 1] * nrm[g * 3 + 1] + nrm[o * 3 + 2] * nrm[g * 3 + 2] < 0.3) continue;
        const dx = pos[o * 3] - pos[g * 3], dy = pos[o * 3 + 1] - pos[g * 3 + 1], dz = pos[o * 3 + 2] - pos[g * 3 + 2], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R * R) continue;
        const h = dx * nrm[g * 3] + dy * nrm[g * 3 + 1] + dz * nrm[g * 3 + 2] - d2 / (2 * st);
        if (h > best) best = h;
      }
      out[g] = best;
    }
    for (let g = 0; g < G; g++) for (let c = 0; c < 3; c++) pos[g * 3 + c] += out[g] * nrm[g * 3 + c];
    for (let it = 0; it < 3; it++) { step(0.5); step(-0.53); }
  }
  const nrm = normals();
  const lift = thick / unit;
  for (let i = 0; i < n; i++) {
    const g = group[i];
    const x = nrm[g * 3], y = nrm[g * 3 + 1], z = nrm[g * 3 + 2];
    s.N[i * 3] = x; s.N[i * 3 + 1] = y; s.N[i * 3 + 2] = z;
    s.P[i * 3] = pos[g * 3] + x * lift; s.P[i * 3 + 1] = pos[g * 3 + 1] + y * lift; s.P[i * 3 + 2] = pos[g * 3 + 2] + z * lift;
  }
  s.boundary = [...new Set(Array.from({ length: n }, (_, i) => i).filter(i => fixed[group[i]]))];
  return s;
}

// ---------------------------------------------------------------- a tube that hangs from the hips
function tail(m, { from, to, flare, margin }) {
  const u = 1 / m.unit, K = 48;
  const top = from, bottom = to === "knee" ? m.kneeY - 0.02 * u : m.kneeY - 0.1 * u;
  const R = Math.max(4, Math.round((top - bottom) / (0.04 * u)));
  // The hips' cross-section at each height, legs together, arms left out.
  const rings = [];
  let rx = 0, rz = 0, cz = 0;
  for (let j = 0; j <= R; j++) {
    const a = j / R, yy = top + (bottom - top) * a;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < m.n; i++) {
      if (Math.abs(m.P[i * 3 + 1] - yy) > 0.025 * u || m.armW[i] > 0.3) continue;
      minX = Math.min(minX, m.P[i * 3]); maxX = Math.max(maxX, m.P[i * 3]); minZ = Math.min(minZ, m.P[i * 3 + 2]); maxZ = Math.max(maxZ, m.P[i * 3 + 2]);
    }
    if (maxX > minX) {
      if (j === 0) cz = (maxZ + minZ) / 2;
      // Never narrower lower down: cloth hangs, it doesn't follow between the legs.
      rx = Math.max(rx, Math.max(maxX, -minX) + margin * u); rz = Math.max(rz, Math.max(maxZ - cz, cz - minZ) + margin * u);
    }
    rings.push({ y: yy, rx: rx + flare * u * a * a, rz: rz + flare * u * 0.6 * a * a, a });
  }
  const P = [], N = [], SI = [], SW = [], idx = [];
  const b = m.bone;
  for (const [j, r] of rings.entries()) for (let k = 0; k < K; k++) {
    const th = (k / K) * Math.PI * 2, x = Math.sin(th) * r.rx, z = cz + Math.cos(th) * r.rz;
    P.push(x, r.y, z); N.push(Math.sin(th) / r.rx, 0, Math.cos(th) / r.rz);
    // Hanging from the pelvis, pulled by each thigh on its own side (both at the centre).
    const legs = 0.85 * Math.sqrt(r.a), left = clamp(0.5 + x / (r.rx * 0.7));
    SI.push(b.pelvis, b.thigh_l, b.thigh_r, 0); SW.push(1 - legs, legs * left, legs * (1 - left), 0);
    if (j < rings.length - 1) { const p = j * K, q = (j + 1) * K, k1 = (k + 1) % K; idx.push(p + k, q + k, p + k1, p + k1, q + k, q + k1); }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]); N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  return { P: Float32Array.from(P), N: Float32Array.from(N), UV: new Float32Array(P.length / 3 * 2), SI: Uint16Array.from(SI), SW: Float32Array.from(SW), tris: Uint32Array.from(idx), rings: rings.length, K };
}

// How thick each leg is, per segment, in the bind pose, at its top and its bottom
// (a thigh is much thicker at the hip than at the knee): what a skirt must clear.
function legRadii(m) {
  const r = {};
  for (const side of ["_l", "_r"]) for (const [a, b] of [["thigh", "calf"], ["calf", "foot"]]) {
    const A = m.joint[a + side], B = m.joint[b + side], near = [], far = [];
    const ab = new T.Vector3().subVectors(B, A), l2 = ab.lengthSq(), v = new T.Vector3();
    for (let i = 0; i < m.n; i++) {
      if (m.legW[i] < 0.8 || (m.P[i * 3] >= 0) !== (side === "_l")) continue;
      v.set(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]).sub(A);
      const t = v.dot(ab) / l2, d = v.sub(ab.clone().multiplyScalar(t)).length();
      if (t >= 0.1 && t < 0.3) near.push(d);
      if (t >= 0.7 && t < 0.9) far.push(d);
    }
    const pct = (xs, q) => xs.sort((x, y) => x - y)[Math.floor(xs.length * q)] || 0.06;
    r[a + side] = [pct(near, 0.6), pct(far, 0.6)];
  }
  // The hips: a capsule from one hip joint to the other, as deep as the seat.
  const A = m.joint.thigh_r, B = m.joint.thigh_l, ab = new T.Vector3().subVectors(B, A), l2 = ab.lengthSq(), v = new T.Vector3(), hips = [];
  for (let i = 0; i < m.n; i++) {
    if (m.armW[i] > 0.3 || Math.abs(m.P[i * 3 + 1] - A.y) > 0.06 / m.unit) continue;
    v.set(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]).sub(A);
    const t = clamp(v.dot(ab) / l2);
    hips.push(v.sub(ab.clone().multiplyScalar(t)).length());
  }
  hips.sort((x, y) => x - y);
  r.hips = hips[Math.floor(hips.length * 0.9)] || 0.1;
  return r;
}

/**
 * A skirt or coat tail posed on the CPU each frame (a few hundred points): the
 * waistband skinned to the hips, the rest hanging from it and kept out of both
 * legs. Every frame is a function of the pose alone (no simulation state), so
 * the preview and the video agree and a frame can be made in any order.
 */
function drape(body, s, material, m, margin) {
  const g = new T.BufferGeometry();
  const pos = new T.BufferAttribute(new Float32Array(s.P.length), 3);
  pos.setUsage(T.DynamicDrawUsage);
  g.setAttribute("position", pos);
  g.setIndex(new T.BufferAttribute(s.tris, 1));
  const mesh = new T.Mesh(g, material);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = "costume-drape";
  body.parent.add(mesh);
  const bones = body.skeleton.bones, inv = body.skeleton.boneInverses, radii = legRadii(m);
  const n = s.P.length / 3, world = new Float32Array(n * 3);
  const M = bones.map(() => new T.Matrix4()), v = new T.Vector3(), acc = new T.Vector3(), toLocal = new T.Matrix4();
  const hipR = radii.hips + margin / m.unit;
  const segs = [{ a: bones[m.bone.thigh_r], b: bones[m.bone.thigh_l], r0: hipR, r1: hipR },
    ...["_l", "_r"].flatMap(side => [["thigh", "calf"], ["calf", "foot"]].map(([a, b]) => ({ a: bones[m.bone[a + side]], b: bones[m.bone[b + side]], r0: radii[a + side][0] + margin / m.unit, r1: radii[a + side][1] + margin / m.unit })))];
  const AB = new T.Vector3(), C = new T.Vector3();
  // Rest length of each segment down a column, and its direction, in the bind pose.
  const K = s.K, rest = new Float32Array(n * 3);
  for (let j = 1; j < s.rings; j++) for (let k = 0; k < K; k++) {
    const i = j * K + k, u = (j - 1) * K + k;
    for (let c = 0; c < 3; c++) rest[i * 3 + c] = s.P[i * 3 + c] - s.P[u * 3 + c];
  }
  const pelvis = m.bone.pelvis, d = new T.Vector3(), q = new T.Vector3(), prev = new T.Vector3(), outs = [];
  function update() {
    for (const bi of new Set(s.SI)) M[bi].multiplyMatrices(bones[bi].matrixWorld, inv[bi]);
    const scale = new T.Vector3().setFromMatrixScale(body.matrixWorld).y || 1;
    for (const sg of segs) { sg.a.getWorldPosition(sg.A ||= new T.Vector3()); sg.b.getWorldPosition(sg.B ||= new T.Vector3()); }
    // Inside a leg? Then out along this column's own direction (away from the
    // body, a little up), so the columns keep their order and the cloth tents
    // over a leg instead of parting round it.
    const inside = p => segs.some(sg => {
      AB.subVectors(sg.B, sg.A);
      const t = clamp(C.copy(p).sub(sg.A).dot(AB) / AB.lengthSq());
      return C.copy(sg.A).addScaledVector(AB, t).distanceTo(p) < (sg.r0 + (sg.r1 - sg.r0) * t) * scale;
    });
    const collide = (p, out) => {
      if (!inside(p)) return false;
      let lo = 0, hi = 0.05;
      const probe = new T.Vector3();
      while (inside(probe.copy(p).addScaledVector(out, hi)) && hi < 2) hi *= 2;
      for (let it = 0; it < 12; it++) { const mid = (lo + hi) / 2; if (inside(probe.copy(p).addScaledVector(out, mid))) lo = mid; else hi = mid; }
      p.addScaledVector(out, hi);
      return true;
    };
    // The waistband is worn: skinned to the hips.
    for (let k = 0; k < K; k++) {
      acc.set(0, 0, 0);
      for (let b = 0; b < 4; b++) { const w = s.SW[k * 4 + b]; if (w > 0) acc.addScaledVector(v.set(s.P[k * 3], s.P[k * 3 + 1], s.P[k * 3 + 2]).applyMatrix4(M[s.SI[k * 4 + b]]), w); }
      world[k * 3] = acc.x; world[k * 3 + 1] = acc.y; world[k * 3 + 2] = acc.z;
    }
    // Each column's way out: from the waistband's middle through its own top point, level, and a little up.
    let cx = 0, cz = 0;
    for (let k = 0; k < K; k++) { cx += world[k * 3] / K; cz += world[k * 3 + 2] / K; }
    for (let k = 0; k < K; k++) (outs[k] ||= new T.Vector3()).set(world[k * 3] - cx, 0, world[k * 3 + 2] - cz).normalize().setY(0.45).normalize();
    // Below it, each column hangs a segment at a time: its rest direction turned
    // with the hips, pulled a little towards the ground; a segment that meets a
    // leg is pushed out of it and kept its length, so the cloth slides over the
    // thigh (sitting: along the lap, then down at the knee).
    for (let j = 1; j < s.rings; j++) for (let k = 0; k < K; k++) {
      const i = j * K + k, u = (j - 1) * K + k;
      d.set(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]).transformDirection(M[pelvis]);
      const L = Math.hypot(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]) * scale;
      d.y -= 0.35; d.normalize();
      prev.set(world[u * 3], world[u * 3 + 1], world[u * 3 + 2]);
      q.copy(prev).addScaledVector(d, L);
      for (let it = 0; it < 4 && collide(q, outs[k]); it++) q.sub(prev).setLength(L).add(prev);
      collide(q, outs[k]);
      world[i * 3] = q.x; world[i * 3 + 1] = q.y; world[i * 3 + 2] = q.z;
    }
    // Neighbouring columns hold each other: eased round each ring, then clear of the legs again.
    for (let pass = 0; pass < 2; pass++) for (let j = 1; j < s.rings; j++) {
      const row = world.slice(j * K * 3, (j + 1) * K * 3);
      for (let k = 0; k < K; k++) for (let c = 0; c < 3; c++)
        world[(j * K + k) * 3 + c] = (row[((k + K - 1) % K) * 3 + c] + 2 * row[k * 3 + c] + row[((k + 1) % K) * 3 + c]) / 4;
    }
    for (let i = K; i < n; i++) { q.set(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]); if (collide(q, outs[i % K])) { world[i * 3] = q.x; world[i * 3 + 1] = q.y; world[i * 3 + 2] = q.z; } }
    toLocal.copy(mesh.parent.matrixWorld).invert();
    for (let i = 0; i < n; i++) {
      v.set(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]).applyMatrix4(toLocal);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  }
  return { mesh, update };
}

// ---------------------------------------------------------------- cloth
const fabricCache = new Map();
function fabric(color, { sheen = 0.5, rough = 0.85 } = {}) {
  const key = color + sheen + rough;
  if (fabricCache.has(key)) return fabricCache.get(key);
  const c = new T.Color(color);
  const mat = new T.MeshPhysicalMaterial({ color: c, roughness: rough, metalness: 0, sheen, sheenRoughness: 0.6, sheenColor: c.clone().lerp(new T.Color("#ffffff"), 0.35), side: T.DoubleSide });
  // The inside of a sleeve or a collar is in shadow.
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n if (!gl_FrontFacing) diffuseColor.rgb *= 0.35;"); };
  mat.customProgramCacheKey = () => "cloth";
  fabricCache.set(key, mat);
  return mat;
}

function skinned(body, s, material) {
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(s.P, 3));
  g.setAttribute("normal", new T.BufferAttribute(s.N, 3));
  g.setAttribute("uv", new T.BufferAttribute(s.UV, 2));
  g.setAttribute("skinIndex", new T.Uint16BufferAttribute(s.SI, 4));
  g.setAttribute("skinWeight", new T.BufferAttribute(s.SW, 4));
  g.setIndex(new T.BufferAttribute(s.tris, 1));
  const mesh = new T.SkinnedMesh(g, material);
  mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
  body.parent.add(mesh);
  mesh.bind(body.skeleton, body.bindMatrix);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.name = "costume";
  return mesh;
}

/**
 * Dress a body (its main SkinnedMesh) in a costume from film.mjs COSTUMES, in the
 * look's colours. Returns { made, drapes }; the body's skin under them stops drawing.
 */
export function wearCostume(body, costume, outfit) {
  const m = measure(body);
  const spec = COSTUMES[costume] || COSTUMES.casual;
  const layers = [];
  if (spec.under) layers.push([spec.under, outfit.under || "#e8e4dc"]);
  layers.push([spec.top, outfit.top], [spec.bottom, spec.same ? outfit.top : outfit.bottom], ["shoes", outfit.shoes]);
  const cover = new Float32Array(m.n).fill(1e9), made = [], drapes = [];
  for (const [piece, color] of layers) {
    const p = PIECES[piece], f = field(m, piece);
    for (let i = 0; i < m.n; i++) cover[i] = Math.min(cover[i], f[i]);
    const mat = fabric(color, piece === "shoes" ? { sheen: 0, rough: 0.45 } : {});
    // A top is worn over the waistband: lifted past the thickest bottom.
    const lift = p.kind === "top" ? { ...p, thick: p.thick + (piece === spec.under ? 0.012 : 0.02) } : p;
    made.push(skinned(body, smoothAndLift(cut(m, f), lift, m.unit), mat));
    if (p.tail) {
      const from = p.kind === "top" ? m.hipY + 0.04 / m.unit : m.waistY + 0.02 / m.unit;
      const d = drape(body, tail(m, { from, ...p.tail }), mat, m, p.tail.margin);
      made.push(d.mesh); drapes.push(d.update);
    }
  }
  // Skin under cloth isn't drawn (a little is kept under each hem, so the gap
  // at a cuff shows arm, not an empty sleeve).
  body.geometry = body.geometry.clone();
  body.geometry.setAttribute("cover", new T.BufferAttribute(cover.map(v => v * m.unit), 1));
  return { made, drapes };
}

/** The body's skin, toned by `gain` (a colour gain on the texture), with covered skin not drawn. */
function skin(mesh, gain) {
  const mat = mesh.material = mesh.material.clone();
  mat.color = gain;
  mat.onBeforeCompile = sh => {
    sh.vertexShader = "attribute float cover;\nvarying float vCover;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvCover = cover;");
    sh.fragmentShader = "varying float vCover;\n" + sh.fragmentShader.replace("void main() {", "void main() {\n if (vCover < -0.02) discard;");
  };
  mat.customProgramCacheKey = () => "skin-under-cloth";
}

/** Dress a whole person (the glTF scene): costume, colours and skin tone from a cleaned look. */
export function dressBody(root, look, gain = new T.Color(1, 1, 1)) {
  let body = null;
  root.traverse(o => { if (o.isSkinnedMesh && o.geometry.attributes.position.count > 3000) body = o; });
  if (!body) return () => {};
  const { drapes } = wearCostume(body, look.costume, look.outfit);
  skin(body, gain);
  // Call after posing (world matrices current): skirts and coat tails follow the legs.
  return () => { for (const u of drapes) u(); };
}
