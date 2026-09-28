// "Drawn" people (Open Peeps, Pablo Stanley, CC0) on hand-drawn sets, on a 2D canvas.
//
// The same film as the other two styles: film.mjs says where everyone is
// (placesAt), which set and light (setAt), and where the camera stands
// (cameraFor, so the 180° rule holds here too). This file projects that through
// a pinhole camera and draws it: rooms, streets and parks as flat-coloured boxes
// with ink outlines, and each person as a paper cut-out standing where the 3D
// body would stand, facing the camera and turned left or right by the way they
// face. Open Peeps are single drawings, not rigs, so a move is a choice of
// drawing plus a little motion: walking bobs, a punch lunges, a fall tips over;
// talking switches faces with the voice's syllables (textEnvelope) and eyes blink.
// Nothing here is 3D, so it needs no WebGL and loads ~0.5 MB of paths.
import { PEEPS } from "./peeps.mjs?v=1";
import { placesAt, setAt, segIndex, cameraFor, textEnvelope, SETS, cleanDrawn } from "../film.mjs?v=10";

// A standing peep, hair to sole, is 2,876 units; people are 1.72 m.
export const UNIT = 1.72 / 2876;
const NECK = [300, 480];                 // where the head turns, in peep units (every pose puts the head in the same place)
const HEAD = [300, 300];                 // the head's middle
const ANCHOR = 400;                       // x under the body: where a person "is"
const LIE_MID = 1300;                     // how far up a standing drawing its middle is: what a fall turns about
const HAND = [1150, 720];                 // the raised hand in the PointingFinger drawings
const SIT_HAND = { CrossedLegs: [880, 1150], OneLegUpBW: [420, 1110] };   // a seated hand, on the knee
const INK = "#1b1b1b", PAPER = "#ffffff";

// Which drawing each outfit uses for each kind of pose. BW: dark top, light
// trousers; WB: the reverse. Sitting on a chair has one drawing (CrossedLegs,
// light top); a dark top sits on the edge of the seat, one knee up.
export const POSE = {
  stand: o => "Resting" + o, point: o => "PointingFinger" + o, arms: o => "CrossedArms" + o, walk: o => "Walking" + o,
  dance: o => "RoboDance" + o, squat: o => "Medium" + o, kneel: o => "HandsBack" + o, sit: o => o === "WB" ? "CrossedLegs" : "OneLegUpBW",
};
// How far above the floor each seated drawing's lowest point sits (m): a foot on the floor, or a seat's edge.
const SIT_DROP = { CrossedLegs: 0, OneLegUpBW: 0.28 };

// ---------------------------------------------------------------- paths
const cache = new Map();
function pathsOf(piece) {
  let p = cache.get(piece);
  if (!p) cache.set(piece, p = piece.paths.map(([k, d]) => [k, new Path2D(d)]));
  return p;
}
function fillPiece(g, piece, ink = INK, paper = PAPER) {
  for (const [k, p] of pathsOf(piece)) {
    g.fillStyle = typeof k === "string" ? k : k % 2 ? paper : ink;
    g.fill(p, typeof k === "number" && k >= 2 ? "evenodd" : "nonzero");
  }
}

// ---------------------------------------------------------------- the camera
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function lens(c, W, H) {
  const f = norm(sub(c.look, c.at)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const focal = H / 2 / Math.tan(c.fov * Math.PI / 360);
  const view = p => { const d = sub(p, c.at); return [dot(d, r), dot(d, u), dot(d, f)]; };
  const screen = v => [W / 2 + v[0] / v[2] * focal, H / 2 - v[1] / v[2] * focal];
  return { f, r, u, at: c.at, focal, W, H, view, screen, project: p => { const v = view(p); return [...screen(v), v[2]]; } };
}
const NEAR = 0.08;
// A polygon in the world, cut at the near plane, on screen (or null).
function onScreen(L, pts) {
  const v = pts.map(L.view), out = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    if (a[2] >= NEAR) out.push(a);
    if ((a[2] >= NEAR) !== (b[2] >= NEAR)) { const k = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]); }
  }
  return out.length >= 3 ? out.map(L.screen) : null;
}

