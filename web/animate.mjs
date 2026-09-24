// Moving pictures, from the page alone. PROTOTYPE — not wired into the app yet.
//
// The model's job does not change: it names nouns, and the page already knows
// what each thing it drew is and where (renderSketch tags every picture with
// data-thing and data-at). So the page can move them:
//
//   1. by what they are — birds cross the sky, fish swim, clouds drift, trees
//      sway, waves roll, the sun glows, everyone else breathes;
//   2. by what the page's words say they do — "Pip jumps into the water … He
//      swims" makes the dog hop, then swim. The same trick as planFromWords():
//      the page reads its own text; nothing is asked of the model.
//
// Costs no tokens and no download. Whole-picture moves only (hop, lean, cross,
// bob): Twemoji pictures have no separate limbs, so there are no walk cycles.
// Honours prefers-reduced-motion by doing nothing.
import { drawAs, nameWords } from "./book.mjs?v=8";
import { sentences } from "./voice.mjs?v=9";

// What a thing does when nothing in the story tells it to do anything.
const KINDS = [
  ["fly", /^(bird|owl|eagle|parrot|bee|butterfly|bug|plane|helicopter|ufo|kite|balloon|parachute)$/],
  ["swim", /^(fish|tropical-fish|whale|dolphin|shark|octopus)$/],
  ["drift", /^cloud/],
  ["glow", /^sun$/],
  ["twinkle", /^(star|moon|comet|sparkler|snowflake)$/],
  ["sway", /^(tree-.*|christmas-tree|cactus|sprout|flower|tulip|rose|sunflower|leaf|maple-leaf|wheat|mushroom)$/],
  ["flicker", /^(flame|candle)$/],
  ["rock", /^(sailboat|ship|canoe|speedboat)$/],
  ["roll", /^(wave|ripple)$/],
];
const kindOf = thing => (KINDS.find(([, re]) => re.test(thing)) || ["breathe"])[0];

// What the words say a character does. Order matters only within a sentence.
const ACTIONS = [
  ["hop", /\b(jump(s|ed|ing)?|hop(s|ped|ping)?|leap(s|t|ed)?|bounce[sd]?)\b/i],
  ["fly", /\b(fl(y|ies|ew|ying)|soar(s|ed|ing)?|glide[sd]?)\b/i],
  ["swim", /\b(swim(s|ming)?|swam|splash(es|ed)?|dive[sd]?|paddle[sd]?)\b/i],
  ["run", /\b(run(s|ning)?|ran|race[sd]?|dash(es|ed)?|hurr(y|ies|ied)|walk(s|ed)?|went|chas(e|es|ed|ing)|follow(s|ed)?|return(s|ed)?|reach(es|ed)?)\b/i],
  ["sleep", /\b(sleep(s|ing)?|slept|asleep|nap(s|ped)?|rest(s|ed)?)\b/i],
  ["dance", /\b(danc(e|es|ed|ing)|spin(s|ning)?|spun|twirl(s|ed)?|play(s|ed|ing)?)\b/i],
  ["look", /\b(look(s|ed)?|sees?|saw|watch(es|ed)?|peek(s|ed)?|finds?|found|discover(s|ed)?)\b/i],
  ["cheer", /\b(smil(e|es|ed)|laugh(s|ed)?|cheer(s|ed)?|celebrat(e|es|ed)|hug(s|ged)?)\b/i],
];

// A wish is not a deed. "He dreams of swimming", "Lucky wants to see the sea"
// and "he can't find it" happen nowhere on the page — in the first recorded
// book the dog dived into the sea on the page where he had never left the woods.
const NOT_DONE = /\b(wants?|wanted|dreams?|dreamed|dreamt|wish(es|ed)?|hopes?|hoped|loves?|likes?|can't|cannot|couldn't|never|not|don't|doesn't|didn't|won't)\b/i;
function done(sentence, re) {
  for (const m of sentence.matchAll(new RegExp(re.source, "gi"))) {
    const words = sentence.slice(0, m.index).trim().split(/\s+/);
    // "tells him to follow" is an instruction, not a deed; "tries to find" is a deed.
    const told = words.at(-1)?.toLowerCase() === "to" && !/^(tr(y|ies|ied)|starts?|started|begins?|began)$/i.test(words.at(-2) || "");
    if (!NOT_DONE.test(words.slice(-4).join(" ")) && !told) return m.index;
  }
  return -1;
}

