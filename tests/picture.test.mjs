// A picture of your own as the hero (web/picture.mjs): the pixel rules.
//
//   node --test tests/picture.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { removePaper, looksLikePaper, keepPerson, contentBox, figureOf } from "../web/picture.mjs";

// A w×h picture: paper everywhere, with an ink ring (a drawn cat's outline)
// around a white middle — the white inside must survive.
function drawing(w = 40, h = 40, paper = [250, 248, 240]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, d = Math.hypot(x - 20, y - 20);
    const c = d >= 8 && d <= 11 ? [20, 20, 20] : d < 8 ? [255, 255, 255] : paper;
    px.set([...c, 255], i);
  }
  return px;
}
const alpha = (px, w, x, y) => px[(y * w + x) * 4 + 3];

test("the paper goes; a white inside an outline stays", () => {
  const px = drawing();
  const share = removePaper(px, 40, 40);
  assert.ok(share > 0.6, `only ${share} was paper`);
  assert.equal(alpha(px, 40, 0, 0), 0, "a corner of paper is left");
  assert.equal(alpha(px, 40, 20, 20), 255, "the white inside the outline was taken as paper");
  assert.equal(alpha(px, 40, 30, 20), 255, "the outline was taken");
});

test("a photo is not paper; a drawing on paper is", () => {
  assert.equal(looksLikePaper(drawing(), 40, 40), true);
  const photo = new Uint8ClampedArray(40 * 40 * 4);
  for (let i = 0; i < 1600; i++) photo.set([(i * 37) % 200, (i * 91) % 180, (i * 13) % 160, 255], i * 4);
  assert.equal(looksLikePaper(photo, 40, 40), false);
});

test("a person cut out: the rest goes, with a soft edge", () => {
  const px = new Uint8ClampedArray(4 * 4).fill(255);
  const share = keepPerson(px, Float32Array.from([0, 0.5, 0.9, 1]));
  assert.deepEqual([3, 7, 11, 15].map(i => px[i]), [0, 128, 255, 255]);
  assert.equal(share, 0.5);
});

test("the picture is trimmed to what is left of it", () => {
  const px = drawing();
  removePaper(px, 40, 40);
  assert.deepEqual(contentBox(px, 40, 40), { x: 9, y: 9, w: 23, h: 23 });
  assert.equal(contentBox(new Uint8ClampedArray(16), 2, 2), null);
});

test("a figure holds only a picture", () => {
  const f = figureOf("data:image/png;base64,iVBORw0KGgo=", 30, 40);
  assert.match(f.svg, /^<svg [^>]*viewBox="0 0 30 40"><image href="data:image\/png;base64,iVBORw0KGgo=" width="30" height="40"\/><\/svg>$/);
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AA" onload="x', 'data:text/html;base64,AA', 'https://example.com/a.png'])
    assert.throws(() => figureOf(bad, 1, 1), /Not a picture/, bad);
});
