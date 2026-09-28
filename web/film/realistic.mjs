// "Realistic" people (Microsoft Rocketbox, MIT) acted by Film's own moves.
//
// Rocketbox people have a 3ds Max Biped skeleton in an A-pose; Film's 84 moves
// are made for Quaternius's skeleton in a T-pose. So each person is two things
// in the same place: the Quaternius body, invisible, which the stage poses
// exactly as before (clips, props, the speaking nod), and the Rocketbox person,
// which copies it every frame. What is copied is each bone's turn away from
// its rest pose (world-space deltas), after the Rocketbox skeleton has been bent
// once into the same T-pose — so different rest poses and bone axes don't
// matter. The hips copy the driver's position. Rocketbox faces have bones:
// the jaw opens with the voice, and eyelids blink. docs/film-plan.md.
import * as T from "../vendor/three.mjs?v=1";

// Quaternius bone → Biped bone.
const MAP = { pelvis: "Bip01_Pelvis", spine_01: "Bip01_Spine", spine_02: "Bip01_Spine1", spine_03: "Bip01_Spine2", neck_01: "Bip01_Neck", Head: "Bip01_Head" };
for (const [s, S] of [["l", "L"], ["r", "R"]]) {
  Object.assign(MAP, {
    [`clavicle_${s}`]: `Bip01_${S}_Clavicle`, [`upperarm_${s}`]: `Bip01_${S}_UpperArm`, [`lowerarm_${s}`]: `Bip01_${S}_Forearm`, [`hand_${s}`]: `Bip01_${S}_Hand`,
    [`thigh_${s}`]: `Bip01_${S}_Thigh`, [`calf_${s}`]: `Bip01_${S}_Calf`, [`foot_${s}`]: `Bip01_${S}_Foot`, [`ball_${s}`]: `Bip01_${S}_Toe0`,
  });
  [["thumb", 0], ["index", 1], ["middle", 2], ["ring", 3], ["pinky", 4]].forEach(([f, n]) =>
    [1, 2, 3].forEach(k => { MAP[`${f}_0${k}_${s}`] = `Bip01_${S}_Finger${n}${k === 1 ? "" : k - 1}`; }));
}
// Which child a bone points at, to line the two rest poses up.
const AIM = { pelvis: "spine_01", spine_01: "spine_02", spine_02: "spine_03", spine_03: "neck_01", neck_01: "Head" };
for (const s of ["l", "r"]) Object.assign(AIM, {
  [`clavicle_${s}`]: `upperarm_${s}`, [`upperarm_${s}`]: `lowerarm_${s}`, [`lowerarm_${s}`]: `hand_${s}`, [`hand_${s}`]: `middle_01_${s}`,
  [`thigh_${s}`]: `calf_${s}`, [`calf_${s}`]: `foot_${s}`, [`foot_${s}`]: `ball_${s}`,
  ...Object.fromEntries(["thumb", "index", "middle", "ring", "pinky"].flatMap(f => [[`${f}_01_${s}`, `${f}_02_${s}`], [`${f}_02_${s}`, `${f}_03_${s}`]])),
});

const bonesOf = root => { const b = {}; root.traverse(o => { if (o.isBone) b[o.name] = o; }); return b; };
const wq = o => o.getWorldQuaternion(new T.Quaternion()), wp = o => o.getWorldPosition(new T.Vector3());

/**
 * Make `person` (a Rocketbox scene, added to `holder`) follow `driver` (the
 * Quaternius body, same holder). Call with both at rest and the holder at the
 * origin. Returns update(say, t): call after the driver is posed each frame.
 */
