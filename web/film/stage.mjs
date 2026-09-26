// Film's stage: the room, the people, the camera and the video, for any film
// shaped like web/film.mjs's block() — { people: { name: { timeline } }, lines,
// length } — whether the probe wrote it by hand or the prose reader wrote it.
//
// No model, no network after the assets. three.js (MIT), Quaternius (CC0),
// Kenney (CC0), Poly Haven (CC0), Mediabunny (MPL-2.0). docs/film-plan.md.
import * as T from "../vendor/three.mjs?v=1";
import { placesAt, cameraFor, segIndex, setAt, SETS, LOOKS, SKINS, SKIN_BASE, cleanLook, textEnvelope } from "../film.mjs?v=5";
import { cue, place } from "./sound.mjs?v=1";

const ASSETS = new URL("./assets/", import.meta.url).href;

// What each person looks like lives in film.mjs (LOOKS, cleanLook), so the page
// can offer it without loading this module.
export { LOOKS };
export const HAIR = { long: "hair-long.glb", parted: "hair-parted.glb", buns: "hair-buns.glb", buzzed: "hair-buzzed.glb", "buzzed-female": "hair-buzzed-female.glb" };

// ---------------------------------------------------------------- loading
const bytesLoaded = { total: 0 };
const cache = new Map();
async function fetchBytes(name) {
  const r = await fetch(ASSETS + name);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const b = await r.arrayBuffer();
  bytesLoaded.total += b.byteLength;
  return b;
}
function loadGltf(name) {
  if (!cache.has(name)) cache.set(name, fetchBytes(name).then(b => {
    const l = new T.GLTFLoader();
    l.setMeshoptDecoder(T.MeshoptDecoder);
    return l.parseAsync(b, ASSETS);
  }));
  return cache.get(name);
}

// Hair is its own skinned mesh on the same rig: rebind it to the body's bones.
function wear(body, hairScene, tint) {
  const bones = {};
  body.traverse(o => { if (o.isBone) bones[o.name] = o; });
  const skinned = [];
  hairScene.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
  let host = null;
  body.traverse(o => { if (!host && o.isSkinnedMesh) host = o.parent; });
  for (const m of skinned) {
    const sk = new T.Skeleton(m.skeleton.bones.map(b => bones[b.name] || b), m.skeleton.boneInverses);
    host.add(m);
    m.bind(sk, m.bindMatrix);
    if (tint) { m.material = m.material.clone(); m.material.color = new T.Color(tint); }
    m.castShadow = true; m.frustumCulled = false;
  }
}

// The free tier's bodies come in underwear, and Quaternius's only outfit kit is
// fantasy. So clothes are painted on: each vertex is shirt, trousers or shoes
// by which bones move it (skin weights), and the shader lays the colour over
// the skin texture. No download; it reads as a fitted outfit, not as cloth.
const TOP = /^(spine_0[123]|clavicle_|upperarm_|lowerarm_)/, BOTTOM = /^(pelvis|thigh_|calf_)/, SHOES = /^(foot_|ball_)/;
// A skin tone as a colour gain (linear, may exceed 1) on the texture's own average.
function skinGain(target) {
  if (!target) return new T.Color(1, 1, 1);
  const t = new T.Color(target), b = new T.Color(SKIN_BASE);
  return new T.Color(t.r / b.r, t.g / b.g, t.b / b.b);
}
function dress(body, { top, bottom, shoes }, gain = new T.Color(1, 1, 1)) {
  body.traverse(m => {
    if (!m.isSkinnedMesh || m.geometry.attributes.position.count < 3000) return;
    if (!m.geometry.attributes.garment) {
      const names = m.skeleton.bones.map(b => b.name);
      const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
      const g = new Float32Array(si.count * 3);
      for (let v = 0; v < si.count; v++) for (let k = 0; k < 4; k++) {
        const name = names[si.getComponent(v, k)] || "", w = sw.getComponent(v, k);
        if (TOP.test(name)) g[v * 3] += w;
        else if (BOTTOM.test(name)) g[v * 3 + 1] += w;
        else if (SHOES.test(name)) g[v * 3 + 2] += w;
      }
      m.geometry.setAttribute("garment", new T.BufferAttribute(g, 3));
    }
    const mat = m.material = m.material.clone();
    mat.color = gain;
    const u = { topC: { value: new T.Color(top) }, botC: { value: new T.Color(bottom) }, shoeC: { value: new T.Color(shoes) }, skinGain: { value: gain.clone() } };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = "attribute vec3 garment;\nvarying vec3 vGarment;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvGarment = garment;");
      sh.fragmentShader = "uniform vec3 topC, botC, shoeC, skinGain;\nvarying vec3 vGarment;\n" + sh.fragmentShader.replace("#include <map_fragment>",
        `#include <map_fragment>
        float cloth = 0.0; vec3 cc = diffuseColor.rgb;
        if (vGarment.x > 0.5) { cc = topC; cloth = 1.0; }
        if (vGarment.y > 0.5) { cc = botC; cloth = 1.0; }
        if (vGarment.z > 0.5) { cc = shoeC; cloth = 1.0; }
        // Keep a little of the body's shading so the skin texture's folds read as cloth
        // (from the texture itself: a skin tone's gain must not lighten the clothes).
        float lum = dot(diffuseColor.rgb / max(skinGain, vec3(0.01)), vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(diffuseColor.rgb, cc * (0.75 + 0.5 * lum), cloth);`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n if (max(vGarment.x, max(vGarment.y, vGarment.z)) > 0.5) roughnessFactor = 0.9;");
    };
    mat.customProgramCacheKey = () => "dress";
  });
}

