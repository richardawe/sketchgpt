// What the free Quaternius tiers actually contain (docs/film-plan.md, stage 0).
// The kits say "60–70% of the pack"; this reads the files and says which 60–70%.
//
//   node scripts/film/inventory.mjs <folder with the unzipped Standard packs>
//
// Reads glTF/GLB JSON only (no dependencies): every animation's name and
// length, every mesh's triangle count, bone names, morph targets, textures.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";

const root = process.argv[2];
if (!root) { console.error("usage: node scripts/film/inventory.mjs <folder>"); process.exit(1); }

const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

function readGltf(path) {
  const buf = readFileSync(path);
  if (extname(path) === ".glb") {
    const len = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
    const binStart = 20 + len;
    const bin = binStart + 8 <= buf.length ? buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart)) : null;
    return { json, bin: () => bin };
  }
  const json = JSON.parse(buf.toString("utf8"));
  return { json, bin: () => json.buffers?.[0]?.uri && !json.buffers[0].uri.startsWith("data:") ? readFileSync(join(dirname(path), json.buffers[0].uri)) : null };
}

// An animation's length: the largest max of its input (time) accessors.
function animLength(json, anim) {
  return Math.max(0, ...anim.samplers.map(s => json.accessors[s.input].max?.[0] ?? 0));
}

function triangles(json, mesh) {
  return mesh.primitives.reduce((n, p) => {
    const count = p.indices != null ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count;
    return n + ((p.mode ?? 4) === 4 ? count / 3 : 0);
  }, 0);
}

// Image size from PNG/JPEG headers, without decoding.
function imageSize(b) {
  if (!b) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const k = b.toString("latin1", 12, 16);
    if (k === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (k === "VP8L") { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
    if (k === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], l = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + l;
    }
  }
  return null;
}

function images(path, json, bin) {
  return (json.images || []).map(im => {
    let bytes = null;
    if (im.bufferView != null && bin()) { const v = json.bufferViews[im.bufferView]; bytes = bin().subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength); }
    else if (im.uri && !im.uri.startsWith("data:")) { try { bytes = readFileSync(join(dirname(path), decodeURIComponent(im.uri))); } catch {} }
    const s = imageSize(bytes);
    return `${im.name || im.uri || "embedded"}${s ? ` ${s[0]}×${s[1]}` : ""}`;
  });
}

const files = walk(root).filter(p => /\.(gltf|glb)$/i.test(p) && !/Origin at 0/.test(p)).sort();
for (const path of files) {
  const { json, bin } = readGltf(path);
  const meshes = (json.meshes || []).map(m => ({ name: m.name, tris: triangles(json, m), morphs: m.extras?.targetNames || (m.primitives[0].targets ? m.primitives[0].targets.length + " unnamed" : null) }));
  const bones = [...new Set((json.skins || []).flatMap(s => s.joints.map(j => json.nodes[j].name)))];
  const anims = (json.animations || []).map(a => [a.name, animLength(json, a)]);
  console.log(`\n## ${relative(root, path)}  (${(statSync(path).size / 1e6).toFixed(1)} MB)`);
  if (meshes.length) console.log(`meshes: ${meshes.map(m => `${m.name} ${m.tris} tris${m.morphs ? ` morphs[${m.morphs}]` : ""}`).join("; ")}`);
  console.log(`triangles total: ${meshes.reduce((n, m) => n + m.tris, 0)}`);
  if (bones.length) console.log(`bones (${bones.length}): ${bones.join(" ")}`);
  const ims = images(path, json, bin); if (ims.length) console.log(`images: ${ims.join("; ")}`);
  if (anims.length) console.log(`animations (${anims.length}, ${anims.reduce((n, [, t]) => n + t, 0).toFixed(0)} s): ${anims.map(([n, t]) => `${n} ${t.toFixed(2)}s`).join(", ")}`);
}