const LASTING = new Set(["fly", "swim", "sleep", "dance"]);

/**
 * Who does what on this page, in the order the words say it. Each sentence's
 * doer is the first character it names; a sentence that names nobody ("He
 * swims") keeps the last one named, and a page that names nobody is the hero's.
 * Returns Map(character → [action, …]).
 */
export function pageActions(text, cast = []) {
  const people = cast.map(c => ({ c, words: new Set(nameWords(c.name)) }));
  const acts = new Map();
  let doer = cast[0] || null;
  for (const sentence of sentences(text)) {
    const named = sentence.split(/[^A-Za-z'.-]+/).map(w => w.toLowerCase().replace(/[.']+$/, ""))
      .map(w => people.find(p => p.words.has(w))).find(Boolean);
    if (named) doer = named.c;
    if (!doer) continue;
    const found = ACTIONS.map(([act, re]) => [act, done(sentence, re)]).filter(([, at]) => at >= 0)
      .sort((a, b) => a[1] - b[1]).map(([act]) => act);
    const list = acts.get(doer) || [];
    // An action that can go on (swim, fly, sleep, dance) is where a picture
    // settles: nothing after it. "Pip jumps in … He swims and plays, chasing
    // fish" is a hop, then swimming — not a hop, a swim, a dance and a run.
    for (const act of found) if (!list.some(a => LASTING.has(a)) && !list.includes(act)) list.push(act);
    if (list.length) acts.set(doer, list);
  }
  return acts;
}

// How far down (negative: up) a thing at `at` must move to sit in the water,
// or 0 if there is no water or it is already in it. The ripple lines the page
// drew across the water mark it.
function intoWater(svg, [, y]) {
  const waves = [...svg.querySelectorAll('[data-thing="ripple"]')].map(w => w.getBBox());
  if (!waves.length) return 0;
  const top = Math.min(...waves.map(b => b.y)), bottom = Math.max(...waves.map(b => b.y + b.height));
  if (y >= top && y <= bottom + 20) return 0;
  return Math.round((top + bottom) / 2 + 14 - y);
}

// One layer per kind of motion, so an idle loop, an entrance and an action can
// all run at once without fighting over one transform.
function wrap(node) {
  const g = node.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
  node.replaceWith(g); g.append(node);
  g.style.transformBox = "fill-box";
  g.style.transformOrigin = "50% 100%";
  return g;
}

const loop = (el, frames, ms, delay = 0, extra = {}) =>
  el.animate(frames, { duration: ms, iterations: Infinity, direction: "alternate", easing: "ease-in-out", delay, ...extra });

function idle(el, kind, i, [x, , size]) {
  const d = i * 173 % 900;                         // stagger, stable per picture
  switch (kind) {
    case "fly": return loop(el, [{ transform: "translate(-22px, 0px)" }, { transform: "translate(0px, -10px)" },
      { transform: "translate(22px, 0px)" }], 2600 + d, d, { easing: "ease-in-out" });
    case "swim": return loop(el, [{ transform: "translate(-16px, 3px) rotate(-4deg)" }, { transform: "translate(16px, -3px) rotate(4deg)" }], 1900 + d, d);
    case "drift": return loop(el, [{ transform: "translateX(-12px)" }, { transform: "translateX(12px)" }], 7000 + d * 3, d);
    case "glow": return loop(el, [{ transform: "scale(1) rotate(0deg)", transformOrigin: "50% 50%" },
      { transform: "scale(1.07) rotate(8deg)", transformOrigin: "50% 50%" }], 3000, d);
    case "twinkle": return loop(el, [{ opacity: 1 }, { opacity: 0.45 }], 900 + d, d);
    case "sway": return loop(el, [{ transform: "rotate(-2.5deg)" }, { transform: "rotate(2.5deg)" }], 2200 + d, d);
    case "flicker": return loop(el, [{ transform: "scaleY(1)" }, { transform: "scaleY(1.12)" }], 260 + d / 6, d);
    case "rock": return loop(el, [{ transform: "rotate(-4deg) translateY(0px)" }, { transform: "rotate(4deg) translateY(-4px)" }], 1800, d);
    case "roll": return loop(el, [{ transform: "translateX(-10px)" }, { transform: "translateX(10px)" }], 2400 + d, d);
    default: return loop(el, [{ transform: "scaleY(1)" }, { transform: "scaleY(1.035)" }], 1400 + d, d);
  }
}

