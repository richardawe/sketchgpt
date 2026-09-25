// A page of a moving book as an animated GIF, made in the tab (stage 6).
//
// The pictures move with the Web Animations API on live SVG (web/animate.mjs),
// and a GIF needs frames. So every animation on the page is paused and
// stepped through time; at each step the pose each element is in — its
// computed transform and opacity — is copied onto a copy of the SVG, the copy
// is drawn to a canvas, and the frames are encoded with gifenc (MIT, already
// vendored for selfie.html). The page's words go under the picture, so a GIF
// sent on its own is still a page of a book.
//
// Two things a GIF cannot carry: the voice (a browser cannot record the
// device's speech — docs/story-rules.md), and the slow camera move, which is
// left out so the frames loop cleanly.

const INK = "#2b2622", PAPER = "#fbf6ea";

// The words under the picture, wrapped to the width.
function caption(ctx, text, x, y, width, lineHeight) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? line + " " + word : word;
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return lines.length;
}

// One pose of the live SVG, as a standalone SVG string.
function pose(svg) {
  const copy = svg.cloneNode(true);
  const live = [svg, ...svg.querySelectorAll("*")], still = [copy, ...copy.querySelectorAll("*")];
  live.forEach((el, i) => {
    if (i === 0 || !el.getAnimations || !el.getAnimations().length) return;
    const cs = getComputedStyle(el), st = still[i].style;
    st.transform = cs.transform === "none" ? "" : cs.transform;
    st.transformOrigin = cs.transformOrigin;
    st.transformBox = cs.transformBox;
    st.opacity = cs.opacity;
  });
  copy.style.transform = "";              // the camera is left out
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(copy);
}

async function draw(ctx, xml, size) {
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  await img.decode();
  ctx.drawImage(img, 0, 0, size, size);
}

/**
 * The GIF of one page: its picture, moving, with its words underneath.
 * Returns a Blob. The page's animations are left as they were found.
 */
export async function pageGif(svg, text, { size = 360, frames = 20, loopMs = 2400, from = 2200 } = {}) {
  const { GIFEncoder, quantize, applyPalette } = await import("./vendor/gifenc.mjs");
  const anims = [svg, ...svg.querySelectorAll("*")].flatMap(el => el.getAnimations ? el.getAnimations() : []);
  const was = anims.map(a => [a, a.currentTime, a.playState]);
  anims.forEach(a => a.pause());
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // How much room the words need, measured once.
  ctx.font = `${Math.round(size / 20)}px Georgia, serif`;
  const lineHeight = Math.round(size / 15);
  const lines = caption({ measureText: t => ctx.measureText(t), fillText() {} }, text, 0, 0, size - 32, lineHeight);
  canvas.width = size; canvas.height = size + (text ? lines * lineHeight + 28 : 0);
  const gif = GIFEncoder();
  try {
    for (let i = 0; i < frames; i++) {
      const t = from + i * loopMs / frames;
      for (const a of anims) a.currentTime = t;
      ctx.fillStyle = PAPER; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await draw(ctx, pose(svg), size);
      if (text) {
        ctx.fillStyle = INK; ctx.font = `${Math.round(size / 20)}px Georgia, serif`; ctx.textBaseline = "top";
        caption(ctx, text, 16, size + 14, size - 32, lineHeight);
      }
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const palette = quantize(data, 128);
      gif.writeFrame(applyPalette(data, palette), canvas.width, canvas.height, { palette, delay: Math.round(loopMs / frames) });
    }
  } finally {
    for (const [a, time, state] of was) { a.currentTime = time; if (state === "running") a.play(); }
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}