// Hair and eyebrows share a grey texture made to be tinted.
function tintHair(body, tint) {
  body.traverse(m => {
    if (m.isMesh && m.material?.map?.name && /hair/i.test(m.material.map.name)) { m.material = m.material.clone(); m.material.color = new T.Color(tint); }
  });
}

// ---------------------------------------------------------------- sets
// Each kit's pieces are in their own units: the scale that makes them metres.
const KIT = { room: ["room.glb", 2], city: ["city.glb", 8], buildings: ["buildings.glb", 8], cars: ["cars.glb", 1.8], nature: ["nature.glb", 4], props: ["props.glb", 0.3] };
const NEEDS = { "living room": ["room"], kitchen: ["room"], bedroom: ["room"], office: ["room"], bar: ["room", "props"],
  street: ["city", "buildings", "cars"], park: ["nature", "room"] };

function placer(kits, g) {
  const pieces = {};
  for (const [k, gltf] of Object.entries(kits)) for (const n of gltf.scene.children) pieces[k + ":" + n.name] = [n, KIT[k][1]];
  /** put("room:sofa", x, z, rotation, { y, scale, top, cast }) — its footprint centred on (x, z), standing on y. */
  return (name, x, z, rot = 0, { y = 0, scale = 1, top = false, cast = true } = {}) => {
    const src = pieces[name];
    if (!src) return null;
    const o = src[0].clone(true);
    o.scale.multiplyScalar(src[1] * scale);
    o.rotation.y += rot;
    o.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(o);
    const c = box.getCenter(new T.Vector3());
    o.position.x += x - c.x; o.position.z += z - c.z; o.position.y += y + (top ? -box.max.y : -box.min.y);
    o.traverse(m => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = true; } });
    g.add(o);
    return o;
  };
}