// An action plays once, then the next; the last one keeps going.
function act(el, action, last, at) {
  const [x, , size] = at;
  const n = last ? Infinity : 2;
  const o = { easing: "ease-in-out" };
  switch (action) {
    case "hop": return el.animate([{ transform: "translateY(0px) scale(1.08, 0.9)" }, { transform: "translateY(-38px) scale(0.95, 1.06)" },
      { transform: "translateY(0px) scale(1.08, 0.9)" }], { duration: 650, iterations: n === Infinity ? Infinity : 2, ...o });
    case "fly": return el.animate([{ transform: "translate(-40px, 0px)" }, { transform: "translate(0px, -26px)" }, { transform: "translate(40px, 0px)" },
      { transform: "translate(0px, -26px)" }, { transform: "translate(-40px, 0px)" }], { duration: 3200, iterations: n, ...o });
    case "swim": return el.animate([{ transform: "translate(-14px, 4px) rotate(-6deg)" }, { transform: "translate(14px, -4px) rotate(6deg)" },
      { transform: "translate(-14px, 4px) rotate(-6deg)" }], { duration: 1600, iterations: n, ...o });
    case "run": return el.animate([{ transform: `translateX(${-(x + size)}px)` }, { transform: "translateX(0px)" }],
      { duration: 1400, iterations: 1, easing: "cubic-bezier(.2,.7,.3,1.2)" });
    case "sleep": return el.animate([{ transform: "translateY(4px) scaleY(0.96)" }, { transform: "translateY(4px) scaleY(1)" }],
      { duration: 2200, iterations: n, direction: "alternate", ...o });
    case "dance": return el.animate([{ transform: "rotate(-10deg)" }, { transform: "rotate(10deg) translateY(-6px)" }, { transform: "rotate(-10deg)" }],
      { duration: 700, iterations: n === Infinity ? Infinity : 3, ...o });
    case "look": return el.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(-7deg)" }],
      { duration: 900, iterations: n === Infinity ? Infinity : 2, direction: "alternate", ...o });
    case "cheer": return el.animate([{ transform: "translateY(0px)" }, { transform: "translateY(-14px)" }, { transform: "translateY(0px)" }],
      { duration: 480, iterations: n === Infinity ? Infinity : 3, ...o });
  }
  return null;
}

/**
 * Bring one rendered picture to life. `svg` is what renderSketch drew; `text`
 * and `story` are the page's words and the book (for its cast). `camera` is
 * the element the slow zoom moves — the box around the picture, so the zoom
 * is an ordinary element transform the browser can hand to the GPU, rather
 * than a redraw of every hand-drawn line inside the SVG.
 *
 * Returns { said, play(), pause(), replay(), stop() }: what it decided (for
 * "How this picture was made"), and controls — a page off screen is paused,
 * a page being read aloud is replayed, a page being printed is stopped still.
 */