// ---------------------------------------------------------------- colour
const rgb = h => { h = h.replace("#", ""); if (h.length === 3) h = [...h].map(c => c + c).join(""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const shade = (h, k) => "#" + rgb(h).map(v => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------- sets
// Each set as things: box (x, z centre; w, d, h; y base), quad on a wall, disc (a bush, a
// tree's crown, a wheel: a flat circle turned to the camera). Where things are follows
// the 3D sets (stage.mjs BUILD) so marks, seats and doors land on the same furniture.
const box = (x, z, w, d, h, c, o = {}) => ({ kind: "box", x, z, w, d, h, c, y: o.y || 0, ...o });
const disc = (x, y, z, r, c, o = {}) => ({ kind: "disc", x, y, z, r, c, ...o });
// A flat quad in the world: corners in order.
const quad = (pts, c, o = {}) => ({ kind: "quad", pts, c, ...o });
const onBack = (x0, x1, y0, y1, c, o) => quad([[x0, y0, -2.99], [x1, y0, -2.99], [x1, y1, -2.99], [x0, y1, -2.99]], c, { flat: true, ...o });
const onLeft = (z0, z1, y0, y1, c, o) => quad([[-2.99, y0, z1], [-2.99, y0, z0], [-2.99, y1, z0], [-2.99, y1, z1]], c, { flat: true, ...o });
const onRight = (z0, z1, y0, y1, c, o) => quad([[2.99, y0, z0], [2.99, y0, z1], [2.99, y1, z1], [2.99, y1, z0]], c, { flat: true, ...o });

function room({ wall, floor, trim = "#8a6a4a" }, things) {
  return {
    inside: true,
    ground: [quad([[-3, 0, -3], [3, 0, -3], [3, 0, 3], [-3, 0, 3]], floor)],
    walls: [
      quad([[-3, 2.6, -3], [3, 2.6, -3], [3, 2.6, 3], [-3, 2.6, 3]], shade(wall, 0.78), { noline: true }),
      quad([[-3, 0, -3], [3, 0, -3], [3, 2.6, -3], [-3, 2.6, -3]], wall),
      quad([[-3, 0, 3], [-3, 0, -3], [-3, 2.6, -3], [-3, 2.6, 3]], shade(wall, 0.9)),
      quad([[3, 0, -3], [3, 0, 3], [3, 2.6, 3], [3, 2.6, -3]], shade(wall, 0.84)),
      quad([[-3, 0, -2.99], [3, 0, -2.99], [3, 0.12, -2.99], [-3, 0.12, -2.99]], trim, { flat: true }),
      onRight(0.5, 1.5, 0, 2.1, "#3a2c22", { flat: true }),   // the doorway (film.mjs SETS door)
    ],
    things,
  };
}
const window_ = (x, y = 1.0, w = 1.2, h = 1.1, wall = onBack) => [wall(x - w / 2 - 0.06, x + w / 2 + 0.06, y - 0.06, y + h + 0.06, "#f6f1e8"), wall(x - w / 2, x + w / 2, y, y + h, "#9cc8e6", { glass: true })];
const frame = (x, y, w, h, c, wall = onBack) => [wall(x - w / 2 - 0.04, x + w / 2 + 0.04, y - 0.04, y + h + 0.04, "#3b3027"), wall(x - w / 2, x + w / 2, y, y + h, c)];

const SET = {
  "living room": room({ wall: "#e9d8c4", floor: "#caa47c" }, [
    quad([[-1.8, 0.005, -0.9], [0.6, 0.005, -0.9], [0.6, 0.005, 0.5], [-1.8, 0.005, 0.5]], "#c9695b", { flat: true }),
    ...window_(-1), ...frame(0.9, 1.3, 0.8, 0.6, "#e0b24c"),
    box(-0.9, -1.45, 2.1, 0.85, 0.42, "#5f7fa6"), box(-0.9, -1.8, 2.1, 0.2, 0.85, "#5f7fa6"), box(-1.95, -1.45, 0.2, 0.85, 0.62, "#58769b"), box(0.15, -1.45, 0.2, 0.85, 0.62, "#58769b"),
    box(-0.9, -0.1, 1.1, 0.55, 0.38, "#8b5e3c"),
    box(1.2, -1.6, 0.8, 0.8, 0.42, "#d98c5f"), box(1.2, -1.95, 0.8, 0.15, 0.85, "#d98c5f"),
    box(1.9, -2.75, 1.0, 0.4, 1.9, "#8b5e3c"), box(1.9, -2.55, 0.86, 0.02, 0.04, "#e0b24c", { y: 0.62 }), box(1.9, -2.55, 0.86, 0.02, 0.04, "#6aa37a", { y: 1.25 }),
    box(-2.3, -2.3, 0.08, 0.08, 1.4, "#3b3027"), disc(-2.3, 1.55, -2.3, 0.16, "#f3d27a", { lamp: true }),
    box(-2.6, 0.2, 0.5, 1.4, 0.55, "#6b4a33"), box(-2.72, 0.2, 0.06, 1.1, 0.62, "#2b2b2b", { y: 0.62 }),
    box(-2.5, 2.1, 0.4, 0.4, 0.45, "#c9695b"), disc(-2.5, 0.85, 2.1, 0.38, "#5e9460"),
  ]),
  kitchen: room({ wall: "#dfe8e0", floor: "#d8cdb8" }, [
    ...window_(-0.5, 1.45, 1.0, 0.8),
    box(-2.45, -2.62, 0.8, 0.7, 1.9, "#e7e7e3"),
    ...[-1.5, -0.64, 0.22, 1.08, 1.94].map(x => box(x, -2.62, 0.86, 0.7, 0.9, x === -0.64 ? "#cfcfcf" : "#6e9aa8")),
    box(-0.25, -2.62, 4.4, 0.72, 0.04, "#f1ede4", { y: 0.9 }),
    ...[-1.5, 0.22, 1.08, 1.94].map(x => box(x, -2.8, 0.86, 0.38, 0.7, "#6e9aa8", { y: 1.45 })),
    box(-0.6, 0.45, 1.4, 0.85, 0.75, "#b78a5e", { top: 0.05 }),
    box(-1.75, 0.45, 0.45, 0.45, 0.45, "#8b5e3c"), box(-1.95, 0.45, 0.06, 0.45, 0.95, "#8b5e3c"),
    box(0.55, 0.45, 0.45, 0.45, 0.45, "#8b5e3c"), box(0.75, 0.45, 0.06, 0.45, 0.95, "#8b5e3c"),
  ]),
  bedroom: room({ wall: "#e3dbef", floor: "#b99a7a" }, [
    ...window_(0.8, 1.0, 1.1, 1.0), ...frame(-1.2, 1.35, 1.1, 0.5, "#9fb6d8"),
    quad([[-1.2, 0.005, -0.4], [0.6, 0.005, -0.4], [0.6, 0.005, 1.0], [-1.2, 0.005, 1.0]], "#e9c46a", { flat: true }),
    box(-1.2, -1.85, 1.9, 2.1, 0.45, "#f3efe7"), box(-1.2, -1.5, 1.94, 1.4, 0.06, "#7c9cc9", { y: 0.45 }), box(-1.2, -2.85, 1.9, 0.1, 1.0, "#6b4a33"),
    box(-1.6, -2.55, 0.6, 0.35, 0.14, "#ffffff", { y: 0.45 }), box(-0.8, -2.55, 0.6, 0.35, 0.14, "#dfe8f5", { y: 0.45 }),
    box(-2.55, -2.55, 0.5, 0.45, 0.5, "#8b5e3c"), box(0.15, -2.55, 0.5, 0.45, 0.5, "#8b5e3c"), disc(-2.55, 0.72, -2.55, 0.14, "#f3d27a", { lamp: true }),
    box(2.4, -2.4, 0.06, 0.06, 1.75, "#3b3027"),
  ]),
  office: room({ wall: "#e4e1d6", floor: "#9aa3ad" }, [
    ...window_(1.3, 1.0, 1.2, 1.1), box(0.6, -2.7, 1.6, 0.45, 2.0, "#6b4a33"),
    box(0.6, -2.47, 1.5, 0.02, 0.05, "#c9695b", { y: 0.7 }), box(0.6, -2.47, 1.5, 0.02, 0.05, "#5f7fa6", { y: 1.35 }),
    box(-0.8, -1.05, 1.6, 0.8, 0.74, "#6b4a33", { top: 0.05 }),
    box(-1.3, -1.15, 0.55, 0.06, 0.38, "#2b2b2b", { y: 0.78 }),
    box(-0.8, -1.95, 0.5, 0.5, 0.48, "#3b3b3b"), box(-0.8, -2.2, 0.5, 0.08, 1.05, "#3b3b3b"),
    box(-0.8, 0.6, 0.45, 0.45, 0.45, "#8b5e3c"), box(-0.8, 0.8, 0.45, 0.06, 0.95, "#8b5e3c"),
    box(2.5, -2.5, 0.4, 0.4, 0.45, "#c9695b"), disc(2.5, 0.9, -2.5, 0.4, "#5e9460"),
    box(-2.5, -2.4, 0.08, 0.08, 1.5, "#3b3027"), disc(-2.5, 1.62, -2.4, 0.2, "#f3d27a", { lamp: true }),
  ]),
  bar: room({ wall: "#6b3f3a", floor: "#4a3528", trim: "#2a1a14" }, [
    box(-1.4, -2.78, 1.3, 0.35, 2.0, "#3b2a20"), box(0.4, -2.78, 1.3, 0.35, 2.0, "#3b2a20"),
    ...[[-1.9, 0.9], [-1.6, 0.9], [-1.3, 1.45], [0, 0.9], [0.3, 1.45], [0.7, 0.9], [-0.7, 1.45], [-1.05, 0.9], [0.05, 1.45]].map(([x, y], i) => box(x, -2.62, 0.08, 0.08, 0.3, ["#3f7f55", "#b8352c", "#e0b24c"][i % 3], { y })),
    box(-0.3, -1.72, 4.6, 0.6, 1.05, "#7a4b2e", { top: 0.06 }),
    ...[-1.1, -0.3, 0.5].map(x => box(x, -1.3, 0.34, 0.34, 0.05, "#b8352c", { y: 0.72, stool: true })),
    ...[-1.1, -0.3, 0.5].map(x => box(x, -1.3, 0.06, 0.06, 0.72, "#2b2b2b", { stool: true })),
    box(1.9, 0.9, 0.7, 0.7, 0.72, "#7a4b2e", { top: 0.05 }), box(-2.2, 1.3, 0.7, 0.7, 0.72, "#7a4b2e", { top: 0.05 }),
    disc(-2.9, 1.6, -0.5, 0.16, "#f3d27a", { lamp: true }),
  ]),
  street: {
    inside: false, sky: ["#8fc3e8", "#dcecf6"],
    ground: [quad([[-40, 0, -3.5], [40, 0, -3.5], [40, 0, 2.6], [-40, 0, 2.6]], "#b9b4aa"), quad([[-40, 0, 2.6], [40, 0, 2.6], [40, 0, 11], [-40, 0, 11]], "#5b5b60"),
      ...Array.from({ length: 14 }, (_, i) => quad([[-26 + i * 4, 0.003, 6.4], [-24.6 + i * 4, 0.003, 6.4], [-24.6 + i * 4, 0.003, 6.6], [-26 + i * 4, 0.003, 6.6]], "#e8e4d8", { flat: true })),
      quad([[-40, 0.003, 2.55], [40, 0.003, 2.55], [40, 0.003, 2.7], [-40, 0.003, 2.7]], "#8d8880", { flat: true })],
    walls: [],
    things: [
      ...["#c9695b", "#e0b24c", "#6e9aa8", "#b38fbf", "#8fb38a", "#d98c5f", "#c9695b"].map((c, i) => box(-21 + i * 7, -6, 6.4, 4, [9, 12, 8, 14, 10, 11, 9][i], c, { windows: true })),
      box(-2.25, -1.25, 1.8, 0.5, 0.45, "#8b5e3c"), box(-2.25, -1.5, 1.8, 0.08, 0.9, "#8b5e3c"),
      box(4.4, -2.4, 1.6, 1.0, 1.2, "#3f7f55"),
      ...[-9, 8.5].flatMap(x => [box(x, 2.3, 0.12, 0.12, 4.2, "#3b3b3b"), disc(x, 4.3, 2.3, 0.3, "#f3d27a", { lamp: true })]),
      ...[[5.2, "#b8352c"], [-9, "#e0b24c"]].flatMap(([x, c]) => [box(x, 3.8, 4.2, 1.8, 0.8, c, { y: 0.3 }), box(x - 0.2, 3.8, 2.2, 1.6, 0.6, shade(c, 0.9), { y: 1.1, glass: true }),
        disc(x - 1.3, 0.34, 4.72, 0.34, "#222"), disc(x + 1.3, 0.34, 4.72, 0.34, "#222")]),
    ],
  },
  park: {
    inside: false, sky: ["#8fc3e8", "#e4f1f7"],
    ground: [quad([[-60, 0, -40], [60, 0, -40], [60, 0, 20], [-60, 0, 20]], "#86b25f"), quad([[-60, 0.003, 0.6], [60, 0.003, 0.6], [60, 0.003, 1.8], [-60, 0.003, 1.8]], "#d8c49a", { flat: true })],
    walls: [],
    things: [
      box(-0.75, -1.2, 1.8, 0.5, 0.45, "#8b5e3c"), box(-0.75, -1.45, 1.8, 0.08, 0.9, "#8b5e3c"),
      ...[[-4, -5, 1.1], [3, -6, 1.3], [-8, -2, 1.2], [7, -3, 1.0], [10, -9, 1.5], [-11, -9, 1.4], [-6, 7, 1.2], [8, 8, 1.3], [0, -11, 1.6]]
        .flatMap(([x, z, s]) => [box(x, z, 0.3 * s, 0.3 * s, 2.2 * s, "#7a5a3c"), disc(x, 2.6 * s, z, 1.3 * s, "#4f8a4a"), disc(x - 0.6 * s, 2.3 * s, z + 0.1, 0.8 * s, "#5e9a55")]),
      disc(-2.6, 0.45, -2.2, 0.55, "#4f8a4a"), disc(1.5, 0.35, -2.4, 0.45, "#5e9a55"),
      disc(-3, 0.12, -1.8, 0.1, "#d9534f"), disc(2.2, 0.12, -1.9, 0.1, "#f0c040"),
    ],
  },
};

// Light for the time of day: a tint over the whole picture, and lamps that glow at night.
const LIGHT = { day: null, dawn: ["#f7e0d8", 0.0], evening: ["#f4d2ae", 0.35], night: ["#9aa3cc", 1] };

// ---------------------------------------------------------------- drawing the set
function drawQuad(g, L, q, lw, lit) {
  const s = onScreen(L, q.pts);
  if (!s) return;
  g.beginPath(); s.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
  g.fillStyle = q.glass && lit ? "#f6d58a" : q.c; g.fill();
  if (!q.noline) { g.lineWidth = lw(q.pts[0]); g.strokeStyle = INK; g.stroke(); }
}
function boxFaces(b) {
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y, y1 = b.y + b.h;
  return [
    { n: [0, 0, 1], k: 1, pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], front: true },
    { n: [0, 0, -1], k: 0.8, pts: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
    { n: [1, 0, 0], k: 0.86, pts: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
    { n: [-1, 0, 0], k: 0.86, pts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
    { n: [0, 1, 0], k: 1.12, pts: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], top: true },
  ];
}
function drawBox(g, L, b, lw, lit) {
  for (const f of boxFaces(b)) {
    const c = [0, 1, 2].map(i => f.pts.reduce((s, p) => s + p[i], 0) / 4);
    if (dot(f.n, sub(L.at, c)) <= 0) continue;
    drawQuad(g, L, { pts: f.pts, c: shade(b.c, f.k) }, lw);
    if (b.windows && f.front) {
      // Rows of windows on a building's front, lit at night.
      const x0 = b.x - b.w / 2, z = b.z + b.d / 2 + 0.01;
      for (let y = 1.2; y < b.h - 1; y += 2.2) for (let x = x0 + 0.6; x < x0 + b.w - 0.9; x += 1.4)
        drawQuad(g, L, { pts: [[x, y, z], [x + 0.8, y, z], [x + 0.8, y + 1.2, z], [x, y + 1.2, z]], c: "#9cc8e6", glass: true }, lw, lit && ((x * 7 + y * 3) | 0) % 3 !== 0);
    }
    if (b.glass && f.front && lit) drawQuad(g, L, { pts: f.pts, c: "#f6d58a" }, lw);
  }
}
function drawDisc(g, L, d, lw, lit) {
  const [x, y, z] = L.project([d.x, d.y, d.z]);
  if (z < NEAR) return;
  const r = d.r * L.focal / z;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = d.lamp && lit ? "#fff2b8" : d.c; g.fill();
  g.lineWidth = lw([d.x, d.y, d.z]); g.strokeStyle = INK; g.stroke();
}
const depthOf = (L, p) => dot(sub(p, L.at), L.f);

// ---------------------------------------------------------------- acting
// A line's feeling (film.mjs manners) as two faces: mouth shut, and open on a loud syllable.
export const MOOD = { angry: ["Angry", "VeryAngry"], laugh: ["Smile", "SmileBig"], upset: ["Solemn", "Concerned"], quiet: ["Solemn", "Concerned"] };
// Faces a move puts on (a blow, a fall, death) besides the person's own.
export const FACES = ["Explaining", "EyesClosed", "Fear", "Awe"];
// What a person is doing at t, as a drawing and some motion. All of it a function of t.
const clamp01 = x => Math.max(0, Math.min(1, x));
const ease = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
function acting(film, name, t, look, say, line) {
  const tl = film.people[name].timeline, i = segIndex(tl, t), seg = tl[i], o = seg[2];
  const clip = seg[1], speed = o.speed ?? 1, k = Math.max(0, t - seg[0]) * speed;
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const a = { pose: "stand", lean: 0, lunge: 0, hop: 0, lying: 0, nod: 0, shake: 0, face: null, prop: o.prop || null, propAt: "hand", flash: false };
  if (/^Sitting/.test(clip)) {
    a.pose = clip === "Sitting_Enter" ? (k < 0.5 ? "stand" : "sit") : clip === "Sitting_Exit" ? (k < 0.6 ? "sit" : "stand") : "sit";
  } else if (/^(Walk|Jog)/.test(clip)) {
    const jog = /^Jog/.test(clip), f = jog ? 2.6 : 1.8;
    a.pose = "walk"; a.hop = (jog ? 0.05 : 0.025) * Math.abs(Math.sin(k * Math.PI * f)); a.lean = jog ? 0.12 : 0.03 * Math.sin(k * Math.PI * f);
  } else if (clip === "Idle_FoldArms_Loop") a.pose = "arms";
  else if (clip === "Dance_Loop") { a.pose = "dance"; a.lean = 0.1 * Math.sin(k * 4); a.hop = 0.04 * Math.abs(Math.sin(k * 4)); }
  else if (clip === "Crouch_Idle_Loop") a.pose = "squat";
  else if (clip === "PickUp_Table") a.pose = k > 0.35 && k < 0.95 ? "squat" : "point";
  else if (clip === "Jump_Start") a.hop = 0.35 * Math.sin(Math.PI * clamp01((k - 0.2) / 0.7));
  else if (clip === "Idle_Rail_Loop") a.lean = -0.09;
  else if (clip === "Yes") a.nod = 0.16 * Math.sin(k * Math.PI * 3) * (k < 1.6 ? 1 : 0);
  else if (clip === "Idle_No_Loop") a.shake = Math.sin(k * Math.PI * 3.2);
  else if (clip === "Consume") { a.prop = "glass"; a.propAt = k > 0.3 && k < 1.3 ? "mouth" : "hand"; a.pose = a.propAt === "hand" ? "point" : "stand"; }
  else if (clip === "Idle_TalkingPhone_Loop") { a.prop = "phone"; a.propAt = "ear"; }
  else if (/^(Punch_Cross|Push_Loop|OverhandThrow|Interact)$/.test(clip)) { a.pose = "point"; a.lunge = 0.18 * Math.sin(Math.PI * clamp01(clip === "Push_Loop" ? (k % 1.2) / 1.2 : k / 0.8)); }
  else if (/^Pistol/.test(clip)) { a.pose = "point"; a.prop = "gun"; if (clip === "Pistol_Shoot") { a.flash = k > 0.3 && k < 0.42; a.lean = k > 0.3 ? -0.08 * Math.exp(-(k - 0.3) * 6) : 0; } }
  else if (/^Hit_(Head|Chest)$/.test(clip)) { a.lean = -0.25 * Math.sin(Math.PI * clamp01(k / 0.7)); a.face = "Fear"; }
  else if (clip === "Hit_Knockback") { a.lean = -0.3 * Math.sin(Math.PI * clamp01(k / 1.1)); a.lunge = -0.3 * ease(k / 0.6); a.face = "Awe"; }
  else if (clip === "Death01") { a.lying = ease(k / 0.9); a.face = k > 0.9 ? "EyesClosed" : "Fear"; }
  else if (clip === "LayToIdle") a.lying = speed === 0 ? 1 : 1 - ease((k - 0.3) / 1.1);
  else if (clip === "Idle_Talking_Loop") a.pose = Math.sin(k * 1.3 + seed) > 0.35 ? "point" : "stand";
  else if (clip === "ClimbUp_1m") a.pose = "walk";
  // Something held is held up in the raised hand; a phone at the ear.
  if (a.prop && a.propAt === "hand" && a.pose === "stand") a.pose = "point";
  // Drinking while seated is the seat's own clip with a glass: the story's action says when it's at the lips.
  const deed = film.actions.find(([a0, b0, who, move]) => who === name && t >= a0 && t < b0 && /^(drink|eat)$/.test(move));
  if (deed && a.prop === "glass" && a.pose === "sit") a.propAt = t - deed[0] > 0.3 && t < deed[1] - 0.3 ? "mouth" : "hand";
  if (a.prop === "phone") { a.propAt = "ear"; if (a.pose === "point") a.pose = "stand"; }
  // The face: the line's feeling, the mouth open on its loud syllables, and a blink every few seconds.
  const base = look.face;
  const how = line?.[4];
  const [shut, open] = MOOD[how] || [base, "Explaining"];
  if (!a.face) a.face = say > 0.3 ? open : line ? shut : base;
  const phase = (t + (seed % 17) * 0.37) % 4.1;
  if (phase < 0.14 && !(say > 0.3) && a.face !== "EyesClosed") a.face = "EyesClosed";
  return a;
}

// ---------------------------------------------------------------- a person
const drawProp = (g, kind, flash) => {
  g.lineWidth = 9; g.strokeStyle = INK; g.lineJoin = "round";
  if (kind === "glass") {
    g.beginPath(); g.moveTo(-45, -150); g.lineTo(45, -150); g.lineTo(35, 0); g.lineTo(-35, 0); g.closePath();
    g.fillStyle = "#eef6fb"; g.fill();
    g.beginPath(); g.moveTo(-40, -80); g.lineTo(40, -80); g.lineTo(35, 0); g.lineTo(-35, 0); g.closePath(); g.fillStyle = "#e0a040"; g.fill();
    g.beginPath(); g.moveTo(-45, -150); g.lineTo(45, -150); g.lineTo(35, 0); g.lineTo(-35, 0); g.closePath(); g.stroke();
  } else if (kind === "phone") {
    g.beginPath(); g.roundRect(-38, -85, 76, 170, 16); g.fillStyle = "#4a5160"; g.fill(); g.stroke();
    g.beginPath(); g.roundRect(-24, -66, 48, 120, 6); g.fillStyle = "#a8d4ee"; g.fill();
  } else if (kind === "gun") {
    g.fillStyle = INK; g.beginPath(); g.roundRect(-10, -60, 200, 50, 8); g.fill(); g.beginPath(); g.roundRect(-10, -30, 55, 110, 8); g.fill();
    if (flash) { g.fillStyle = "#ffd23a"; g.beginPath(); for (let i = 0; i < 16; i++) { const r = i % 2 ? 40 : 95, an = i / 16 * Math.PI * 2; g.lineTo(290 + Math.cos(an) * r, -35 + Math.sin(an) * r); } g.fill(); }
  }
};
function drawPerson(g, p, look) {
  const body = PEEPS.poses[p.pose], [, , , feet] = body.box;
  g.save();
  g.translate(p.sx, p.sy);
  g.scale(p.scale * p.flip, p.scale);
  // Lying: tipped backwards about the body's middle, which comes down to just above the floor.
  const ly = p.act.lying, m = LIE_MID * ly;
  g.translate(0, -m * (1 - ly) - 200 * ly);
  g.rotate(-ly * Math.PI / 2 + p.act.lean);
  g.translate(-ANCHOR, -(feet - m));
  fillPiece(g, body);
  const hand = p.pose.startsWith("PointingFinger") ? HAND : SIT_HAND[p.pose];
  if (p.act.prop && p.act.propAt === "hand" && hand) {
    g.save(); g.translate(hand[0], hand[1] + (p.act.prop === "gun" ? 40 : 30)); drawProp(g, p.act.prop, p.act.flash); g.restore();
  }
  // The head: turned about the neck for a nod or a shake.
  g.save();
  g.translate(...NECK); g.rotate(p.act.nod + 0.09 * p.act.shake); g.translate(-NECK[0] + 14 * p.act.shake, -NECK[1]);
  fillPiece(g, PEEPS.hair[look.hair] || PEEPS.hair.Short);
  fillPiece(g, PEEPS.faces[p.act.face] || PEEPS.faces.Calm);
  if (look.beard !== "none" && PEEPS.beards[look.beard]) fillPiece(g, PEEPS.beards[look.beard]);
  if (look.glasses !== "none" && PEEPS.glasses[look.glasses]) fillPiece(g, PEEPS.glasses[look.glasses]);
  if (p.act.prop === "phone" && p.act.propAt === "ear") { g.save(); g.translate(190, 400); g.rotate(-0.3); drawProp(g, "phone"); g.restore(); }
  if (p.act.prop === "glass" && p.act.propAt === "mouth") { g.save(); g.translate(430, 470); g.rotate(-0.5); drawProp(g, "glass"); g.restore(); }
  g.restore();
  g.restore();
}

// ---------------------------------------------------------------- the frame
/** Draws the film's picture at t onto stage.ctx (subtitles and fades are stage.mjs's). Returns the shot. */
export function drawFrame(stage, t) {
  const { ctx: g, film, looks, shotAt } = stage;
  const W = g.canvas.width, H = g.canvas.height;
  const info = setAt(film, t), set = SET[info.set] || SET["living room"], places = placesAt(film, t);
  // How loud each speaker is now (a recording's envelope if the test gave one, else the words' syllables).
  const cache = stage.speechCache ||= {}, say = {}, lineOf = {};
  film.lines.forEach((line, i) => {
    const [a, b, who] = line;
    if (!who || t < a || t >= b) return;
    const env = stage.speech?.[i] || (cache[i + ":" + line[3]] ||= textEnvelope(line[3], b - a));
    say[who] = env[Math.min(env.length - 1, Math.floor((t - a) * 24))] || 0;
    lineOf[who] = line;
  });
  // Who is where, doing what, and where their head is (for the camera).
  const people = {};
  for (const [name, pl] of Object.entries(places)) {
    if (pl.off) continue;
    const look = looks[name] || cleanDrawn();
    const act = acting(film, name, t, look, say[name] || 0, lineOf[name]);
    const pose = POSE[act.pose](look.outfit);
    const body = PEEPS.poses[pose], lift = act.pose === "sit" ? (SIT_DROP[pose] ?? 0) : 0;
    const fwd = [Math.sin(pl.facing), Math.cos(pl.facing)];
    const at = [pl.at[0] + fwd[0] * act.lunge, pl.at[1] + fwd[1] * act.lunge];
    const y = pl.lift + lift + act.hop;
    const tall = (body.box[3] - HEAD[1]) * UNIT;
    const headY = y + tall * (1 - act.lying) + 0.25 * act.lying;
    people[name] = { name, look, act, pose, at, y, fwd, head: [at[0], headY, at[1]], facing: pl.facing, stool: pl.lift > 0 };
  }
  const shot = shotAt(t);
  const heads = Object.fromEntries(Object.values(people).map(p => [p.name, p.head]));
  const facing = Object.fromEntries(Object.values(people).map(p => [p.name, p.facing]));
  const pair = Object.keys(film.people).filter(n => heads[n]).slice(0, 2);
  const cam = cameraFor(shot, heads, facing, pair, (SETS[info.set] || SETS["living room"]).wide);
  // A drawn head is big: a close shot a little wider shows their hands too. Someone
  // acting rather than speaking is shot wider still, so the whole move is seen; someone
  // lying down, wide enough for all of them.
  if (shot === "two") cam.fov *= 1.3;
  if (heads[shot]) cam.fov *= people[shot].act.lying > 0.5 ? 2.1 : say[shot] === undefined && people[shot].act.pose !== "stand" ? 1.6 : 1.25;
  const L = lens(cam, W, H);
  const lw = p => Math.max(1, 0.012 * L.focal / Math.max(NEAR, depthOf(L, p)));
  const light = LIGHT[info.light], lit = !!light && light[1] >= 0.35;

  // Sky or the dark beyond the room; then the floor, the walls, and everything in depth order.
  if (set.sky) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, info.light === "night" ? "#0d1430" : set.sky[0]); sky.addColorStop(1, info.light === "night" ? "#24305a" : set.sky[1]);
    g.fillStyle = sky;
  } else g.fillStyle = "#1b1714";
  g.fillRect(0, 0, W, H);
  g.lineJoin = "round";
  for (const q of set.ground) drawQuad(g, L, q, lw);
  for (const q of set.walls) drawQuad(g, L, q, lw, lit);
  const items = [];
  for (const th of set.things) {
    if (th.kind === "quad" && th.flat) { items.push({ d: Infinity, draw: () => drawQuad(g, L, th, lw, lit) }); continue; }
    const c = th.kind === "box" ? [th.x, th.y + th.h / 2, th.z] : th.kind === "disc" ? [th.x, th.y, th.z] : th.pts[0];
    // Seats are under the people on them: a little further back than their middle.
    items.push({ d: depthOf(L, c) + (th.stool ? 0.35 : 0), draw: () => th.kind === "box" ? drawBox(g, L, th, lw, lit) : th.kind === "disc" ? drawDisc(g, L, th, lw, lit) : drawQuad(g, L, th, lw, lit) });
  }
  const drawn = {};
  for (const p of Object.values(people)) {
    const [sx, sy, z] = L.project([p.at[0], p.y, p.at[1]]);
    if (z < NEAR) continue;
    // Facing screen-right unless they face left (the drawings look right). Someone
    // turned to the camera (a close shot) looks toward whoever else is there, so two
    // people talking face each other across the cut, as the 180° rule means them to.
    let right = p.fwd[0] * L.r[0] + p.fwd[1] * L.r[2];
    if (Math.abs(right) < 0.5) {
      const me = L.view([p.at[0], p.y, p.at[1]])[0];
      const other = Object.values(people).filter(q => q !== p).map(q => L.view([q.at[0], q.y, q.at[1]])[0] - me).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
      if (other !== undefined && Math.abs(other) > 0.05) right = Math.sign(other);
    }
    Object.assign(p, { sx, sy, scale: UNIT * L.focal / z, flip: right < -0.05 ? -1 : 1 });
    items.push({ d: z - 0.05, draw: () => drawPerson(g, p, p.look) });
    drawn[p.name] = { hair: p.look.hair, outfit: p.look.outfit, pose: p.pose, face: p.act.face, flip: p.flip, x: sx, y: sy, scale: p.scale, lying: p.act.lying, prop: p.act.prop, propAt: p.act.propAt, head: p.head };
  }
  // Far to near; things flat on a wall (d = Infinity) first.
  items.sort((a, b) => b.d - a.d);
  for (const it of items) it.draw();
  // The time of day over everything.
  if (light) {
    g.save(); g.globalCompositeOperation = "multiply"; g.fillStyle = light[0]; g.fillRect(0, 0, W, H); g.restore();
    if (lit) for (const th of set.things) if (th.lamp) {
      const [x, y, z] = L.project([th.x, th.y, th.z]); if (z < NEAR) continue;
      const r = 1.6 * L.focal / z, glow = g.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, "rgba(255,220,150,.45)"); glow.addColorStop(1, "rgba(255,220,150,0)");
      g.save(); g.globalCompositeOperation = "screen"; g.fillStyle = glow; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
    }
  }
  stage.last = { shot, set: info.set, light: info.light, people: drawn };
  return shot;
}

/** A drawn stage: { drawn: true, paint, ctx, film, looks, shotAt, loop, loadMs, bytes }. */
export function setupDrawn(outCanvas, film, { looks = {}, shotAt, loop = 0, width = 720, height = 1280 } = {}) {
  const t0 = performance.now();
  outCanvas.width = width; outCanvas.height = height;
  const ctx = outCanvas.getContext("2d");
  const stage = { drawn: true, paint: drawFrame, ctx, film, looks: Object.fromEntries(Object.entries(looks).map(([n, l]) => [n, cleanDrawn(l)])), shotAt, loop };
  drawFrame(stage, 0);
  return Object.assign(stage, { loadMs: performance.now() - t0, bytes: JSON.stringify(PEEPS).length });
}