export function follow(driver, person, holder, { name = "" } = {}) {
  holder.updateMatrixWorld(true);
  const S = bonesOf(driver), P = bonesOf(person);
  const pairs = [];
  driver.traverse(o => { if (o.isBone && MAP[o.name] && P[MAP[o.name]]) pairs.push([o, P[MAP[o.name]]]); });   // parents first

  // The same height as the driver, so sets, seats and the camera all fit.
  const h = b => wp(b).y;
  person.scale.multiplyScalar(h(S.Head) / Math.max(0.01, h(P.Bip01_Head)));
  person.updateMatrixWorld(true);

  // Bend the person's rest pose into the driver's (A-pose arms up to a T, and so on).
  for (const [s, t] of pairs) {
    const aim = AIM[s.name];
    if (!aim || !S[aim] || !P[MAP[aim]]) continue;
    const want = wp(S[aim]).sub(wp(s)).normalize(), have = wp(P[MAP[aim]]).sub(wp(t)).normalize();
    const turn = new T.Quaternion().setFromUnitVectors(have, want);
    t.quaternion.copy(wq(t.parent).invert().multiply(turn.multiply(wq(t))));
    t.updateMatrixWorld(true);
  }
  // Each bone's rest in both, and the hips' offset between them (in the holder's space).
  const rest = pairs.map(([s, t]) => wq(s).invert().multiply(wq(t)));
  const hipGap = holder.worldToLocal(wp(P.Bip01_Pelvis)).sub(holder.worldToLocal(wp(S.pelvis)));

  // The face: the jaw's rest, and which of its axes drops the chin.
  const jaw = P.Bip01_MJaw, jawRest = jaw?.quaternion.clone(), lids = ["Bip01_LEyeBlinkTop", "Bip01_REyeBlinkTop"].map(n => P[n]).filter(Boolean);
  const lidRest = lids.map(b => b.quaternion.clone());
  let jawAxis = null;
  if (jaw && P.Bip01_MBottomLip) {
    let best = 0;
    for (const axis of [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)]) for (const sign of [1, -1]) {
      const before = wp(P.Bip01_MBottomLip).y;
      jaw.quaternion.copy(jawRest).multiply(new T.Quaternion().setFromAxisAngle(axis, 0.25 * sign)); jaw.updateMatrixWorld(true);
      const drop = before - wp(P.Bip01_MBottomLip).y;
      if (drop > best) { best = drop; jawAxis = axis.clone().multiplyScalar(sign); }
      jaw.quaternion.copy(jawRest); jaw.updateMatrixWorld(true);
    }
  }
  // …and which way each upper eyelid turns to close: whichever lowers the skin it moves.
  // (glTF splits a person into a mesh per material; the eyelid skin is in whichever holds the face.)
  const skins = []; person.traverse(o => { if (o.isSkinnedMesh) skins.push(o); });
  const lidVerts = lids.map(b => {
    const out = [];
    for (const m of skins) {
      const k = m.skeleton.bones.indexOf(b); if (k < 0) continue;
      const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
      for (let i = 0; i < si.count && out.length < 24; i++) for (let j = 0; j < 4; j++) if (si.getComponent(i, j) === k && sw.getComponent(i, j) > 0.4) { out.push([m, i]); break; }
    }
    return out;
  });
  const skinY = verts => { if (!verts.length) return 0; let y = 0; const p = new T.Vector3(); for (const [m, i] of verts) { m.skeleton.update(); m.getVertexPosition(i, p); y += m.localToWorld(p).y; } return y / verts.length; };
  const lidAxes = lids.map((b, i) => {
    let best = 0, pick = null;
    for (const axis of [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)]) for (const sign of [1, -1]) {
      const before = skinY(lidVerts[i]);
      b.quaternion.copy(lidRest[i]).multiply(new T.Quaternion().setFromAxisAngle(axis, 0.3 * sign)); b.updateMatrixWorld(true);
      const drop = before - skinY(lidVerts[i]);
      if (drop > best) { best = drop; pick = axis.clone().multiplyScalar(sign); }
      b.quaternion.copy(lidRest[i]); b.updateMatrixWorld(true);
    }
    return pick;
  });
  update.lidY = () => skinY(lidVerts[0] || []) - wp(P.Bip01_Head).y;   // the lid against the head, so a nod is not a blink
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const q = new T.Quaternion(), v = new T.Vector3();

  function update(say = 0, t = 0) {
    pairs.forEach(([s, b], i) => {
      q.copy(wq(s)).multiply(rest[i]);
      b.quaternion.copy(wq(b.parent).invert().multiply(q));
      b.updateMatrixWorld(true);
    });
    // Hips where the driver's are (sitting on the same seat).
    v.copy(holder.worldToLocal(wp(S.pelvis))).add(hipGap);
    holder.localToWorld(v);
    P.Bip01_Pelvis.parent.worldToLocal(v);
    P.Bip01_Pelvis.position.copy(v);
    P.Bip01_Pelvis.updateMatrixWorld(true);
    // Speaking opens the jaw; eyelids blink every few seconds (a function of t, like everything else).
    if (jawAxis) jaw.quaternion.copy(jawRest).multiply(q.setFromAxisAngle(jawAxis, 0.3 * say));
    const phase = (t + (seed % 17) * 0.37) % 4.1, shut = phase < 0.14 ? Math.sin(phase / 0.14 * Math.PI) : 0;
    lids.forEach((b, i) => { b.quaternion.copy(lidRest[i]); if (lidAxes[i] && shut) b.quaternion.multiply(q.setFromAxisAngle(lidAxes[i], 1.0 * shut)); });
  }
  return update;
}

/** Where a held prop should sit: shifted from the driver's hand to the person's. */
export function handOf(person) { return bonesOf(person).Bip01_R_Hand || null; }