// Walls, floor and ceiling of every room: open to the camera at the front, a
// window in the back wall, a doorway on the right (film.mjs SETS: door [2.1, 1.6]).
function shell(put, g, { floor = "#d9c4a4", wall = null } = {}) {
  const S = 2;
  for (let x = -3; x < 3; x += S) for (let z = -3; z < 3; z += S) put("room:floorFull", x + S / 2, z + S / 2, 0, { top: true });
  for (let x = -3; x < 3; x += S) put(x === -1 ? "room:wallWindow" : "room:wall", x + S / 2, -3);
  for (let z = -3; z < 3; z += S) put("room:wall", -3, z + S / 2, Math.PI / 2);
  for (let z = -3; z < 3; z += S) put(z === 1 ? "room:wallDoorway" : "room:wall", 3, z + S / 2, -Math.PI / 2);
  const ceiling = new T.Mesh(new T.PlaneGeometry(6, 6), new T.MeshStandardMaterial({ color: "#efe9df", roughness: 0.95 }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = 2.58;
  g.add(ceiling);
  if (wall) g.traverse(m => { if (m.isMesh && /wall/i.test(m.parent?.name || "") && m.material?.color) { m.material = m.material.clone(); m.material.color.multiply(new T.Color(wall)); } });
  void floor;
}

// The sets, as film.mjs SETS describes them (marks, seats, door). Each returns
// where its practical light (a lamp, a street light) is.
const BUILD = {
  "living room"(put, g) {
    shell(put, g);
    put("room:rugRectangle", -0.6, -0.2);
    put("room:loungeSofa", -0.9, -1.45);
    put("room:tableCoffee", -0.9, -0.1);
    put("room:loungeChair", 1.2, -1.6, -0.6);
    put("room:lampRoundFloor", -2.3, -2.3);
    put("room:bookcaseOpen", 1.9, -2.65);
    put("room:pottedPlant", -2.5, 2.1);
    put("room:sideTable", -2.1, -1.2);
    put("room:cabinetTelevision", -2.6, 0.2, Math.PI / 2);
    put("room:televisionModern", -2.6, 0.2, Math.PI / 2);
    return [-2.3, 1.6, -1.6];
  },
  kitchen(put, g) {
    shell(put, g);
    // Along the back wall: fridge, cupboards, stove, sink, cupboards; cupboards on the wall above.
    const row = [["room:kitchenFridgeLarge", -2.45], ["room:kitchenCabinet", -1.5], ["room:kitchenStove", -0.64], ["room:kitchenCabinetDrawer", 0.22], ["room:kitchenSink", 1.08], ["room:kitchenCabinet", 1.94]];
    for (const [p, x] of row) put(p, x, -2.62);
    for (const x of [-1.5, 0.22, 1.08, 1.94]) put("room:kitchenCabinetUpper", x, -2.78, 0, { y: 1.45 });
    put("room:kitchenCoffeeMachine", 1.94, -2.7, 0, { y: 0.86 });
    put("room:table", -0.6, 0.45, Math.PI / 2);
    put("room:chair", -1.75, 0.45, Math.PI / 2);
    put("room:chair", 0.55, 0.45, -Math.PI / 2);
    put("room:trashcan", 2.5, -1.8);
    return [-0.6, 2.2, 0.4];
  },
  bedroom(put, g) {
    shell(put, g);
    put("room:rugRound", -0.4, 0.3);
    put("room:bedDouble", -1.2, -1.85);
    put("room:pillow", -1.6, -2.55, 0, { y: 0.55 });
    put("room:pillowBlue", -0.8, -2.55, 0, { y: 0.55 });
    put("room:cabinetBedDrawer", -2.55, -2.55);
    put("room:lampSquareTable", -2.55, -2.55, 0, { y: 0.5 });
    put("room:cabinetBedDrawer", 0.15, -2.55);
    put("room:coatRackStanding", 2.4, -2.4);
    put("room:plantSmall1", 1.4, -2.6);
    return [-2.5, 1.2, -2.3];
  },
  office(put, g) {
    shell(put, g);
    put("room:bookcaseClosedWide", 0.6, -2.7);
    put("room:desk", -0.8, -1.05);
    // The screen at the desk's end, turned to the chair: a close shot of whoever sits there sees over the desk.
    put("room:computerScreen", -1.35, -1.15, 0.6, { y: 0.76 });
    put("room:computerKeyboard", -1.05, -1.05, 0.4, { y: 0.76 });
    put("room:chairDesk", -0.8, -1.95);   // a chair's back is at its -z side unturned
    put("room:chair", -0.8, 0.6, Math.PI);
    put("room:pottedPlant", 2.5, -2.5);
    put("room:lampSquareFloor", -2.5, -2.4);
    put("room:trashcan", 0.4, -1.3);
    return [-2.5, 1.7, -2.3];
  },
  bar(put, g) {
    shell(put, g);
    // The counter runs across the room behind the stools; bottles on the shelves behind it.
    for (let x = -2.6; x <= 1.2; x += 0.86) put("room:kitchenBar", x, -1.72);
    put("room:kitchenBarEnd", 1.95, -1.72);
    for (const x of [-1.1, -0.3, 0.5]) put("room:stoolBar", x, -1.35);
    put("room:bookcaseOpen", -1.4, -2.72); put("room:bookcaseOpen", 0.4, -2.72);
    for (const [x, y] of [[-1.9, 0.9], [-1.6, 0.9], [-1.3, 1.45], [0, 0.9], [0.3, 1.45], [0.7, 0.9], [-0.7, 1.45]]) put(Math.round(x * 10) % 2 ? "props:wine-red" : "props:soda-glass", x, -2.72, 0, { y });
    put("room:tableRound", 1.9, 0.9); put("room:chairCushion", 1.9, 1.6, Math.PI);
    put("room:tableRound", -2.2, 1.3); put("room:chairCushion", -2.2, 2, Math.PI);
    put("room:lampWall", -2.9, -0.5, Math.PI / 2, { y: 1.5 });
    return [-0.5, 2.1, -1.2];
  },
  street(put, g) {
    // The pavement the actors stand on, shopfronts behind them, the road in front (under the camera).
    const pave = new T.Mesh(new T.PlaneGeometry(60, 6), new T.MeshStandardMaterial({ color: "#a9a49c", roughness: 0.95 }));
    pave.rotation.x = -Math.PI / 2; pave.position.set(0, 0, -0.5); pave.receiveShadow = true; g.add(pave);
    for (let x = -28; x <= 28; x += 8) put("city:road-straight", x, 6.5, Math.PI / 2, { top: true, cast: false });
    const far = new T.Mesh(new T.PlaneGeometry(60, 8), pave.material); far.rotation.x = -Math.PI / 2; far.position.set(0, 0, 14.5); g.add(far);
    ["building-a", "building-c", "building-b", "building-d", "building-e", "building-h"].forEach((b, i) => put("buildings:" + b, -17.5 + i * 7, -7));
    ["low-detail-building-a", "low-detail-building-wide-a", "low-detail-building-b", "low-detail-building-wide-a"].forEach((b, i) => put("buildings:" + b, -12 + i * 8, 22, Math.PI));
    for (const x of [-9, 8.5]) put("city:light-square", x, 2.4, -Math.PI / 2, { cast: false });
    put("cars:sedan", 5.2, 3.6, Math.PI / 2);
    put("cars:taxi", -9, 3.6, Math.PI / 2);
    put("room:bench", -2.25, -1.25, 0, { scale: 1 });
    put("city:dumpster", 4.4, -2.4);
    return [2, 4.2, 2];
  },
  park(put, g) {
    for (let x = -24; x < 24; x += 4) for (let z = -24; z < 24; z += 4) put("nature:ground_grass", x + 2, z + 2, 0, { top: true, cast: false });
    for (let x = -24; x < 24; x += 4) put("nature:ground_pathStraight", x + 2, 1.2, Math.PI / 2, { top: true, cast: false });
    put("room:bench", -0.75, -1.2, 0);
    const trees = [["tree_oak", -4, -5], ["tree_default", 3, -6], ["tree_fat", -8, -2], ["tree_detailed", 7, -3], ["tree_oak", 10, -9], ["tree_default", -11, -9], ["tree_detailed", -6, 7], ["tree_fat", 8, 8], ["tree_oak", 0, -11]];
    for (const [n, x, z] of trees) put("nature:" + n, x, z, x * 0.7);
    for (const [n, x, z] of [["plant_bushLarge", -2.6, -2.2], ["plant_bush", 1.5, -2.4], ["flower_redA", -3, -1.8], ["flower_yellowA", 2.2, -1.9], ["rock_smallA", 4, -1.5]]) put("nature:" + n, x, z);
    for (let x = -12; x <= 12; x += 4) put("nature:fence_simple", x, -13);
    return [-3, 3, 2];
  },
};

const NATURE = { grass: "#5b7f3b", leafsGreen: "#476c2f", woodBark: "#5e4632", dirt: "#8a6d4d", dirtDark: "#6e5239", wood: "#8b6a4a", woodDark: "#6b5038", colorRed: "#b8352c", colorYellow: "#e0b12a" };

// Light for the time of day, inside or out.
const LIGHT = {
  day: { env: 0.55, key: ["#ffe2c0", 2.2], practical: 1, sky: 1, night: false },
  dawn: { env: 0.35, key: ["#ffb888", 1.3], practical: 2, sky: 0.55, night: false },
  evening: { env: 0.28, key: ["#ff9d62", 1.1], practical: 3.5, sky: 0.35, night: false },
  night: { env: 0.1, key: ["#a8b8ff", 0.35], practical: 6, sky: 0.06, night: true },
};

// ---------------------------------------------------------------- props
// Held in the right hand. Tuned against the free rig's hand_r bone.
function makeProps(kits) {
  const mat = c => new T.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.35 });
  const phone = new T.Mesh(new T.BoxGeometry(0.072, 0.15, 0.009), mat("#16161a"));
  const gun = new T.Group();
  const slide = new T.Mesh(new T.BoxGeometry(0.03, 0.032, 0.19), mat("#2b2b2e")); slide.position.set(0, 0.03, 0.055);
  const grip = new T.Mesh(new T.BoxGeometry(0.028, 0.1, 0.045), mat("#1d1d1f")); grip.position.set(0, -0.02, -0.01); grip.rotation.x = -0.25;
  gun.add(slide, grip);
  // A tumbler with a drink in it: a clear glass alone vanishes on a phone screen.
  const glass = new T.Group();
  const cup = new T.Mesh(new T.CylinderGeometry(0.036, 0.031, 0.1, 18, 1, true), new T.MeshStandardMaterial({ color: "#e8f1f4", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45, side: T.DoubleSide }));
  const drink = new T.Mesh(new T.CylinderGeometry(0.032, 0.029, 0.06, 18), new T.MeshStandardMaterial({ color: "#b5651d", roughness: 0.2, transparent: true, opacity: 0.9 }));
  drink.position.y = -0.015;
  const base = new T.Mesh(new T.CylinderGeometry(0.031, 0.031, 0.01, 18), cup.material); base.position.y = -0.045;
  glass.add(cup, drink, base);
  void kits;
  return { phone, gun, glass };
}
// Where each sits in the hand (bone space): position, rotation.
// Chosen by rendering the hand close up in each pose that uses it.
const GRIP = {
  glass: [[-0.03, 0.12, 0.03], [0, 0, Math.PI / 2]],
  phone: [[0.02, 0.1, 0.03], [0, 0, Math.PI / 2]],
  gun: [[0, 0.09, 0.02], [-Math.PI / 2, 0, Math.PI]],
};

