// A whole book as a video, made in the tab: the cover, every page with its
// picture moving and its words underneath, and The End (the owner: "have the
// option to make this a video and not a gif").
//
// Frames are made the way web/gif.mjs makes them — each picture's
// animations paused and stepped through time, each pose copied onto a copy
// of the SVG and drawn to a canvas — but here the camera's slow move is kept,
// each page fades in, and the frames go to WebCodecs through Mediabunny
// (MPL-2.0, vendored in vendor/mediabunny.mjs, only its MP4/WebM writer). No
// server, nothing uploaded, faster than real time.
//
// MP4 (H.264) where the browser can encode it — Chrome, Edge and Safari do,
// and it plays everywhere, iPhones and chat apps included — else WebM (VP9).
// Silent: a browser cannot record the device's voice (docs/story-rules.md).
import { pose, draw, caption, animationsOf } from "./gif.mjs?v=2";

const INK = "#2b2622", PAPER = "#fbf6ea", MUTED = "#7d7369";

/** What this browser can make: { codec, format, ext, type }, or null for no video at all. */
export async function videoSupport(width = 540, height = 720) {
  if (typeof VideoEncoder === "undefined") return null;
  const mb = await import("./vendor/mediabunny.mjs");
  for (const [codec, format, ext, type] of [["avc", "Mp4OutputFormat", "mp4", "video/mp4"], ["vp9", "WebMOutputFormat", "webm", "video/webm"]])
    try { if (await mb.canEncodeVideo(codec, { width, height, bitrate: 1.5e6 })) return { codec, format, ext, type }; } catch {}
  return null;
}

// The words, as large as fit in the band under the picture.
function words(ctx, text, x, y, width, height, max) {
  for (let size = max; size >= 14; size -= 2) {
    ctx.font = `${size}px Georgia, "Iowan Old Style", serif`;
    const lh = Math.round(size * 1.35);
    const lines = caption({ measureText: t => ctx.measureText(t), fillText() {} }, text, 0, 0, width, lh);
    if (lines * lh <= height || size === 14) {
      const top = y + Math.max(0, (height - lines * lh) / 2);
      ctx.textBaseline = "top"; ctx.fillStyle = INK; ctx.textAlign = "left";
      caption(ctx, text, x, top, width, lh);
      return;
    }
  }
}

/**
 * The book (a `.book` element as showBook lays it out) as a video Blob.
 * onProgress(0..1) is called as frames are made.
 */
export async function bookVideo(book, { size = 540, fps = 15, pageMs = 4000, endMs = 2500, onProgress = () => {} } = {}) {
  const support = await videoSupport(size, Math.round(size * 4 / 3));
  if (!support) throw new Error("This browser cannot make videos. The GIF of a page still works.");
  const mb = await import("./vendor/mediabunny.mjs");
  const W = size, H = Math.round(size * 4 / 3), band = H - W;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const output = new mb.Output({ format: new mb[support.format](support.ext === "mp4" ? { fastStart: "in-memory" } : {}),
    target: new mb.BufferTarget() });
  const source = new mb.CanvasSource(canvas, { codec: support.codec, bitrate: mb.QUALITY_MEDIUM });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const sheets = [...book.querySelectorAll(".sheet")];
  const frameMs = 1000 / fps;
  const plan = sheets.map(s => ({ s, svg: s.querySelector(".art svg"), n: Math.round((s.querySelector(".art svg") ? pageMs : endMs) / frameMs) }));
  const total = plan.reduce((a, p) => a + p.n, 0);
  let done = 0, t = 0;
  for (const { s, svg, n } of plan) {
    const text = s.classList.contains("cover") ? (s.querySelector("h2") || {}).textContent || "" :
      s.classList.contains("end") ? "" : (s.querySelector(".page-text") || {}).textContent || "";
    const anims = svg ? animationsOf(svg) : [];
    const was = anims.map(a => [a, a.currentTime, a.playState]);
    anims.forEach(a => a.pause());
    try {
      for (let f = 0; f < n; f++) {
        const ms = f * frameMs;
        for (const a of anims) a.currentTime = ms;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
        if (svg) {
          // The camera: the picture element's own scale, about its origin.
          const cs = getComputedStyle(svg);
          const m = cs.transform && cs.transform !== "none" ? new DOMMatrix(cs.transform) : null;
          const box = svg.getBoundingClientRect();
          const [ox, oy] = (cs.transformOrigin || "0 0").split(" ").map(v => parseFloat(v) / (box.width / (m ? m.a : 1) || 1));
          ctx.save();
          ctx.beginPath(); ctx.rect(0, 0, W, W); ctx.clip();
          if (m) { ctx.translate(ox * W, oy * W); ctx.scale(m.a, m.d); ctx.translate(-ox * W, -oy * W); }
          await draw(ctx, pose(svg), W);
          ctx.restore();
          if (s.classList.contains("cover")) {
            ctx.textAlign = "center"; ctx.fillStyle = INK; ctx.textBaseline = "middle";
            ctx.font = `bold ${Math.round(W / 15)}px Georgia, serif`;
            const lh = Math.round(W / 12);
            const lines = caption({ measureText: x => ctx.measureText(x), fillText() {} }, text, 0, 0, W - 60, lh);
            caption({ measureText: x => ctx.measureText(x), fillText: (l, x, y) => ctx.fillText(l, W / 2, y) },
              text, 0, W + band / 2 - (lines - 1) * lh / 2, W - 60, lh);
          } else words(ctx, text, 32, W + 14, W - 64, band - 28, Math.round(W / 20));
        } else {
          ctx.textAlign = "center"; ctx.fillStyle = INK; ctx.textBaseline = "middle";
          ctx.font = `italic ${Math.round(W / 11)}px Georgia, serif`;
          ctx.fillText("The End", W / 2, H / 2 - 20);
          ctx.fillStyle = MUTED; ctx.font = `${Math.round(W / 34)}px Georgia, serif`;
          ctx.fillText("Made with sketchgpt, on this device", W / 2, H / 2 + 40);
          ctx.fillText("Illustrations: Twemoji (CC-BY 4.0), Fluent Emoji (MIT)", W / 2, H / 2 + 68);
        }
        // Each page fades in from paper.
        const fade = Math.max(0, 1 - f / 6);
        if (fade > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = fade; ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
        await source.add(t / 1000, frameMs / 1000);
        t += frameMs;
        if (++done % 10 === 0) onProgress(done / total);
      }
    } finally {
      for (const [a, time, state] of was) { a.currentTime = time; if (state === "running") a.play(); }
    }
  }
  await output.finalize();
  onProgress(1);
  return new Blob([output.target.buffer], { type: support.type });
}