export function animatePicture(svg, { text = "", story = { cast: [] }, camera = null } = {}) {
  const view = svg.ownerDocument.defaultView;
  const nothing = { said: ["still: this device asks for reduced motion"], play() {}, pause() {}, replay() {}, stop() {} };
  if (view && view.matchMedia && view.matchMedia("(prefers-reduced-motion: reduce)").matches) return nothing;
  const said = [];
  const things = [...svg.querySelectorAll("[data-thing]")];

  // Who is drawn as what: the first picture of each character's word is them.
  const who = new Map();
  for (const c of story.cast || []) {
    const word = drawAs(c);
    const node = word && things.find(t => t.dataset.thing === word && ![...who.values()].includes(t));
    if (node) who.set(c, node);
  }
  const actions = pageActions(text, story.cast || []);

  // The layers are made once; the motions can be started again and again.
  const parts = things.map((node, i) => {
    const at = (node.dataset.at || "0 0 0").split(" ").map(Number);
    const outer = wrap(node);                        // entrance, then the story's action
    const inner = wrap(outer.firstChild);            // idle loop by kind
    const character = [...who].find(([, n]) => n === node)?.[0];
    const doing = character ? actions.get(character) : null;
    const dive = doing && doing.includes("swim") ? intoWater(svg, at) : 0;
    const place = dive ? wrap(outer) : null;
    if (doing) said.push(`${character.name} (${node.dataset.thing}): ${doing.join(", then ")}`);
    return { node, i, at, outer, inner, doing, dive, place, kind: kindOf(node.dataset.thing) };
  });
  const heroNode = who.get((story.cast || [])[0]);
  const stage = camera || svg;

  let running = [], paused = false, generation = 0;
  const keep = anim => { if (anim) { running.push(anim); if (paused) anim.pause(); } return anim; };

  function start() {
    const run = ++generation;                        // an older chain stops at its next step
    for (const { i, at, outer, inner, doing, dive, place, kind } of parts) {
      // Things arrive one by one, the way a page is drawn.
      const enter = keep(outer.animate([{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "scale(1.06)" },
        { opacity: 1, transform: "scale(1)" }], { duration: 500, delay: 120 * i, fill: "backwards", easing: "ease-out" }));
      if (!doing) { keep(idle(inner, kind, i, at)); continue; }
      if (!doing.includes("fly") && !doing.includes("swim")) keep(idle(inner, "breathe", i, at));
      // Swimming happens in the water. The page drew the water, so it knows
      // where it is: a hero standing on the shore jumps (or slides) into it
      // first. "Pip jumps into the water … He swims" then reads true.
      (async () => {
        try { await enter.finished; } catch { return; }
        if (run !== generation) return;
        if (dive) {
          const leap = keep(place.animate([{ transform: "translate(0px, 0px)" },
            { transform: `translate(0px, ${dive - 46}px)`, offset: 0.55 }, { transform: `translate(0px, ${dive}px)` }],
            { duration: 900, fill: "forwards", easing: "ease-in-out" }));
          try { await leap.finished; } catch { return; }
        }
        // Chain the actions; the last one keeps going.
        for (const [k, a] of doing.entries()) {
          if (run !== generation) return;
          if (dive && a === "hop") continue;          // the leap was the jump
          const anim = keep(act(outer, a, k === doing.length - 1, at));
          if (anim && k < doing.length - 1) try { await anim.finished; } catch { return; }
        }
      })();
    }
    // A slow camera: in toward the hero and back, like a picture-book film.
    const [hx, hy] = heroNode ? heroNode.dataset.at.split(" ").map(Number) : [200, 200];
    stage.style.transformOrigin = `${(hx / 4).toFixed(1)}% ${(hy / 4).toFixed(1)}%`;
    keep(stage.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }],
      { duration: 9000, iterations: Infinity, direction: "alternate", easing: "ease-in-out" }));
  }
  function stop() { generation++; running.forEach(a => a.cancel()); running = []; }
  start();
  return {
    said,
    play() { paused = false; running.forEach(a => a.play()); },
    pause() { paused = true; running.forEach(a => a.pause()); },
    replay() { stop(); paused = false; start(); },
    stop,
  };
}