async function buildWorld(renderer, film, looks, { shadows }) {
  const scene = new T.Scene();
  scene.background = new T.Color("#1b1714");
  const names = Object.keys(film.people);
  const usedSets = [...new Set((film.sets?.length ? film.sets : [{ set: "living room" }]).map(s => s.set))];
  const outside = usedSets.some(s => !SETS[s]?.inside);
  const kitsNeeded = new Set(usedSets.flatMap(s => NEEDS[s] || ["room"]));
  const need = new Set(["moves-1.glb", "moves-2.glb", ...[...kitsNeeded].map(k => KIT[k][0])]);
  for (const n of names) looks[n] = cleanLook(looks[n]);
  for (const n of names) { const l = looks[n]; need.add(`${l.body}.glb`); if (HAIR[l.hair]) need.add(HAIR[l.hair]); if (l.beard) need.add("beard.glb"); }

  const [hdrBuf, skyBuf] = await Promise.all([fetchBytes("lebombo_1k.hdr"), outside ? fetchBytes("sky_1k.hdr") : null, ...[...need].map(loadGltf)]);
  const got = async n => loadGltf(n);

  // Light: an HDRI for everything soft (a room's inside, the sky outside), one key for shadows.
  const pmrem = new T.PMREMGenerator(renderer);
  const hdrTex = buf => {
    const hdr = new T.HDRLoader().parse(buf);
    const tex = new T.DataTexture(hdr.data, hdr.width, hdr.height, T.RGBAFormat, hdr.type);
    tex.mapping = T.EquirectangularReflectionMapping; tex.colorSpace = T.LinearSRGBColorSpace;
    tex.minFilter = tex.magFilter = T.LinearFilter; tex.generateMipmaps = false; tex.flipY = true; tex.needsUpdate = true;
    return tex;
  };
  const roomTex = hdrTex(hdrBuf);
  const env = { inside: pmrem.fromEquirectangular(roomTex).texture };
  roomTex.dispose();
  if (skyBuf) { const sky = hdrTex(skyBuf); env.outside = pmrem.fromEquirectangular(sky).texture; env.sky = sky; }
  pmrem.dispose();
  const key = new T.DirectionalLight("#ffe2c0", 2.2);
  key.position.set(-3, 5, 3);
  key.target.position.set(0, 0, -0.5);
  scene.add(key, key.target);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
  }
  const practical = new T.PointLight("#ffb46b", 3, 6, 2);
  scene.add(practical);

  const kits = {};
  for (const k of kitsNeeded) kits[k] = await got(KIT[k][0]);
  // Kenney's nature kit is pastel (its grass is mint): recolour it by material name, towards a real park.
  kits.nature?.scene.traverse(m => { const c = m.isMesh && NATURE[m.material?.name]; if (c) { m.material = m.material.clone(); m.material.color.set(c); } });
  const sets = {};
  for (const name of usedSets) {
    const g = new T.Group();
    g.visible = false;
    const lamp = (BUILD[name] || BUILD["living room"])(placer(kits, g), g);
    scene.add(g);
    sets[name] = { group: g, lamp, inside: SETS[name]?.inside !== false };
  }

  const clips = {};
  for (const c of [...(await got("moves-1.glb")).animations, ...(await got("moves-2.glb")).animations]) clips[c.name] = c;
  const props = makeProps(kits);
  const cast = {};
  for (const name of names) {
    const l = looks[name];
    const body = T.cloneSkinned((await got(`${l.body}.glb`)).scene);
    body.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    dress(body, l.outfit, skinGain(SKINS[l.skin]));
    tintHair(body, l.hairTint);
    if (HAIR[l.hair]) wear(body, T.cloneSkinned((await got(HAIR[l.hair])).scene), l.hairTint);
    if (l.beard) wear(body, T.cloneSkinned((await got("beard.glb")).scene), l.hairTint);
    const holder = new T.Group();
    holder.add(body);
    scene.add(holder);
    let head = null, hand = null;
    body.traverse(o => { if (o.isBone && o.name === "Head") head = o; if (o.isBone && o.name === "hand_r") hand = o; });
    // One of each prop per person, in the hand, shown when the story puts it there.
    const held = {};
    for (const [k, proto] of Object.entries(props)) {
      const o = proto.clone(true);
      const [pos, rot] = GRIP[k];
      o.position.set(...pos); o.rotation.set(...rot);
      o.visible = false;
      o.traverse(m => { if (m.isMesh) m.castShadow = true; });
      hand?.add(o);
      held[k] = o;
    }
    cast[name] = { holder, body, mixer: new T.AnimationMixer(body), actions: {}, head, held };
  }
  return { scene, cast, clips, clipNames: Object.keys(clips), sets, env, key, practical, current: null };
}

