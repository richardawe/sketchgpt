// Regenerate Film's vendored bundles (docs/film-plan.md):
//   web/vendor/three.mjs            three.js 0.186.1 (MIT) + GLTFLoader, HDRLoader, meshopt decoder, SkeletonUtils.clone
//   web/vendor/mediabunny-film.mjs  Mediabunny 1.60.0 (MPL-2.0): Book's writer plus the audio path (AudioBufferSource)
//
//   npm i --no-save --prefix <scratch> three@0.186.1 mediabunny@1.60.0 esbuild
//   NODE_PATH=<scratch>/node_modules node scripts/film/vendor.mjs <scratch>
//
// Book keeps its own vendor/mediabunny.mjs untouched, so nothing it caches changes.
// tests/face.test.mjs scans every vendored file for logging endpoints.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const scratch = process.argv[2];
if (!scratch) { console.error("usage: node scripts/film/vendor.mjs <scratch with node_modules>"); process.exit(1); }
const esbuild = createRequire(join(scratch, "x.js"))("esbuild");
const out = new URL("../../web/vendor/", import.meta.url).pathname;

const entries = {
  "three.mjs": `export * from "three";
export { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
export { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
export { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
export { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";`,
  "mediabunny-film.mjs": `export { Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource, AudioBufferSource, QUALITY_MEDIUM, canEncodeVideo, canEncodeAudio } from "mediabunny";`,
};
for (const [name, src] of Object.entries(entries)) {
  const entry = join(scratch, "entry-" + name);
  writeFileSync(entry, src);
  const r = await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", minify: true, legalComments: "inline",
    outfile: join(out, name), absWorkingDir: scratch, metafile: true });
  console.log(name, Object.values(r.metafile.outputs)[0].bytes, "bytes");
}
