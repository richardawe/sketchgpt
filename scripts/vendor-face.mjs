// Regenerate web/vendor/ for Selfie mode: LiteRT.js (the .tflite runtime),
// MediaPipe's four models, and gifenc. Everything is Apache-2.0 or MIT.
//
//   node scripts/vendor-face.mjs
//
// MediaPipe's own JavaScript runtime (@mediapipe/tasks-vision) is NOT used:
// its bundle posts usage statistics to odml.pa.googleapis.com from every
// task it creates. The models are only weights and do not log; LiteRT.js
// fetches only the files it is given. tests/face.test.mjs greps the vendored
// code for known logging endpoints.
//
// Changes to upstream files, all mechanical:
//   - "//# sourceMappingURL" lines dropped (the maps are not shipped);
//   - litert.mjs imports ./wasm-utils.mjs instead of "@litertjs/wasm-utils";
//   - face_landmarks_detector.tflite: the batch dimension of its tensors'
//     shape_signature is 1 instead of -1. LiteRT.js has no way to resize a
//     dynamic input and refuses a [1,256,256,3] tensor against [-1,...].
//     Four int32s change; no weight is touched.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const LITERT = "2.5.3", GIFENC = "1.0.3";
const MODELS = "https://storage.googleapis.com/mediapipe-models";
const out = new URL("../web/vendor/", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "vendor-face-"));
const sh = cmd => execSync(cmd, { cwd: tmp, stdio: ["ignore", "pipe", "inherit"] }).toString();
const npm = (pkg, ver, dir) => { mkdirSync(join(tmp, dir)); sh(`curl -fsSL https://registry.npmjs.org/${pkg}/-/${pkg.split("/").pop()}-${ver}.tgz | tar xz -C ${dir}`); return join(tmp, dir, "package"); };
const noMap = s => s.replace(/^\/\/# sourceMappingURL=.*$/m, "");

mkdirSync(join(out, "litert"), { recursive: true });
mkdirSync(join(out, "models"), { recursive: true });
const lt = npm("@litertjs/core", LITERT, "core"), wu = npm("@litertjs/wasm-utils", LITERT, "wu"), ge = npm("gifenc", GIFENC, "ge");
writeFileSync(join(out, "litert/litert.mjs"), noMap(readFileSync(join(lt, "dist/index.js"), "utf8")).replace('from "@litertjs/wasm-utils"', 'from "./wasm-utils.mjs"'));
writeFileSync(join(out, "litert/wasm-utils.mjs"), noMap(readFileSync(join(wu, "dist/index.js"), "utf8")));
for (const f of ["litert_wasm_internal", "litert_wasm_compat_internal"])
  for (const ext of [".js", ".wasm"]) writeFileSync(join(out, "litert", f + ext), readFileSync(join(lt, "wasm", f + ext)));
writeFileSync(join(out, "gifenc.mjs"), noMap(readFileSync(join(ge, "dist/gifenc.esm.js"), "utf8")));

sh(`curl -fsSL -o task.zip ${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task && python3 -c "import zipfile; zipfile.ZipFile('task.zip').extractall('task')"`);
writeFileSync(join(out, "models/face_detector.tflite"), readFileSync(join(tmp, "task/face_detector.tflite")));
const lm = readFileSync(join(tmp, "task/face_landmarks_detector.tflite"));
let fixed = 0;
for (const dims of [[256, 256, 3], [1, 1, 1434], [1, 1, 1], [1]]) {
  const pat = Buffer.alloc(4 * (dims.length + 2));
  pat.writeInt32LE(dims.length + 1, 0); pat.writeInt32LE(-1, 4);
  dims.forEach((d, i) => pat.writeInt32LE(d, 8 + 4 * i));
  for (let i = lm.indexOf(pat); i >= 0; i = lm.indexOf(pat, i + 1)) { lm.writeInt32LE(1, i + 4); fixed++; }
}
if (fixed < 2) throw new Error(`expected to fix the batch dimension, fixed ${fixed}`);
writeFileSync(join(out, "models/face_landmarks_detector.tflite"), lm);
sh(`curl -fsSL -o ${join(out, "models/hair_segmenter.tflite")} ${MODELS}/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite`);
sh(`curl -fsSL -o ${join(out, "models/selfie_segmenter.tflite")} ${MODELS}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`);
console.log(`vendored into ${out} (batch dimension fixed in ${fixed} shape signatures)`);
