// Film's stage: the room, the people, the camera and the video, for any film
// shaped like web/film.mjs's block() — { people: { name: { timeline } }, lines,
// length } — whether the probe wrote it by hand or the prose reader wrote it.
//
// No model, no network after the assets. three.js (MIT), Quaternius (CC0),
// Kenney (CC0), Poly Haven (CC0), Mediabunny (MPL-2.0). docs/film-plan.md.
import * as T from "../vendor/three.mjs?v=1";
import { placesAt, cameraFor, segIndex } from "../film.mjs?v=2";

const ASSETS = new URL("./assets/", import.meta.url).href;

// What each person looks like. Two bodies in the free tier; hair, colour and
// clothes make more people of them.
export const LOOKS = [
  { body: "woman", hair: "long", hairTint: "#3a2418", outfit: { top: "#7b1e2b", bottom: "#1d2330", shoes: "#141414" } },
  { body: "man", hair: "parted", beard: true, hairTint: "#2a2320", outfit: { top: "#c9c3b8", bottom: "#3b3f46", shoes: "#3a2a1e" } },
  { body: "woman", hair: "buns", hairTint: "#b08a5a", outfit: { top: "#2f5d50", bottom: "#c8bfae", shoes: "#5a3b22" } },
  { body: "man", hair: "parted", hairTint: "#6b4a2b", outfit: { top: "#1f2f4a", bottom: "#1c1c1c", shoes: "#111" } },
];
export const HAIR = { long: "hair-long.glb", parted: "hair-parted.glb", buns: "hair-buns.glb" };

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
function dress(body, { top, bottom, shoes }) {
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
    const u = { topC: { value: new T.Color(top) }, botC: { value: new T.Color(bottom) }, shoeC: { value: new T.Color(shoes) } };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = "attribute vec3 garment;\nvarying vec3 vGarment;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvGarment = garment;");
      sh.fragmentShader = "uniform vec3 topC, botC, shoeC;\nvarying vec3 vGarment;\n" + sh.fragmentShader.replace("#include <map_fragment>",
        `#include <map_fragment>
        float cloth = 0.0; vec3 cc = diffuseColor.rgb;
        if (vGarment.x > 0.5) { cc = topC; cloth = 1.0; }
        if (vGarment.y > 0.5) { cc = botC; cloth = 1.0; }
        if (vGarment.z > 0.5) { cc = shoeC; cloth = 1.0; }
        // Keep a little of the body's shading so the skin texture's folds read as cloth.
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
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

// A living room from Kenney's furniture kit, which is 1 unit ≈ 2 m.
function furnish(room) {
  const S = 2, g = new T.Group(), pieces = {};
  for (const n of room.scene.children) pieces[n.name] = n;
  const put = (name, x, z, rot = 0, { top = false } = {}) => {
    const src = pieces[name];
    if (!src) return;
    const o = src.clone(true);
    o.scale.multiplyScalar(S);
    o.rotation.y += rot;
    o.updateMatrixWorld(true);
    // Centre its footprint on (x, z); stand it on the floor (a floor tile's top IS the floor).
    const box = new T.Box3().setFromObject(o);
    const c = box.getCenter(new T.Vector3());
    o.position.x += x - c.x; o.position.z += z - c.z; o.position.y += top ? -box.max.y : -box.min.y;
    o.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
    g.add(o);
    return o;
  };
  for (let x = -3; x < 3; x += S) for (let z = -3; z < 3; z += S) put("floorFull", x + S / 2, z + S / 2, 0, { top: true });
  for (let x = -3; x < 3; x += S) put(x === -1 ? "wallWindow" : "wall", x + S / 2, -3);
  for (let z = -3; z < 3; z += S) put(z === 1 ? "wallDoorway" : "wall", -3, z + S / 2, Math.PI / 2);
  for (let z = -3; z < 3; z += S) put(z === 1 ? "wallDoorway" : "wall", 3, z + S / 2, -Math.PI / 2);
  const ceiling = new T.Mesh(new T.PlaneGeometry(6, 6), new T.MeshStandardMaterial({ color: "#efe9df", roughness: 0.95 }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = 2.58;
  g.add(ceiling);
  put("rugRectangle", -0.6, -0.2);
  put("loungeSofa", -0.9, -1.45);
  put("tableCoffee", -0.9, -0.1);
  put("loungeChair", 1.2, -1.6, -0.6);
  put("lampRoundFloor", -2.3, -2.3);
  put("bookcaseOpen", 1.9, -2.65);
  put("pottedPlant", -2.5, 2.1);
  put("sideTable", -2.1, -1.2);
  put("cabinetTelevision", -2.6, 0.2, Math.PI / 2);
  put("televisionModern", -2.6, 0.2, Math.PI / 2);
  return g;
}

async function buildWorld(renderer, film, looks, { shadows }) {
  const scene = new T.Scene();
  scene.background = new T.Color("#1b1714");
  const names = Object.keys(film.people);
  const need = new Set(["room.glb", "moves-1.glb", "moves-2.glb"]);
  for (const n of names) { const l = looks[n]; need.add(`${l.body}.glb`); if (l.hair) need.add(HAIR[l.hair]); if (l.beard) need.add("beard.glb"); }
  const [hdrBuf] = await Promise.all([fetchBytes("lebombo_1k.hdr"), ...[...need].map(loadGltf)]);
  const got = async n => loadGltf(n);

  // Light: the HDRI for everything soft, one warm key for shadows.
  const hdr = new T.HDRLoader().parse(hdrBuf);
  const tex = new T.DataTexture(hdr.data, hdr.width, hdr.height, T.RGBAFormat, hdr.type);
  tex.mapping = T.EquirectangularReflectionMapping; tex.colorSpace = T.LinearSRGBColorSpace;
  tex.minFilter = tex.magFilter = T.LinearFilter; tex.generateMipmaps = false; tex.flipY = true; tex.needsUpdate = true;
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  scene.environmentIntensity = 0.55;
  tex.dispose(); pmrem.dispose();
  const key = new T.DirectionalLight("#ffe2c0", 2.2);
  key.position.set(-3, 5, 3);
  key.target.position.set(0, 0, -0.5);
  scene.add(key, key.target);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 14 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
  }
  const practical = new T.PointLight("#ffb46b", 3, 5, 2);
  practical.position.set(-2.3, 1.6, -1.6);
  scene.add(practical);
  scene.add(furnish(await got("room.glb")));

  const clips = {};
  for (const c of [...(await got("moves-1.glb")).animations, ...(await got("moves-2.glb")).animations]) clips[c.name] = c;
  const cast = {};
  for (const name of names) {
    const l = looks[name];
    const body = T.cloneSkinned((await got(`${l.body}.glb`)).scene);
    body.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    dress(body, l.outfit);
    tintHair(body, l.hairTint);
    if (l.hair) wear(body, T.cloneSkinned((await got(HAIR[l.hair])).scene), l.hairTint);
    if (l.beard) wear(body, T.cloneSkinned((await got("beard.glb")).scene), l.hairTint);
    const holder = new T.Group();
    holder.add(body);
    scene.add(holder);
    let head = null;
    body.traverse(o => { if (o.isBone && o.name === "Head") head = o; });
    cast[name] = { holder, body, mixer: new T.AnimationMixer(body), actions: {}, head };
  }
  return { scene, cast, clips, clipNames: Object.keys(clips) };
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
    cur.enabled = true; cur.play(); cur.time = Math.max(0, t - seg[0]); cur.setEffectiveWeight(fade);
    if (prev && fade < 1) {
      const pa = action(world, p, prev[1]);
      pa.enabled = true; pa.play(); pa.time = t - prev[0]; pa.setEffectiveWeight(1 - fade);
    }
    p.mixer.update(0);
    const pl = places[name];
    p.holder.visible = !pl.off;
    p.holder.position.set(pl.at[0], 0, pl.at[1]);
    p.holder.rotation.y = pl.facing;
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
  const c = cameraFor(shot, heads, facing, pair);
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

/** draw(t) → the shot's name. With `loop`, t wraps (the probe fills two minutes with 30 s). */
export function frameFn(stage) {
  const { renderer, world, camera, ctx, film, shotAt, loop } = stage;
  return t => {
    const lt = loop ? t % loop : t;
    const places = poseAll(world, film, lt);
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
export async function soundtrack(seconds, voices = [], { music = true } = {}) {
  const rate = 48000, ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  if (music) addMusic(ctx, master, seconds, rate);
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
export async function makeVideo(stage, { seconds, fps, voices = [], music = true, onProgress, onFrame }) {
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
    audio = await soundtrack(seconds, voices, { music });
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
  poseAll(world, film, 0); aim(camera, world, film, 0, shotAt, placesAt(film, 0));
  renderer.compile(world.scene, camera);
  renderer.render(world.scene, camera);
  return Object.assign(stage, { loadMs: performance.now() - t0, bytes: bytesLoaded.total });
}

/** A new film on the same stage (same people, same looks): no reload. */
export function recast(stage, film) {
  stage.film = film;
  for (const p of Object.values(stage.world.cast)) { p.mixer.stopAllAction(); p.actions = {}; }
  return stage;
}
