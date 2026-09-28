// Build Film's "Realistic" people from Microsoft Rocketbox (MIT), docs/film-plan.md.
//
//   PLAYWRIGHT_MODULE=… SKETCH_CHROME=… THREE_DIR=<node_modules/three> \
//     node scripts/film/build-rocketbox.mjs <work dir> web/film/assets/rocketbox
//
// Needs, installed somewhere on NODE_PATH (not in this repo): playwright, three,
// @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//
// Rocketbox ships 3ds Max FBX with 2048² TGA textures (12.6 MB each). This
// downloads each chosen avatar's FBX and colour/opacity textures, converts it in
// a headless browser with three.js (FBXLoader → standard materials, the hair's
// opacity baked into its texture's alpha, centimetres → metres, textures cut to
// 1024 px) and GLTFExporter, then compresses it like the other assets (meshopt
// geometry, WebP textures). Adults only: Film is an adult page and never puts a
// child in it.
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress, meshopt, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { serve } from "../../tests/serve.mjs";

// The same list as web/film.mjs PEOPLE (the page's names for them).
export const AVATARS = {
  Business_Female_01: "Professions", Female_Adult_01: "Adults", Female_Adult_05: "Adults", Female_Adult_10: "Adults",
  Business_Male_04: "Professions", Male_Adult_01: "Adults", Male_Adult_08: "Adults", Police_Male_01: "Professions",
};
const RAW = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars";

const [work, out] = process.argv.slice(2);
if (!out || !process.env.THREE_DIR) { console.error("usage: THREE_DIR=… node scripts/film/build-rocketbox.mjs <work dir> <out dir>"); process.exit(1); }
mkdirSync(work, { recursive: true }); mkdirSync(out, { recursive: true });

// 1. Sources, once.
const curl = (url, to) => execFileSync("curl", ["-sfL", "-o", to, url]);
for (const [id, group] of Object.entries(AVATARS)) {
  const dir = join(work, id), tex = join(dir, "Textures");
  mkdirSync(tex, { recursive: true });
  const fbx = join(dir, id + ".fbx");
  if (!existsSync(fbx)) curl(`${RAW}/${group}/${id}/Export/${id}.fbx`, fbx);
  const names = [...new Set(readFileSync(fbx, "latin1").match(/[A-Za-z0-9_]+_(?:color|opacity_color)\.tga/g) || [])];
  for (const n of names) if (!existsSync(join(tex, n))) curl(`${RAW}/${group}/${id}/Textures/${n}`, join(tex, n));
  console.log(`${id}: ${names.join(", ")}`);
}

// 2. FBX → glTF in a browser, where three's loaders and exporter live.
if (!existsSync(join(work, "three"))) symlinkSync(process.env.THREE_DIR, join(work, "three"));
writeFileSync(join(work, "convert.html"), `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"./three/build/three.module.js","three/addons/":"./three/examples/jsm/"}}</script>
<script type="module">
import * as T from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
const SIZE = 1024;
// A texture as a canvas at SIZE, optionally with another texture's brightness as its alpha.
function canvasOf(tex, alphaTex) {
  const c = document.createElement("canvas"); c.width = c.height = SIZE;
  const g = c.getContext("2d");
  const draw = t => { const im = t.image; if (im.data) { const s = document.createElement("canvas"); s.width = im.width; s.height = im.height;
    s.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(im.data.buffer, im.data.byteOffset, im.data.byteLength), im.width, im.height), 0, 0); return s; } return im; };
  g.drawImage(draw(tex), 0, 0, SIZE, SIZE);
  if (alphaTex) {
    const a = document.createElement("canvas"); a.width = a.height = SIZE; const ag = a.getContext("2d"); ag.drawImage(draw(alphaTex), 0, 0, SIZE, SIZE);
    const px = g.getImageData(0, 0, SIZE, SIZE), ap = ag.getImageData(0, 0, SIZE, SIZE).data;
    for (let i = 0; i < px.data.length; i += 4) px.data[i + 3] = Math.max(ap[i], ap[i + 1], ap[i + 2]);
    g.putImageData(px, 0, 0);
  }
  const t = new T.CanvasTexture(c); t.flipY = tex.flipY; t.colorSpace = T.SRGBColorSpace; t.name = tex.name;
  return t;
}
window.convert = async id => {
  const m = new T.LoadingManager(); m.addHandler(/\\.tga$/i, new TGALoader(m));
  m.setURLModifier(u => /\\.tga$/i.test(u) ? id + "/Textures/" + u.split(/[\\\\/]/).pop() : u);
  const idle = new Promise(r => { m.onLoad = r; });
  const o = await new FBXLoader(m).loadAsync(id + "/" + id + ".fbx");
  await Promise.race([idle, new Promise(r => setTimeout(r, 60000))]);
  o.animations = [];
  o.traverse(x => {
    if (!x.isMesh) return;
    const mats = [].concat(x.material).map(mt => new T.MeshStandardMaterial({
      name: mt.name, map: mt.map ? canvasOf(mt.map, mt.alphaMap) : null, roughness: 0.8, metalness: 0,
      alphaTest: mt.alphaMap ? 0.5 : 0, side: mt.alphaMap ? T.DoubleSide : T.FrontSide }));
    x.material = Array.isArray(x.material) ? mats : mats[0];
  });
  // Centimetres to metres, on a root the page can scale again.
  const root = new T.Group(); root.name = id; o.scale.setScalar(0.01); root.add(o); root.updateMatrixWorld(true);
  const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  let s = ""; const b = new Uint8Array(glb); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
document.title = "ready";
</script>`);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const srv = await serve(work);
const browser = await chromium.launch({ headless: true, ...(process.env.SKETCH_CHROME ? { executablePath: process.env.SKETCH_CHROME } : {}), args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", e => console.error("page:", String(e)));
await page.goto(srv.url + "convert.html");
await page.waitForFunction(() => document.title === "ready");

// 3. Phone-sized, like every other asset.
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
for (const id of Object.keys(AVATARS)) {
  const raw = Buffer.from(await page.evaluate(id => window.convert(id), id), "base64");
  const doc = await io.readBinary(new Uint8Array(raw));
  await doc.transform(dedup(), prune(), weld(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const bytes = await io.writeBinary(doc);
  writeFileSync(join(out, id + ".glb"), bytes);
  console.log(`${id}.glb ${(bytes.length / 1e6).toFixed(2)} MB (from ${(raw.length / 1e6).toFixed(1)} MB)`);
}
await browser.close(); srv.close();
