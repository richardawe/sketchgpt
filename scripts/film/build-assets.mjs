// Build Film's stage-0 assets from the free CC0 packs (docs/film-plan.md).
//
//   node scripts/film/build-assets.mjs <unzipped Quaternius Standard packs> <unzipped Kenney furniture kit> <out dir>
//
// Needs, installed somewhere on NODE_PATH (not in this repo):
//   @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//
// Phone first: textures are cut to 1024 px (normal/roughness 512) and WebP,
// geometry and animation are meshopt-compressed, Kenney's unlit colours become
// lit ones. Every file is CC0; web/film/assets/LICENSE.txt says where it came from.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { NodeIO, Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from "@gltf-transform/extensions";
import { dedup, prune, resample, textureCompress, meshopt, weld, mergeDocuments, unpartition } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const [quat, kenney, out] = process.argv.slice(2);
if (!out) { console.error("usage: node scripts/film/build-assets.mjs <quaternius> <kenney> <out>"); process.exit(1); }
mkdirSync(out, { recursive: true });

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

const BASE = join(quat, "Universal Base Characters[Standard]");
const CHAR = join(BASE, "Base Characters", "Godot - UE");
const HAIR = join(BASE, "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)");
const TEX = [join(BASE, "Base Characters", "Textures"), join(BASE, "Base Characters", "Textures", "Normals Unity - Godot"), join(BASE, "Hairstyles", "Textures")];

// The free pack's .gltf files name some textures it does not ship
// (T_Eye_Normal_png.png, T_Hair_1_Normal.png beside the hair). Find each one
// elsewhere in the pack, or drop the reference — a missing normal map is a
// flatter eye, not a missing character.
function readLoose(path) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  const dir = dirname(path), missing = [];
  for (const im of json.images || []) {
    if (!im.uri || existsSync(join(dir, decodeURIComponent(im.uri)))) continue;
    const want = decodeURIComponent(im.uri).replace(/_png\.png$/, ".png");
    const found = [dir, ...TEX].map(d => join(d, want)).find(existsSync);
    if (found) { im.uri = found; continue; }
    missing.push(im.uri); im.uri = null;
  }
  if (missing.length) {
    const gone = new Set(json.images.map((im, i) => im.uri ? -1 : i).filter(i => i >= 0));
    const deadTex = new Set((json.textures || []).map((t, i) => gone.has(t.source) ? i : -1).filter(i => i >= 0));
    const strip = o => { for (const k of Object.keys(o)) if (o[k] && typeof o[k] === "object") { if (deadTex.has(o[k].index) && "index" in o[k]) delete o[k]; else strip(o[k]); } };
    for (const m of json.materials || []) strip(m);
    console.log(`  ${basename(path)}: no ${missing.join(", ")} in the free pack — dropped`);
  }
  // Absolute uris for the loader: resources are read relative to the json's folder.
  const resources = {};
  for (const b of json.buffers || []) if (b.uri && !b.uri.startsWith("data:")) resources[b.uri] = readFileSync(join(dir, decodeURIComponent(b.uri)));
  for (const im of json.images || []) if (im.uri) { const p = im.uri.startsWith("/") ? im.uri : join(dir, decodeURIComponent(im.uri)); const key = "img/" + basename(p); resources[key] = readFileSync(p); im.uri = key; }
  return io.readJSON({ json, resources });
}

async function shrink(doc, { size = 1024 } = {}) {
  await doc.transform(
    dedup(), prune(), weld(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [size, size], quality: 82, slots: /baseColor|emissive/i }),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [size / 2, size / 2], quality: 82, slots: /normal|metallicRoughness|occlusion/i }),
  );
  return doc;
}

async function write(doc, name, { compress = true } = {}) {
  if (compress) await doc.transform(resample(), unpartition(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const bytes = await io.writeBinary(doc);
  writeFileSync(join(out, name), bytes);
  console.log(`${name}: ${(bytes.length / 1e6).toFixed(2)} MB`);
}

// People: the free tier has two bodies (Superhero female, male). Hair is its own
// file, skinned to the same Head bone, so any hair goes on any body at runtime.
for (const [src, name] of [["Superhero_Female_FullBody.gltf", "woman.glb"], ["Superhero_Male_FullBody.gltf", "man.glb"]]) {
  const doc = await shrink(await readLoose(join(CHAR, src)));
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  await write(doc, name);
}
for (const [src, name] of [["Hair_Long.gltf", "hair-long.glb"], ["Hair_SimpleParted.gltf", "hair-parted.glb"], ["Hair_Beard.gltf", "beard.glb"], ["Hair_Buns.gltf", "hair-buns.glb"]]) {
  const doc = await shrink(await readLoose(join(HAIR, src)), { size: 512 });
  await write(doc, name);
}

// Movement: both free animation libraries, without the mannequin mesh. Root
// motion off (the page moves people), T-pose dropped.
for (const [src, name] of [["Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb", "moves-1.glb"], ["Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb", "moves-2.glb"]]) {
  const doc = await io.read(join(quat, src));
  const root = doc.getRoot();
  for (const n of root.listNodes()) if (n.getMesh()) n.setMesh(null).setSkin(null);
  for (const a of root.listAnimations()) if (/TPose/i.test(a.getName())) a.dispose();
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  await doc.transform(prune({ keepLeaves: true }));
  await write(doc, name);
}

// A room: Kenney's furniture kit, the pieces a living room needs, one file,
// each piece a named root node the page clones. Unlit flat colours become lit
// (MeshStandardMaterial) so the room takes the same light as the people.
const PIECES = ["floorFull", "wall", "wallWindow", "wallDoorway", "loungeSofa", "loungeChair", "tableCoffee", "rugRectangle",
  "lampRoundFloor", "bookcaseOpen", "pottedPlant", "sideTable", "televisionModern", "cabinetTelevision", "books", "doorway", "kitchenBar", "stoolBar", "ceilingFan"];
const room = new Document();
const kdir = join(kenney, "Models", "GLTF format");
for (const p of PIECES) {
  const piece = await io.read(join(kdir, p + ".glb"));
  const scene = piece.getRoot().getDefaultScene() || piece.getRoot().listScenes()[0];
  for (const n of scene.listChildren()) n.setName(p);
  mergeDocuments(room, piece);
}
const [first, ...rest] = room.getRoot().listScenes();
for (const s of rest) { for (const n of s.listChildren()) first.addChild(n); s.dispose(); }
for (const b of room.getRoot().listBuffers().slice(1)) b.dispose();
for (const acc of room.getRoot().listAccessors()) acc.setBuffer(room.getRoot().listBuffers()[0]);
for (const m of room.getRoot().listMaterials()) m.setExtension("KHR_materials_unlit", null).setRoughnessFactor(0.85).setMetallicFactor(0);
room.getRoot().listExtensionsUsed().filter(e => e instanceof KHRMaterialsUnlit).forEach(e => e.dispose());
await room.transform(dedup(), prune());
await write(room, "room.glb");

console.log("\n" + readdirSync(out).join(" "));