// Show a scene's set, in its light.
function applySet(world, info) {
  const id = info.set + "|" + info.light;
  if (world.current === id) return;
  world.current = id;
  for (const [name, s] of Object.entries(world.sets)) s.group.visible = name === info.set;
  const s = world.sets[info.set] || Object.values(world.sets)[0];
  const L = LIGHT[info.light] || LIGHT.day;
  const scene = world.key.parent;
  const outside = !s.inside && world.env.outside;
  scene.environment = outside ? world.env.outside : world.env.inside;
  scene.environmentIntensity = L.env * (outside ? 1.4 : 1);
  if (outside && !L.night) { scene.background = world.env.sky; scene.backgroundIntensity = L.sky; }
  else scene.background = new T.Color(L.night ? "#0a0e1a" : "#1b1714");
  world.key.color.set(L.key[0]); world.key.intensity = L.key[1] * (outside ? 1.3 : 1);
  if (outside) { world.key.position.set(-6, 10, 6); Object.assign(world.key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 }); }
  else { world.key.position.set(-3, 5, 3); Object.assign(world.key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 }); }
  world.key.shadow.camera.updateProjectionMatrix();
  world.practical.position.set(...s.lamp);
  world.practical.intensity = L.practical * (outside ? 4 : 1);
  world.practical.distance = outside ? 14 : 6;
}

