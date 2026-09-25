// Film, stage 0: what can this device do? (docs/film-plan.md)
//
// One room, two people from the free CC0 packs, a scripted 30-second scene
// looped to the video's length, cut by rule (wide, then shot/reverse-shot on
// whoever speaks), subtitles, a music bed made on the page and, if the person
// records one, their own voice line. Then the numbers: preview frame rate, how
// long the video takes to make, how big it is, and — if the tab dies — how far
// it got, read back on the next visit.
//
// No model, no network after the assets. three.js (MIT), Quaternius (CC0),
// Kenney (CC0), Poly Haven (CC0), Mediabunny (MPL-2.0).
import * as T from "../vendor/three.mjs?v=1";

const ASSETS = new URL("./assets/", import.meta.url).href;
const RUN_KEY = "sketchgpt.film.probe.run";

// ---------------------------------------------------------------- the scene
// Times in seconds. Each person's timeline: [start, clip, {from, to, face}].
// Positions are metres on the floor (x right, z towards the camera's wide).
const LOOP = 30;
const SOFA = [-0.9, -1.2], DOOR = [2.1, 1.6], MID = [0.6, 0.1], WINDOW = [-1.6, 0.6];
const WOMAN = [
  [0, "Walk_Loop", { from: DOOR, to: MID }],
  [3.4, "Idle_Talking_Loop", { at: MID, face: "other" }],
  [9, "Idle_FoldArms_Loop", { at: MID, face: "other" }],
  [14, "Idle_No_Loop", { at: MID, face: "other" }],
  [16.5, "Walk_Formal_Loop", { from: MID, to: WINDOW }],
  [19.5, "Idle_TalkingPhone_Loop", { at: WINDOW, face: [-2.6, 1.2] }],
  [25, "Idle_Talking_Loop", { at: WINDOW, face: "other" }],
  [28, "Walk_Loop", { from: WINDOW, to: DOOR }],
];
const MAN = [
  [0, "Sitting_Idle_Loop", { at: SOFA, sit: true, face: [-0.9, 0] }],
  [5.5, "Sitting_Talking_Loop", { at: SOFA, sit: true, face: "other" }],
  [9, "Sitting_Exit", { at: SOFA, sit: true, face: "other", once: true }],
  [10.1, "Idle_Talking_Loop", { at: [-0.9, -0.7], face: "other" }],
  [14, "Yes", { at: [-0.9, -0.7], face: "other", once: true }],
  [16.5, "Idle_Loop", { at: [-0.9, -0.7], face: "other" }],
  [19.5, "Consume", { at: [-0.9, -0.7], face: "other", once: true }],
  [21, "Idle_Loop", { at: [-0.9, -0.7], face: "other" }],
  [25, "Idle_Talking_Loop", { at: [-0.9, -0.7], face: "other" }],
  [28, "Idle_Loop", { at: [-0.9, -0.7], face: "other" }],
];
// Lines: [start, end, speaker, text]. Speaking decides the shot.
const LINES = [
  [3.6, 5.4, "woman", "You said you'd be gone by now."],
  [5.6, 8.8, "man", "I said a lot of things. Sit down, Maya."],
  [10.2, 13.6, "man", "The money's gone. All of it. I'm sorry."],
  [14.1, 16.2, "woman", "No. Don't you dare say sorry to me."],
  [19.8, 24.5, "woman", "It's me. He knows. Tell them to wait."],
  [25.2, 27.8, "man", "Who was that? Maya — who was that?"],
];
// Shots: the page's rules, not a list per film. Wide at every scene start and
// on movement; on a line, a close shot of the speaker, kept on the audience's
// side of the line between the two people (the 180° rule).
function shotAt(t) {
  const line = LINES.find(([a, b]) => t >= a - 0.15 && t < b + 0.35);
  if (!line) return t < 3.4 || (t >= 16.5 && t < 19.5) || t >= 28 ? "wide" : "two";
  return line[2];
}

// ---------------------------------------------------------------- loading
const bytesLoaded = { total: 0 };
async function fetchBytes(name) {
  const r = await fetch(ASSETS + name);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const b = await r.arrayBuffer();
  bytesLoaded.total += b.byteLength;
  return b;
}
function gltfLoader() {
  const l = new T.GLTFLoader();
  l.setMeshoptDecoder(T.MeshoptDecoder);
  return l;
}
const loadGltf = async name => gltfLoader().parseAsync(await fetchBytes(name), ASSETS);

