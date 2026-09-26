// Build Film's stage-0 assets from the free CC0 packs (docs/film-plan.md).
//
//   node scripts/film/build-assets.mjs <unzipped Quaternius Standard packs> <unzipped Kenney furniture kit> <out dir> [<folder of unzipped Kenney city-kit-roads, city-kit-commercial_2.1, car-kit, nature-kit, food-kit>]
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
for (const [src, name] of [["Hair_Long.gltf", "hair-long.glb"], ["Hair_SimpleParted.gltf", "hair-parted.glb"], ["Hair_Beard.gltf", "beard.glb"], ["Hair_Buns.gltf", "hair-buns.glb"],
  ["Hair_Buzzed.gltf", "hair-buzzed.glb"], ["Hair_BuzzedFemale.gltf", "hair-buzzed-female.glb"]]) {
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

// Kits of pieces: each file holds named root nodes the page clones and places
// (web/film/stage.mjs). Unlit flat colours become lit (MeshStandardMaterial)
// so the sets take the same light as the people.
async function kit(name, dir, pieces, { textures = 256 } = {}) {
  const doc = new Document();
  for (const p of pieces) {
    const piece = await io.read(join(dir, p + ".glb"));
    const scene = piece.getRoot().getDefaultScene() || piece.getRoot().listScenes()[0];
    // One root per piece, named for it, whatever the source's own node tree.
    const holder = piece.createNode(p);
    for (const n of scene.listChildren()) holder.addChild(n);
    scene.addChild(holder);
    mergeDocuments(doc, piece);
  }
  const [first, ...rest] = doc.getRoot().listScenes();
  for (const s of rest) { for (const n of s.listChildren()) first.addChild(n); s.dispose(); }
  for (const b of doc.getRoot().listBuffers().slice(1)) b.dispose();
  for (const acc of doc.getRoot().listAccessors()) acc.setBuffer(doc.getRoot().listBuffers()[0]);
  for (const m of doc.getRoot().listMaterials()) m.setExtension("KHR_materials_unlit", null).setRoughnessFactor(0.85).setMetallicFactor(0);
  doc.getRoot().listExtensionsUsed().filter(e => e instanceof KHRMaterialsUnlit).forEach(e => e.dispose());
  await doc.transform(dedup(), prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [textures, textures], quality: 85 }));
  await write(doc, name);
}

// Rooms: Kenney's Furniture Kit (CC0) — the living room, kitchen, bedroom, office and bar.
await kit("room.glb", join(kenney, "Models", "GLTF format"), ["floorFull", "wall", "wallWindow", "wallDoorway", "loungeSofa", "loungeChair",
  "tableCoffee", "rugRectangle", "lampRoundFloor", "bookcaseOpen", "pottedPlant", "sideTable", "televisionModern", "cabinetTelevision", "books",
  "doorway", "kitchenBar", "kitchenBarEnd", "stoolBar", "ceilingFan",
  "kitchenCabinet", "kitchenCabinetDrawer", "kitchenCabinetUpper", "kitchenFridgeLarge", "kitchenStove", "kitchenSink", "kitchenCoffeeMachine",
  "kitchenMicrowave", "table", "chair", "bedDouble", "cabinetBedDrawer", "lampSquareTable", "desk", "chairDesk", "computerScreen",
  "computerKeyboard", "bookcaseClosedWide", "tableRound", "chairCushion", "bench", "coatRackStanding", "lampSquareFloor", "rugRound",
  "pillow", "pillowBlue", "plantSmall1", "trashcan", "laptop", "radio", "lampWall"]);

// Outside, if the Kenney city, nature and car kits are given (argv 4: their parent folder).
const more = process.argv[5];
if (more) {
  const find = (kitDir, sub) => { const d = readdirSync(join(more, kitDir), { recursive: true }).find(f => f.endsWith(sub)); return d && join(more, kitDir, dirname(d)); };
  const roads = find("kenney_city-kit-roads", "road-straight.glb"), city = find("kenney_city-kit-commercial_2.1", "building-a.glb");
  const cars = find("kenney_car-kit", "sedan.glb"), nature = find("kenney_nature-kit", "tree_default.glb"), food = find("kenney_food-kit", "soda-glass.glb");
  // The street (City Kit Roads + Commercial + Car Kit), the park (Nature Kit), and things to hold (Food Kit). All CC0.
  await kit("city.glb", roads, ["road-straight", "tile-low", "light-square", "construction-cone", "dumpster"], { textures: 128 });
  await kit("buildings.glb", city, ["building-a", "building-b", "building-c", "building-d", "building-e", "building-h", "low-detail-building-a", "low-detail-building-b", "low-detail-building-wide-a", "detail-awning"], { textures: 256 });
  await kit("cars.glb", cars, ["sedan", "taxi"], { textures: 128 });
  await kit("nature.glb", nature, ["ground_grass", "ground_pathStraight", "tree_default", "tree_oak", "tree_fat", "tree_detailed", "plant_bushLarge", "plant_bush", "flower_redA", "flower_yellowA", "fence_simple", "rock_smallA"], { textures: 128 });
  await kit("props.glb", food, ["soda-glass", "wine-red", "cup"], { textures: 128 });
}

console.log("\n" + readdirSync(out).join(" "));