// ---------------------------------------------------------------- posing
const smooth = x => x * x * (3 - 2 * x);
function action(world, p, name) {
  if (!p.actions[name]) {
    const clip = world.clips[name];
    if (!clip) throw new Error(`No clip "${name}" in the free tier`);
    const a = p.mixer.clipAction(clip);
    if (!/_Loop$/.test(name)) { a.setLoop(T.LoopOnce, 1); a.clampWhenFinished = true; }
    p.actions[name] = a;
  }
  return p.actions[name];
}

// Everything at time t is a function of t: the preview and the video frames
// are the same picture, and a frame can be made in any order.
function poseAll(world, film, t) {
  const places = placesAt(film, t);
  for (const [name, p] of Object.entries(world.cast)) {
    const tl = film.people[name].timeline, i = segIndex(tl, t), seg = tl[i], prev = tl[i - 1];
    for (const a of Object.values(p.actions)) a.setEffectiveWeight(0);
    const fade = prev ? smooth(Math.min(1, (t - seg[0]) / 0.35)) : 1;
    const cur = action(world, p, seg[1]);
    // A segment's speed: how a line is said (a shout is quicker), 0 to hold a pose (lying down).
    const speed = seg[2].speed ?? 1, pspeed = prev?.[2].speed ?? 1;
    cur.enabled = true; cur.play(); cur.time = Math.max(0, t - seg[0]) * speed; cur.setEffectiveWeight(fade);
    if (prev && fade < 1) {
      const pa = action(world, p, prev[1]);
      pa.enabled = true; pa.play(); pa.time = (t - prev[0]) * pspeed; pa.setEffectiveWeight(1 - fade);
    }
    p.mixer.update(0);
    const pl = places[name];
    p.holder.visible = !pl.off;
    p.holder.position.set(pl.at[0], pl.lift, pl.at[1]);
    p.holder.rotation.y = pl.facing;
    for (const [k, o] of Object.entries(p.held)) o.visible = seg[2].prop === k;
  }
  return places;
}

// The camera, by the rules in film.mjs (cameraFor: the 180° rule lives there).
function aim(camera, world, film, t, shotAt, places) {
  const shot = shotAt(t);
  const heads = {}, facing = {};
  for (const [name, p] of Object.entries(world.cast)) {
    if (places[name].off) continue;
    heads[name] = p.head.getWorldPosition(new T.Vector3()).toArray();
    facing[name] = places[name].facing;
  }
  const pair = Object.keys(film.people).filter(n => heads[n]).slice(0, 2);
  const c = cameraFor(shot, heads, facing, pair, (SETS[setAt(film, t).set] || SETS["living room"]).wide);
  camera.fov = c.fov;
  camera.position.set(...c.at);
  camera.lookAt(...c.look);
  camera.updateProjectionMatrix();
  return shot;
}

// ---------------------------------------------------------------- one frame
function subtitle(ctx, film, t, W, H) {
  const line = film.lines.find(([a, b]) => t >= a && t < b);
  if (!line) return;
  const size = Math.round(W / 22);
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const out = [];
  let cur = "";
  for (const wd of line[3].split(" ")) { const next = cur ? cur + " " + wd : wd; if (ctx.measureText(next).width > W * 0.84 && cur) { out.push(cur); cur = wd; } else cur = next; }
  out.push(cur);
  const lh = size * 1.3;
  let y = H - H * 0.09 - (out.length - 1) * lh;
  ctx.lineJoin = "round"; ctx.lineWidth = size * 0.22; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.fillStyle = "#fff";
  for (const l of out) { ctx.strokeText(l, W / 2, y); ctx.fillText(l, W / 2, y); y += lh; }
}