// Hair is its own skinned mesh on the same rig: rebind it to the body's bones.
function wear(body, hairGltf, tint) {
  const bones = {};
  body.traverse(o => { if (o.isBone) bones[o.name] = o; });
  const skinned = [];
  hairGltf.scene.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
  const host = (() => { let h = null; body.traverse(o => { if (!h && o.isSkinnedMesh) h = o.parent; }); return h; })();
  for (const m of skinned) {
    const sk = new T.Skeleton(m.skeleton.bones.map(b => bones[b.name] || b), m.skeleton.boneInverses);
    host.add(m);
    m.bind(sk, m.bindMatrix);
    if (tint) m.material = m.material.clone(), m.material.color = new T.Color(tint);
    m.castShadow = true;
  }
}

// The free tier's bodies come in underwear, and Quaternius's only outfit kit is
// fantasy. So clothes are painted on: each vertex is shirt, trousers or shoes
// by which bones move it (skin weights), and the shader lays the colour over
// the skin texture. No download; it reads as a fitted outfit, not as cloth.
const TOP = /^(spine_0[123]|clavicle_|upperarm_|lowerarm_)/, BOTTOM = /^(pelvis|thigh_|calf_)/, SHOES = /^(foot_|ball_)/;
function dress(body, { top, bottom, shoes, sleeves = 1 }) {
  body.traverse(m => {
    if (!m.isSkinnedMesh || m.geometry.attributes.position.count < 3000) return;
    const names = m.skeleton.bones.map(b => b.name);
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    const g = new Float32Array(si.count * 3);
    for (let v = 0; v < si.count; v++) for (let k = 0; k < 4; k++) {
      const name = names[si.getComponent(v, k)] || "", w = sw.getComponent(v, k);
      if (TOP.test(name) && !(sleeves < 1 && /^lowerarm_/.test(name))) g[v * 3] += w;
      else if (BOTTOM.test(name)) g[v * 3 + 1] += w;
      else if (SHOES.test(name)) g[v * 3 + 2] += w;
    }
    m.geometry.setAttribute("garment", new T.BufferAttribute(g, 3));
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
        // Keep a little of the body's shading so the folds of the skin texture read as cloth.
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

async function buildWorld(renderer, { shadows }) {
  const scene = new T.Scene();
  scene.background = new T.Color("#1b1714");

  const [hdrBuf, room, woman, man, hairLong, hairParted, beard, moves1, moves2] = await Promise.all([
    fetchBytes("lebombo_1k.hdr"), loadGltf("room.glb"), loadGltf("woman.glb"), loadGltf("man.glb"),
    loadGltf("hair-long.glb"), loadGltf("hair-parted.glb"), loadGltf("beard.glb"), loadGltf("moves-1.glb"), loadGltf("moves-2.glb")]);

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

  scene.add(furnish(room));

  // People. The free tier has two bodies; hair, colour and height make them two people.
  const cast = {};
  const OUTFIT = { woman: { top: "#7b1e2b", bottom: "#1d2330", shoes: "#141414" }, man: { top: "#c9c3b8", bottom: "#3b3f46", shoes: "#3a2a1e" } };
  for (const [name, g, hair, extra, tint, height] of [["woman", woman, hairLong, null, "#3a2418", 1.0], ["man", man, hairParted, beard, "#2a2320", 1.0]]) {
    const body = g.scene;
    body.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    dress(body, OUTFIT[name]);
    tintHair(body, tint);
    wear(body, hair, tint);
    if (extra) wear(body, extra, tint);
    body.scale.setScalar(height);
    const holder = new T.Group();
    holder.add(body);
    scene.add(holder);
    const mixer = new T.AnimationMixer(body);
    const clips = {};
    for (const c of [...moves1.animations, ...moves2.animations]) clips[c.name] = c;
    let head = null;
    body.traverse(o => { if (o.isBone && o.name === "Head") head = o; });
    cast[name] = { holder, body, mixer, clips, actions: {}, head, timeline: name === "woman" ? WOMAN : MAN };
  }
  const clipNames = Object.keys(cast.woman.clips);
  return { scene, cast, clipNames };
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
  put("loungeSofa", SOFA[0], SOFA[1] - 0.25);
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

// ---------------------------------------------------------------- posing
const smooth = x => x * x * (3 - 2 * x);
function segAt(timeline, t) {
  let i = 0;
  while (i + 1 < timeline.length && timeline[i + 1][0] <= t) i++;
  return i;
}
function spot(seg, t, end) {
  const o = seg[2];
  if (o.at) return o.at;
  const k = Math.min(1, (t - seg[0]) / Math.max(0.01, end - seg[0]));
  return [o.from[0] + (o.to[0] - o.from[0]) * k, o.from[1] + (o.to[1] - o.from[1]) * k];
}
function action(p, name) {
  if (!p.actions[name]) {
    const clip = p.clips[name];
    if (!clip) throw new Error(`No clip "${name}" in the free tier`);
    const a = p.mixer.clipAction(clip);
    if (!/_Loop$/.test(name)) { a.setLoop(T.LoopOnce, 1); a.clampWhenFinished = true; }
    p.actions[name] = a;
  }
  return p.actions[name];
}

// Everything at time t is a function of t: the preview and the video frames
// are the same picture, and a frame can be made in any order.
function poseAll(world, t) {
  const lt = t % LOOP;
  const pos = {};
  for (const [name, p] of Object.entries(world.cast)) {
    const i = segAt(p.timeline, lt), seg = p.timeline[i];
    const end = (p.timeline[i + 1] || [LOOP])[0];
    const prev = p.timeline[i - 1];
    for (const a of Object.values(p.actions)) a.setEffectiveWeight(0);
    const fade = prev ? smooth(Math.min(1, (lt - seg[0]) / 0.35)) : 1;
    const cur = action(p, seg[1]);
    cur.enabled = true; cur.play(); cur.time = lt - seg[0]; cur.setEffectiveWeight(fade);
    if (prev && fade < 1) {
      const pa = action(p, prev[1]);
      pa.enabled = true; pa.play(); pa.time = lt - prev[0]; pa.setEffectiveWeight(1 - fade);
    }
    p.mixer.update(0);
    pos[name] = spot(seg, lt, end);
    p.seg = seg; p.nextFrom = p.timeline[i + 1];
  }
  for (const [name, p] of Object.entries(world.cast)) {
    const [x, z] = pos[name];
    p.holder.position.set(x, 0, z);
    const o = p.seg[2];
    const other = pos[name === "woman" ? "man" : "woman"];
    const look = o.to ? o.to : o.face === "other" ? other : o.face || [x, z + 1];
    const want = Math.atan2(look[0] - x, look[1] - z);
    if (!o.to || Math.hypot(look[0] - x, look[1] - z) > 0.05) p.holder.rotation.y = want;
  }
  return pos;
}

const headOf = p => p.head.getWorldPosition(new T.Vector3());

// The camera, by rule. Wide: from the front corner, the whole room. Two: both
// people, from the camera's side of the line between them. A speaker: close,
// from the side they face, kept on the audience's side of that line.
function aim(camera, world, t) {
  const shot = shotAt(t % LOOP);
  const w = headOf(world.cast.woman), m = headOf(world.cast.man);
  if (shot === "wide") {
    camera.fov = 58; camera.position.set(2.4, 1.75, 3.4); camera.lookAt(-0.4, 0.95, -0.6);
  } else {
    // The line runs woman → man; the camera stays on the +z side (the audience's).
    const line = new T.Vector3().subVectors(m, w).setY(0);
    const side = new T.Vector3(-line.z, 0, line.x).normalize();
    if (side.z < 0) side.negate();
    if (shot === "two") {
      const mid = new T.Vector3().addVectors(w, m).multiplyScalar(0.5);
      camera.fov = 50;
      camera.position.copy(mid).addScaledVector(side, Math.max(2.2, line.length() * 1.6)).setY(1.45);
      camera.lookAt(mid.x, 1.1, mid.z);
    } else {
      // Close on the speaker, from the side they face (a face, not the back of
      // a head), nudged to the audience's side of the line.
      const who = world.cast[shot], speaker = shot === "woman" ? w : m;
      const ry = who.holder.rotation.y, fwd = new T.Vector3(Math.sin(ry), 0, Math.cos(ry));
      camera.fov = 40;
      camera.position.copy(speaker).addScaledVector(fwd, 1.4).addScaledVector(side, 0.35);
      camera.position.y = speaker.y + 0.02;
      camera.lookAt(speaker.x, speaker.y - 0.1, speaker.z);
    }
  }
  camera.updateProjectionMatrix();
  return shot;
}

// ---------------------------------------------------------------- one frame
function subtitle(ctx, t, W, H) {
  const lt = t % LOOP;
  const line = LINES.find(([a, b]) => lt >= a && lt < b);
  if (!line) return;
  const size = Math.round(W / 22);
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const words = line[3].split(" "), lines = [];
  let cur = "";
  for (const wd of words) { const next = cur ? cur + " " + wd : wd; if (ctx.measureText(next).width > W * 0.84 && cur) { lines.push(cur); cur = wd; } else cur = next; }
  lines.push(cur);
  const lh = size * 1.3;
  let y = H - H * 0.09 - (lines.length - 1) * lh;
  ctx.lineJoin = "round"; ctx.lineWidth = size * 0.22; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.fillStyle = "#fff";
  for (const l of lines) { ctx.strokeText(l, W / 2, y); ctx.fillText(l, W / 2, y); y += lh; }
}

export function frameFn(renderer, world, camera, ctx) {
  return t => {
    poseAll(world, t);
    const shot = aim(camera, world, t);
    renderer.render(world.scene, camera);
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.drawImage(renderer.domElement, 0, 0, W, H);
    subtitle(ctx, t, W, H);
    // A cut is a cut: fade from black at each loop start, like a scene opening.
    const k = (t % LOOP);
    if (k < 0.5) { ctx.fillStyle = `rgba(0,0,0,${1 - k / 0.5})`; ctx.fillRect(0, 0, W, H); }
    return shot;
  };
}

// ---------------------------------------------------------------- sound
// A music bed made on the page (no file): a slow minor pad, room tone, and the
// person's own recorded line, if any, under each of the woman's first lines.
export async function soundtrack(seconds, voice = null) {
  const rate = 48000, ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
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
  // Room tone: quiet filtered noise.
  const noise = ctx.createBuffer(1, rate * 2, rate), d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400;
  const ng = ctx.createGain(); ng.gain.value = 0.02;
  n.connect(lp).connect(ng).connect(master); n.start(0); n.stop(seconds);
  if (voice) for (let t = LINES[0][0]; t < seconds; t += LOOP) {
    const v = ctx.createBufferSource(); v.buffer = voice;
    const vg = ctx.createGain(); vg.gain.value = 1.6;
    v.connect(vg).connect(ctx.destination); v.start(t);
  }
  return ctx.startRendering();
}

function sliceAudio(buf, from, to) {
  const a = Math.floor(from * buf.sampleRate), b = Math.min(buf.length, Math.floor(to * buf.sampleRate));
  const out = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}

// ---------------------------------------------------------------- the video
export async function makeVideo({ renderer, world, camera, ctx, seconds, fps, voice, onProgress, onFrame }) {
  const mb = await import("../vendor/mediabunny-film.mjs?v=1");
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
    audio = await soundtrack(seconds, voice);
    audioMs = performance.now() - a0;
  }
  await output.start();

  const draw = frameFn(renderer, world, camera, ctx);
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
    if (audio && t + 1 / fps >= audioSent + 1 || (audio && f === total - 1)) {
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
export async function setup(glCanvas, outCanvas, { width = 720, height = 1280, shadows = true } = {}) {
  const t0 = performance.now();
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
  const world = await buildWorld(renderer, { shadows });
  const camera = new T.PerspectiveCamera(50, width / height, 0.05, 40);
  // Compile every shader and upload every texture before anything is timed.
  poseAll(world, 0); aim(camera, world, 0);
  renderer.compile(world.scene, camera);
  renderer.render(world.scene, camera);
  return { renderer, world, camera, ctx, loadMs: performance.now() - t0, bytes: bytesLoaded.total, T };
}

export { RUN_KEY, LOOP, LINES };
