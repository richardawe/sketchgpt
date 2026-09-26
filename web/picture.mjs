// A picture of your own as the hero — a pet, a child's drawing, or a photo of
// a person cut out — drawn on every page of the book in place of the hero's
// illustration (docs/story-rules.md, stage 5).
//
// Everything happens in this tab. The picture is kept for this tab only
// (sessionStorage), never stored for good, never sent, and never put in a
// share link: a link carries the hero's kind ("dog"), and whoever opens it
// sees the drawn dog. A photo is not a drawing — only the caricature from
// selfie.html can travel in a link, and only when the person says so.
//
// The pixel rules below are pure (arrays in, arrays out), so they are tested
// without a browser (tests/picture.test.mjs).

// Pictures are made small: a hero is at most ~150 px tall on a page, and the
// picture lives in sessionStorage.
export const MAX_SIDE = 360;

/**
 * A drawing on paper, with the paper taken away: every pixel connected to the
 * border that is close to the paper's colour becomes transparent. Connected,
 * not just close — a white cat inside a black outline keeps its white.
 * rgba is a Uint8ClampedArray (w×h×4), changed in place. Returns how much of
 * the picture was paper (0..1).
 */
export function removePaper(rgba, w, h, tolerance = 58) {
  // The paper's colour: the median of the border.
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const med = c => { const v = border.map(i => rgba[i * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const paper = [med(0), med(1), med(2)];
  const near = i => Math.abs(rgba[i * 4] - paper[0]) + Math.abs(rgba[i * 4 + 1] - paper[1]) + Math.abs(rgba[i * 4 + 2] - paper[2]) < tolerance;
  const seen = new Uint8Array(w * h);
  const stack = border.filter(near);
  let n = 0;
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || !near(i)) continue;
    seen[i] = 1; n++;
    rgba[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w); if (y < h - 1) stack.push(i + w);
  }
  return n / (w * h);
}

/** Is the border mostly one light colour? Then it is probably paper. */
export function looksLikePaper(rgba, w, h) {
  let light = 0, total = 0;
  const at = i => { total++; const l = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
    const spread = Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) - Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    if (l > 200 && spread < 40) light++; };
  for (let x = 0; x < w; x += 2) { at(x); at((h - 1) * w + x); }
  for (let y = 0; y < h; y += 2) { at(y * w); at(y * w + w - 1); }
  return light / total > 0.8;
}

/** A person, from the segmenter's confidence (0..1 per pixel): the rest goes. */
export function keepPerson(rgba, conf, threshold = 0.5) {
  let n = 0;
  for (let i = 0; i < conf.length; i++) {
    const c = conf[i];
    // A soft edge, not a staircase: 0.35..0.65 fades.
    const a = c >= threshold + 0.15 ? 1 : c <= threshold - 0.15 ? 0 : (c - threshold + 0.15) / 0.3;
    rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * a);
    if (a > 0.5) n++;
  }
  return n / conf.length;
}

/** The box around everything that is not transparent, or null if nothing is. */
export function contentBox(rgba, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] > 24) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A picture as a figure the renderer draws like the caricature (sketch.mjs drawFigure). */
export function figureOf(url, w, h) {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) throw new Error("Not a picture.");
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><image href="${url}" width="${w}" height="${h}"/></svg>`, w, h };
}

// ---- In the browser ------------------------------------------------------------

/** A file (a photo or a scan) as a small canvas, the right way up. */
export async function readPicture(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("That is not a picture.");
  if (file.size > 25e6) throw new Error("That picture is too big (over 25 MB).");
  const img = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  img.close && img.close();
  return c;
}

/**
 * The picture made ready to be a hero: "paper" takes a drawing's paper away,
 * "person" cuts a person out (MediaPipe's person segmenter, on LiteRT — the
 * same one selfie.html uses; about 13 MB the first time), "keep" keeps it as
 * it is, with rounded corners. Returns { url, w, h, said }.
 */
export async function prepare(source, how) {
  const w = source.width, h = source.height;
  const ctx = source.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  let said = "";
  if (how === "paper") {
    const share = removePaper(img.data, w, h);
    said = share < 0.05 ? "Hardly any plain background was found, so the picture is nearly as it was." : "The paper was taken away.";
  } else if (how === "person") {
    const find = await import("./face-find.mjs?v=1");
    const finder = await find.loadFinder();
    const conf = await find.findPerson(finder, source, w, h);
    const share = keepPerson(img.data, conf);
    if (share < 0.02) throw new Error("No person was found in that picture. Try another, or keep it as it is.");
    said = "The person was cut out.";
  } else {
    // Rounded corners: a sticker.
    const r = Math.min(w, h) * 0.08;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = Math.max(r - x, x - (w - 1 - r), 0), dy = Math.max(r - y, y - (h - 1 - r), 0);
      if (dx * dx + dy * dy > r * r) img.data[(y * w + x) * 4 + 3] = 0;
    }
  }
  const box = contentBox(img.data, w, h);
  if (!box) throw new Error("Nothing was left of that picture. Try keeping it as it is.");
  const out = document.createElement("canvas");
  out.width = box.w; out.height = box.h;
  const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h;
  tmp.getContext("2d").putImageData(img, 0, 0);
  out.getContext("2d").drawImage(tmp, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return { url: out.toDataURL("image/png"), w: box.w, h: box.h, said };
}