// The speaker's head moves with their voice: nods on the loud syllables, a
// slight turn as the line goes on. The free bodies have no mouths that open
// (no morph targets, no jaw bone), so this is what "speaking" can be.
// stage.speech[lineIndex] is a loudness envelope at 24 fps (a recording's own,
// from film.mjs rmsEnvelope); without one, the words' syllables (textEnvelope).
function speak(stage, film, t) {
  const cache = stage.speechCache ||= {};
  film.lines.forEach((line, i) => {
    const [a, b, who] = line;
    const p = who && stage.world.cast[who];
    if (!p || t < a || t >= b || !p.head) return;
    const env = stage.speech?.[i] || (cache[i + ":" + line[3]] ||= textEnvelope(line[3], b - a));
    const e = env[Math.min(env.length - 1, Math.floor((t - a) * 24))] || 0;
    p.head.rotateX(-0.09 * e);
    p.head.rotateZ(0.035 * Math.sin((t - a) * 2.1) * (0.4 + e));
  });
}

/** draw(t) → the shot's name. With `loop`, t wraps (the probe fills two minutes with 30 s). */
export function frameFn(stage) {
  const { renderer, world, camera, ctx, film, shotAt, loop } = stage;
  return t => {
    const lt = loop ? t % loop : t;
    applySet(world, setAt(film, lt));
    const places = poseAll(world, film, lt);
    speak(stage, film, lt);
    const shot = aim(camera, world, film, lt, shotAt, places);
    renderer.render(world.scene, camera);
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.drawImage(renderer.domElement, 0, 0, W, H);
    subtitle(ctx, film, lt, W, H);
    // Every scene opens from black; the film closes to it.
    const opens = [0, ...(film.scenes || [])];
    const since = Math.min(...opens.map(s => lt - s).filter(d => d >= 0));
    const toEnd = (loop || film.length) - lt;
    const dark = Math.max(since < 0.5 ? 1 - since / 0.5 : 0, !loop && toEnd < 0.6 ? 1 - toEnd / 0.6 : 0);
    if (dark > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, dark)})`; ctx.fillRect(0, 0, W, H); }
    return shot;
  };
}

// ---------------------------------------------------------------- sound
// The soundtrack, made on the page (no file): recorded voice clips at their
// times, [{ at, buffer, rate }] (rate < 1 is a deeper voice), and, if asked
// for, a music bed.
export async function soundtrack(seconds, voices = [], { music = true, cues = [], places = [] } = {}) {
  const rate = 48000, ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  if (music) addMusic(ctx, master, seconds, rate);
  // What happens (film.mjs soundCues) and where (ambience), made on the page (sound.mjs).
  const fx = ctx.createGain(); fx.gain.value = 0.8; fx.connect(ctx.destination);
  for (const c of cues) if (c.t < seconds) cue(ctx, fx, c.t, c.kind);
  for (const a of places) if (a.start < seconds) place(ctx, fx, a.kind, a.light, a.start, Math.min(seconds, a.end));
  for (const { at, buffer, rate: speed = 1 } of voices) {
    if (at >= seconds) continue;
    const v = ctx.createBufferSource(); v.buffer = buffer; v.playbackRate.value = speed;
    const vg = ctx.createGain(); vg.gain.value = 1.6;
    v.connect(vg).connect(ctx.destination); v.start(at);
  }
  return ctx.startRendering();
}

// A quiet bed: a slow minor pad and room tone. Film has it off unless asked for.
function addMusic(ctx, master, seconds, rate) {
  const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 196, 246.94]];
  const bar = 4;
  for (let t = 0, i = 0; t < seconds; t += bar, i++) {
    for (const f of chords[i % 4]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = f / 2;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 1.2); g.gain.linearRampToValueAtTime(0, Math.min(seconds, t + bar + 0.3));
      o.connect(g).connect(master); o.start(t); o.stop(Math.min(seconds, t + bar + 0.4));
    }
  }
  const noise = ctx.createBuffer(1, rate * 2, rate), d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400;
  const ng = ctx.createGain(); ng.gain.value = 0.02;
  n.connect(lp).connect(ng).connect(master); n.start(0); n.stop(seconds);
}

function sliceAudio(buf, from, to) {
  const a = Math.floor(from * buf.sampleRate), b = Math.min(buf.length, Math.floor(to * buf.sampleRate));
  const out = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}

// ---------------------------------------------------------------- the video
export async function makeVideo(stage, { seconds, fps, voices = [], music = true, cues = [], places = [], onProgress, onFrame }) {
  const mb = await import("../vendor/mediabunny-film.mjs?v=1");
  const { ctx } = stage;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  let v = null;
  for (const [codec, format, ext, type] of [["avc", "Mp4OutputFormat", "mp4", "video/mp4"], ["vp9", "WebMOutputFormat", "webm", "video/webm"]])
    try { if (await mb.canEncodeVideo(codec, { width: W, height: H, bitrate: 3e6 })) { v = { codec, format, ext, type }; break; } } catch {}
  if (!v) throw new Error("This browser cannot encode video (no WebCodecs VideoEncoder for H.264 or VP9).");
  let audioCodec = null;
  for (const c of v.ext === "mp4" ? ["aac", "opus"] : ["opus"])
    try { if (await mb.canEncodeAudio(c, { numberOfChannels: 2, sampleRate: 48000, bitrate: 128e3 })) { audioCodec = c; break; } } catch {}

  const output = new mb.Output({ format: new mb[v.format](v.ext === "mp4" ? { fastStart: "in-memory" } : {}), target: new mb.BufferTarget() });
  const vsrc = new mb.CanvasSource(ctx.canvas, { codec: v.codec, bitrate: 3e6, keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: fps });
  let asrc = null, audio = null, audioMs = 0;
  if (audioCodec) {
    asrc = new mb.AudioBufferSource({ codec: audioCodec, bitrate: 128e3 });
    output.addAudioTrack(asrc);
    const a0 = performance.now();
    audio = await soundtrack(seconds, voices, { music, cues, places });
    audioMs = performance.now() - a0;
  }
  await output.start();

  const draw = frameFn(stage);
  const total = Math.round(seconds * fps);
  let drawMs = 0, encMs = 0, audioSent = 0;
  const t0 = performance.now();
  for (let f = 0; f < total; f++) {
    const t = f / fps;
    const d0 = performance.now();
    draw(t);
    const d1 = performance.now();
    await vsrc.add(t, 1 / fps);
    encMs += performance.now() - d1; drawMs += d1 - d0;
    // Sound in one-second pieces, keeping pace with the picture.
    if (audio && (t + 1 / fps >= audioSent + 1 || f === total - 1)) {
      const to = f === total - 1 ? seconds : audioSent + 1;
      await asrc.add(sliceAudio(audio, audioSent, to));
      audioSent = to;
    }
    onFrame?.(f + 1, total);
    if (f % 6 === 0) { onProgress?.((f + 1) / total, performance.now() - t0); await new Promise(r => setTimeout(r, 0)); }
  }
  const f0 = performance.now();
  await output.finalize();
  const finalizeMs = performance.now() - f0;
  const blob = new Blob([output.target.buffer], { type: v.type });
  return { blob, ext: v.ext, videoCodec: v.codec, audioCodec, frames: total, wallMs: performance.now() - t0, drawMs, encMs, audioMs, finalizeMs };
}

// ---------------------------------------------------------------- setup
/**
 * A stage for a film: { renderer, world, camera, ctx, film, shotAt, loop, loadMs, bytes, T }.
 * looks: { name: LOOKS[i] } — who looks like whom.
 */
export async function setup(glCanvas, outCanvas, film, { looks, shotAt, loop = 0, width = 720, height = 1280, shadows = true } = {}) {
  const t0 = performance.now();
  bytesLoaded.total = 0;
  const renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = T.PCFShadowMap;
  outCanvas.width = width; outCanvas.height = height;
  const ctx = outCanvas.getContext("2d");
  const world = await buildWorld(renderer, film, looks, { shadows });
  const camera = new T.PerspectiveCamera(50, width / height, 0.05, 40);
  const stage = { renderer, world, camera, ctx, film, shotAt, loop, T };
  // Compile every shader and upload every texture before anything is timed.
  // Every set once, so each one's materials are compiled before timing starts.
  for (const info of film.sets?.length ? film.sets : [{ set: Object.keys(world.sets)[0], light: "day" }]) { applySet(world, info); renderer.compile(world.scene, camera); }
  world.current = null;
  applySet(world, setAt(film, 0));
  poseAll(world, film, 0); aim(camera, world, film, 0, shotAt, placesAt(film, 0));
  renderer.compile(world.scene, camera);
  renderer.render(world.scene, camera);
  return Object.assign(stage, { loadMs: performance.now() - t0, bytes: bytesLoaded.total });
}

/** A new film on the same stage (same people, same looks): no reload. */
export function recast(stage, film) {
  stage.film = film;
  stage.world.current = null;
  stage.speechCache = {};
  for (const p of Object.values(stage.world.cast)) { p.mixer.stopAllAction(); p.actions = {}; }
  return stage;
}
