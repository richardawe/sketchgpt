// Film, stage 0: what can this device do? (docs/film-plan.md)
//
// One room, two people from the free CC0 packs, a hand-written 30-second scene
// looped to the video's length, cut by rule, subtitles, a music bed made on
// the page and, if the person records one, their own voice line. The stage
// (web/film/stage.mjs) draws it; this file is only the scene and its shots.
import { setup as stageSetup, frameFn, makeVideo as stageVideo, LOOKS } from "./stage.mjs?v=6";

const RUN_KEY = "sketchgpt.film.probe.run";
const LOOP = 30;

// Times in seconds. Each person's timeline: [start, clip, {from, to} or {at, face}].
const SOFA = [-0.9, -1.2], DOOR = [2.1, 1.6], MID = [0.6, 0.1], WINDOW = [-1.6, 0.6], UP = [-0.9, -0.7];
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
  [10.1, "Idle_Talking_Loop", { at: UP, face: "other" }],
  [14, "Yes", { at: UP, face: "other", once: true }],
  [16.5, "Idle_Loop", { at: UP, face: "other" }],
  [19.5, "Consume", { at: UP, face: "other", once: true }],
  [21, "Idle_Loop", { at: UP, face: "other" }],
  [25, "Idle_Talking_Loop", { at: UP, face: "other" }],
  [28, "Idle_Loop", { at: UP, face: "other" }],
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
export const PROBE_FILM = { people: { woman: { timeline: WOMAN }, man: { timeline: MAN } }, lines: LINES, actions: [], scenes: [0], length: LOOP };

// Wide at the start and on movement; on a line, the speaker; otherwise both.
function shotAt(t) {
  const line = LINES.find(([a, b]) => t >= a - 0.15 && t < b + 0.35);
  if (!line) return t < 3.4 || (t >= 16.5 && t < 19.5) || t >= 28 ? "wide" : "two";
  return line[2];
}

export async function setup(glCanvas, outCanvas, { width = 720, height = 1280, shadows = true } = {}) {
  return stageSetup(glCanvas, outCanvas, PROBE_FILM, { looks: { woman: LOOKS[0], man: LOOKS[1] }, shotAt, loop: LOOP, width, height, shadows });
}

/** The recorded line goes under the woman's first line, every loop. */
export function makeVideo(stage, { seconds, fps, voice, onProgress, onFrame }) {
  const voices = [];
  if (voice) for (let t = LINES[0][0]; t < seconds; t += LOOP) voices.push({ at: t, buffer: voice });
  return stageVideo(stage, { seconds, fps, voices, onProgress, onFrame });
}

export { frameFn, RUN_KEY, LOOP, LINES };
