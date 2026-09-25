// Film, stage 1: plain prose in, a scene out — by rules, no model
// (docs/film-plan.md). Pure: no DOM, no three.js, so every rule has a test.
//
//   readStory(text, { pronouns })  → cast, scenes, beats (lines and actions), notes
//   block(story, { seats })        → per-person timelines, lines with times, length
//   shotAt(film, t)                → which shot the camera takes at t
//   cameraFor(shot, heads, …)      → where it stands; the 180° rule lives here
//
// The rule that runs through it, from Book: the page guesses only where it
// shows the guess. A quote with no "said" is given to someone by the novel's
// convention and marked "guessed"; a pronoun nobody's pronoun matches is not
// guessed at all; a verb with no move is listed, never acted out as something
// else.

export const LIMIT_SECONDS = 120;
export const WPM = 150;

// ---------------------------------------------------------------- words
const SPEECH = {
  said: "plain", says: "plain", say: "plain", told: "plain", tells: "plain", added: "plain", continued: "plain", went: null,
  replied: "plain", replies: "plain", answered: "plain", answers: "plain", repeated: "plain", admitted: "quiet", lied: "plain",
  asked: "ask", asks: "ask", wondered: "ask", demanded: "angry",
  whispered: "quiet", whispers: "quiet", murmured: "quiet", muttered: "quiet", mumbled: "quiet", breathed: "quiet", sighed: "quiet",
  shouted: "angry", shouts: "angry", yelled: "angry", yells: "angry", screamed: "angry", snapped: "angry", snaps: "angry",
  hissed: "angry", barked: "angry", growled: "angry", roared: "angry", spat: "angry",
  laughed: "laugh", laughs: "laugh", joked: "laugh", teased: "laugh", grinned: "laugh", smiled: "laugh",
  cried: "upset", begged: "upset", pleaded: "upset", sobbed: "upset", called: "plain", calls: "plain",
};
delete SPEECH.went;
const SPEECH_RE = Object.keys(SPEECH).join("|");

// Words that start sentences or fill them, and are never a person's name.
const NOT_NAMES = new Set(`the a an he she they it i we you his her hers their them him me my your our its this that these those
then when but and so if as at in on after before later meanwhile suddenly now there here what who whom whose why how where
no yes oh ah well okay ok please sorry hello hi hey don't can't won't didn't isn't wasn't it's i'm i'll i've you're we're
maybe still just only even all every one some nothing everything someone something anyone nobody everyone
mr mrs ms dr god monday tuesday wednesday thursday friday saturday sunday january february march april may june july
august september october november december tonight today tomorrow yesterday morning evening afternoon night outside inside
again together finally both neither not never perhaps for with from by to of into over under out up down off
chapter scene part end fade cut int ext look listen wait stop come go get let tell give look sit stand
thanks thank goodbye bye right sure fine good great`.split(/\s+/));

// A name can be two words when the first is a title.
const TITLE = /^(Mr|Mrs|Ms|Miss|Dr|Detective|Officer|Doctor|Aunt|Uncle|Captain|Professor|Sergeant|Inspector)\.?$/;

// What people do, and the move each is. Clip names are the free Quaternius
// tier's (scripts/film/inventory.mjs); `sit`/`stand` change where they are.
export const MOVES = [
  ["enter", /\b(c[ao]me[s]? (?:in|back|home|inside)|walk(?:s|ed)? in|enter(?:s|ed)?|arriv(?:e|es|ed)|burst(?:s)? in|stepp?(?:ed|s) in|let (?:herself|himself|themselves) in)\b/i],
  ["exit", /\b(le(?:ft|aves?)(?! (?:it|the|a|her|his|them|him)\b)|walk(?:s|ed)? out|went out|goes out|storm(?:s|ed)? out|exit(?:s|ed)?)\b/i],
  ["sit", /\b(s(?:its?|at)(?: back)? down|s(?:its?|at) on|s(?:its?|at)\b(?! up))\b/i],
  ["stand", /\b(st(?:ands?|ood) up|st(?:ands?|ood)\b(?! (?:still|there|by|in|at|behind|beside|near))|got to (?:her|his|their) feet|gets up|got up|rose|rises)\b/i],
  ["walk", /\b(walk(?:s|ed)? (?:to|over|across|toward|towards|back|down|along|up|away)|cross(?:es|ed) (?:to|the room)|went (?:to|over)|goes (?:to|over)|pac(?:es|ed))\b/i],
  ["nod", /\b(nod(?:s|ded)?)\b/i],
  ["no", /\b(shook (?:her|his|their) head|shakes (?:her|his|their) head)\b/i],
  ["arms", /\b((?:crossed|crosses|folded|folds) (?:her|his|their) arms)\b/i],
  ["drink", /\b(drank|drinks?|sipp?(?:ed|s)?|took a (?:sip|drink|swig)|poured)\b/i],
  ["phone", /\b(on the phone|(?:answered|answers|picked up|picks up) the phone|(?:dialled|dialed|dials|called|calls) (?:someone|a number|him|her|them|the police)|took the call|takes the call)\b/i],
  ["punch", /\b(punch(?:es|ed)?|hit (?:him|her|them)|hits (?:him|her|them)|swung at|swings at|slapp?(?:ed|s)?)\b/i],
  ["fall", /\b(f[ae]ll(?:s)?(?! (?:asleep|silent|quiet|in love))|collaps(?:es|ed)|staggered|staggers)\b/i],
  ["die", /\b(di(?:es|ed)|was dead|is dead|lay still|lies still)\b/i],
  ["shoot", /\b(sh(?:oots|ot)(?! (?:a look|a glance|her a|him a|them a))|fired|fires|pulled the trigger)\b/i],
  ["gun", /\b(drew a gun|draws a gun|pulled a gun|pulls a gun|(?:aimed|aims|pointed|points) (?:a|the) (?:gun|pistol))\b/i],
  ["pick", /\b(pick(?:s|ed)? up|grabb?(?:ed|s)|took the|takes the)\b/i],
  ["dance", /\b(danc(?:e|es|ed|ing))\b/i],
  ["push", /\b(push(?:es|ed)|shov(?:es|ed))\b/i],
  ["hold", /\b(with a (?:drink|glass|beer|bottle|coffee|cup|whisky|whiskey|wine)|(?:holding|held|holds) (?:a|her|his|their) (?:drink|glass|beer|bottle|coffee|cup))\b/i],
  ["getup", /\b(got up off the floor|gets up off the floor|picked (?:herself|himself|themselves) up)\b/i],
];
// Clips for each move, standing and (if it differs) seated.
export const CLIPS = {
  idle: ["Idle_Loop", "Sitting_Idle_Loop"],
  talk: ["Idle_Talking_Loop", "Sitting_Talking_Loop"],
  walk: ["Walk_Loop"], enter: ["Walk_Loop"], exit: ["Walk_Loop"],
  sit: ["Sitting_Enter"], stand: [null, "Sitting_Exit"],
  nod: ["Yes"], no: ["Idle_No_Loop"], arms: ["Idle_FoldArms_Loop"], drink: ["Consume"], phone: ["Idle_TalkingPhone_Loop"],
  punch: ["Punch_Cross"], fall: ["Hit_Knockback"], die: ["Death01"], shoot: ["Pistol_Shoot"], gun: ["Pistol_Idle_Loop"],
  pick: ["PickUp_Table"], dance: ["Dance_Loop"], push: ["Push_Loop"], getup: ["LayToIdle"],
};
// How long a move takes on screen, seconds (a loop is held for this long).
const HOLD = { nod: 2.2, no: 2.4, arms: 2.5, drink: 1.6, phone: 3, punch: 1.1, fall: 1.2, die: 2.6, shoot: 1.2, gun: 2,
  pick: 1.4, dance: 3, push: 2.5, getup: 1.6, sit: 1.4, stand: 1.1 };

// A wish, a plan, a refusal or a question is not a deed ("She wanted to leave",
// "He didn't sit", "Should I go?"). animate.mjs learned this in Book.
const NOT_DONE = /n['’]t\b|\b(not|never|no longer|wants? to|wanted to|wishe[sd]? to|hope[sd]? to|tr(?:y|ies|ied) to|would|could|should|might|going to|about to|refus(?:e|es|ed) to|thought about|imagined|dreamed|almost|nearly)\b/i;

// Places (stage 2 draws them; stage 1 carries them and says it has one room).
export const PLACES = {
  "living room": /\b(living room|lounge|sitting room|sofa|couch|flat|apartment|house|home)\b/i,
  kitchen: /\b(kitchen)\b/i, bedroom: /\b(bedroom|bed)\b/i, office: /\b(office|desk)\b/i, bar: /\b(bar|pub|club)\b/i,
  street: /\b(street|road|pavement|sidewalk|alley)\b/i, car: /\b(car|driver's seat|passenger seat)\b/i,
  park: /\b(park|garden|bench)\b/i, hospital: /\b(hospital|ward)\b/i, rooftop: /\b(roof|rooftop)\b/i,
};
// The light a scene is played in, from its own words; carried to the next scene until they change it.
const LIGHTS = [
  ["night", /\b(night|midnight|dark(?:ness)?|moonlight|(?:one|two|three|four|1|2|3|4)(?: o'clock)? in the morning|[1-4] ?a\.?m\b)/i],
  ["evening", /\b(evening|dusk|sunset|twilight)\b/i],
  ["dawn", /\b(dawn|sunrise|daybreak|first light)\b/i],
  ["day", /\b(morning|afternoon|noon|midday|daylight|sunlight|sunny|the next day)\b/i],
];
export function lightOf(text) { return (LIGHTS.find(([, re]) => re.test(text)) || [null])[0]; }
const TIME = /\b(that night|that evening|the next (?:morning|day|night|evening)|next morning|at dawn|later that|hours later|days later|weeks later|the following (?:morning|day)|meanwhile|a week later|years later)\b/i;

// ---------------------------------------------------------------- reading
const words = s => (s.match(/[A-Za-z0-9'’-]+/g) || []).length;
const clean = s => s.replace(/\s+/g, " ").trim();
const cap = w => /^[A-Z][a-zA-Z'’-]+$/.test(w);

/** Paragraphs → pieces: narration and quotes, in order. */
function pieces(par) {
  const out = [];
  const re = /[“"]([^”"]*)[”"]/g;
  let last = 0, m;
  while ((m = re.exec(par))) {
    if (m.index > last) out.push({ kind: "narration", text: par.slice(last, m.index) });
    out.push({ kind: "quote", text: m[1] });
    last = re.lastIndex;
  }
  if (last < par.length) out.push({ kind: "narration", text: par.slice(last) });
  return out;
}

/** Who is in this story: names, by where capitalised words stand. */
export function findCast(text) {
  const counts = new Map(), mid = new Set(), tagged = new Set(), starts = new Map(), verbAfter = new Set();
    const add = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  // A list of names is a list of people: "Maya and Ruth waited", "Tom, Maya and Ruth sat".
  for (const m of text.matchAll(/\b[A-Z][a-z'’-]+(?:,\s*[A-Z][a-z'’-]+)*,?\s+and\s+[A-Z][a-z'’-]+\b/g))
    for (const w of m[0].match(/[A-Z][a-z'’-]+/g)) if (!NOT_NAMES.has(w.toLowerCase())) verbAfter.add(w);
  // Speech tags name people even at a sentence's start.
  for (const m of text.matchAll(new RegExp(`[”"]\\s*,?\\s*(?:(${SPEECH_RE})\\s+((?:(?:Mr|Mrs|Ms|Dr)\\.?\\s+)?[A-Z][a-zA-Z'’-]+)|((?:(?:Mr|Mrs|Ms|Dr)\\.?\\s+)?[A-Z][a-zA-Z'’-]+)\\s+(?:${SPEECH_RE}))\\b`, "g")))
    tagged.add(clean(m[2] || m[3]).replace(/\.$/, ""));
  for (const par of text.split(/\n\s*\n/)) {
    for (const sentence of par.split(/(?<=[.!?…—]["”]?)\s+|[“"”]/)) {
      const toks = sentence.match(/[A-Za-z][A-Za-z'’.-]*/g) || [];
      toks.forEach((raw, i) => {
        let w = raw.replace(/[.’']+$/, "").replace(/’/g, "'");
        const possessive = w.endsWith("'s");
        if (possessive) w = w.slice(0, -2);
        if (!cap(w) || NOT_NAMES.has(w.toLowerCase()) || TITLE.test(w)) return;
        const prev = toks[i - 1] ? toks[i - 1].replace(/\.$/, "") : "";
        const name = TITLE.test(prev) ? `${prev} ${w}` : w;
        add(counts, name);
        if (i > 0 || possessive) mid.add(name);
        // At a sentence's start, a name is followed by what they do: "Tom poured",
        // "Anna waited", "Maya was". The Cast step shows every guess to confirm.
        else if (/^[a-z]+(ed|s)$|^(sat|stood|went|came|took|said|told|ran|fell|shot|drew|got|let|held|knew|felt|saw|had|put|left|kept|rose|drank|spoke|shook)$/.test((toks[i + 1] || "").replace(/[.’']+$/, ""))) verbAfter.add(name);
        else add(starts, name);
      });
    }
  }
  const places = new RegExp(Object.values(PLACES).map(r => r.source).join("|"), "i");
  return [...counts.keys()].filter(n => (mid.has(n) || tagged.has(n) || verbAfter.has(n) || counts.get(n) >= 2) && !places.test(n.toLowerCase()))
    .sort((a, b) => counts.get(b) - counts.get(a));
}

/**
 * The story, read: { cast: [{ name, pronoun, lines }], scenes: [{ place, beats }], notes }.
 * pronouns: { Maya: "she", Tom: "he" } — asked at the Cast step, never guessed.
 * Each beat: { kind: "line", speaker, text, manner, how } or { kind: "action", who, move, text }.
 * A line's `how` says how its speaker was found: "tag", "paragraph", "continued",
 * "guessed" (the novel's alternation, shown to the writer) or "unknown".
 */
export function readStory(text, { pronouns = {} } = {}) {
  text = String(text || "").replace(/\r/g, "");
  const names = findCast(text);
  const cast = names.map(name => ({ name, pronoun: pronouns[name] || null, lines: 0 }));
  const byName = new Map(cast.map(c => [c.name.toLowerCase(), c]));
  const notes = [];
  const noted = new Set();
  const note = (key, msg) => { if (!noted.has(key)) { noted.add(key); notes.push(msg); } };

  // A name or a pronoun → a person, or null (and a note) when it can't be said.
  const nameRe = names.length ? new RegExp(`\\b(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`) : null;
  let present = [];
  const resolve = (word, where) => {
    if (!word) return null;
    const w = word.replace(/’/g, "'");
    const direct = byName.get(w.toLowerCase());
    if (direct) return direct;
    const p = { her: "she", his: "he", him: "he", their: "they", them: "they" }[w.toLowerCase()] || w.toLowerCase();
    if (!/^(he|she|they)$/.test(p)) return null;
    const fits = (present.length ? present : cast).filter(c => c.pronoun === p);
    if (fits.length === 1) return fits[0];
    if (!cast.some(c => c.pronoun)) note("pronouns", "Say who is “she”, “he” or “they” at step 2, and the page can follow pronouns.");
    else note(`pr-${p}-${where}`, `“${word}” ${fits.length ? "could be " + fits.map(c => c.name).join(" or ") : "matches nobody's pronoun"} (${where}); that part isn't given to anyone.`);
    return null;
  };

  // Scenes: a blank line followed by a new place or a time jump.
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const scenes = [];
  let scene = null, place = null, light = "day";
  paragraphs.forEach((par, pi) => {
    const narration = pieces(par).filter(p => p.kind === "narration").map(p => p.text).join(" ");
    const newPlace = Object.entries(PLACES).find(([, re]) => re.test(narration))?.[0] || null;
    const jump = TIME.test(narration);
    const newLight = lightOf(narration);
    if (!scene || jump || (newPlace && newPlace !== place && scene.beats.length)) {
      if (scene) scene.present = present.map(c => c.name);
      const where = newPlace || place || "living room";
      scene = { place: where, set: PLACE_SET[where] || "living room", time: (narration.match(TIME) || [])[0] || null,
        light: newLight || light, beats: [], paragraphs: [] };
      if (PLACE_SET[where] !== where) note(`set-${where}`, `There's no ${where} set yet: it's played on the ${PLACE_SET[where]} set.`);
      scenes.push(scene);
      present = [];
    } else if (newLight && !scene.beats.length) scene.light = newLight;
    light = scene.light;
    if (newPlace) place = newPlace;
    scene.paragraphs.push(pi);

    // Narration first finds who acts in this paragraph (the "same paragraph" rule).
    const ps = pieces(par);
    let actor = null;
    const speakers = scene.beats.filter(b => b.kind === "line" && b.speaker).map(b => byName.get(b.speaker.toLowerCase()));
    let lastQuoteSpeaker = null;
    ps.forEach((piece, i) => {
      if (piece.kind === "narration") {
        // Actions, sentence by sentence; the doer is the sentence's first person.
        const sentences = piece.text.split(/(?<=[.!?…])\s+/);
        sentences.forEach((sentence, si) => {
          const s = sentence.trim();
          if (!s || /^[,;:—–-]?\s*$/.test(s)) return;
          // A speech tag is not an action, and only sits right next to a quote:
          // '"…," she said, and sat down' still sits; 'She answered the phone' is not a tag.
          let tagless = s;
          if (si === 0 && ps[i - 1]?.kind === "quote")
            tagless = tagless.replace(new RegExp(`^[,;:—–-]?\\s*(?:(?:${SPEECH_RE})\\s+\\S+|\\S+\\s+(?:${SPEECH_RE}))\\b[,.]?`, "i"), "");
          if (si === sentences.length - 1 && ps[i + 1]?.kind === "quote")
            tagless = tagless.replace(new RegExp(`\\S+\\s+(?:${SPEECH_RE})[^.!?]*[,:]\\s*$`, "i"), "");
          const who = firstPerson(tagless || s);
          if (who) actor = who;
          const doer = who || (tagless.trim() ? actor : null);
          if (nameRe) for (const m of (tagless || s).matchAll(new RegExp(nameRe.source, "g"))) {
            const c = byName.get(m[1].toLowerCase());
            if (c && !present.includes(c)) present.push(c);
          }
          for (const m of movesIn(tagless)) {
            if (!doer) { note(`who-${m.text}`, `No one to “${m.text}”: the sentence names nobody.`); continue; }
            // "Tom, Maya and Ruth sat down": everyone in a subject made only of names.
            const subject = m.clause.slice(0, m.at);
            const group = nameRe && /^[\s,]*(?:[A-Z][\w'’. -]*?(?:,\s*|\s+and\s+))+[A-Z][\w'’. -]*\s+$/.test(subject)
              ? [...subject.matchAll(new RegExp(nameRe.source, "g"))].map(x => byName.get(x[1].toLowerCase())).filter(Boolean) : [doer];
            for (const d of group) {
              if (!present.includes(d)) present.push(d);
              scene.beats.push({ kind: "action", who: d.name, move: m.move, text: clean(m.text) });
            }
          }
          if (who && !present.includes(who)) present.push(who);
          const unmapped = verbsIn(tagless).filter(v => !MOVES.some(([, re]) => re.test(v)));
          for (const v of unmapped) note(`verb-${v}`, `No move for “${v}”: shown as standing or talking.`);
        });
        return;
      }
      const quote = clean(piece.text).replace(/,$/, "");
      if (!quote) return;
      const after = ps[i + 1]?.kind === "narration" ? ps[i + 1].text : "";
      const before = ps[i - 1]?.kind === "narration" ? ps[i - 1].text : "";
      let speaker = null, how = "unknown", manner = "plain";
      const tagAfter = after.match(new RegExp(`^\\s*[,!?.]?\\s*(?:(${SPEECH_RE})\\s+((?:(?:Mr|Mrs|Ms|Dr)\\.?\\s+)?[A-Za-z'’-]+)|((?:(?:Mr|Mrs|Ms|Dr)\\.?\\s+)?[A-Za-z'’-]+)\\s+(${SPEECH_RE}))\\b`, "i"));
      const tagBefore = before.match(new RegExp(`((?:(?:Mr|Mrs|Ms|Dr)\\.?\\s+)?[A-Za-z'’-]+)\\s+(${SPEECH_RE})\\b[^.!?]*[,:]\\s*$`, "i"));
      if (tagAfter) {
        speaker = resolve(tagAfter[2] || tagAfter[3], `“${quote.slice(0, 24)}…”`);
        manner = SPEECH[(tagAfter[1] || tagAfter[4]).toLowerCase()] || "plain";
        how = speaker ? "tag" : "unknown";
      } else if (tagBefore) {
        speaker = resolve(tagBefore[1], `“${quote.slice(0, 24)}…”`);
        manner = SPEECH[tagBefore[2].toLowerCase()] || "plain";
        how = speaker ? "tag" : "unknown";
      }
      if (!speaker && !tagAfter && !tagBefore) {
        if (lastQuoteSpeaker) { speaker = lastQuoteSpeaker; how = "continued"; }
        else {
          // Someone acting in this paragraph speaks its quotes.
          const narr = ps.filter(p => p.kind === "narration").map(p => p.text).join(" ");
          const who = firstPerson(narr);
          if (who) { speaker = who; how = "paragraph"; }
          else {
            // The novel's convention: lines alternate between the two people talking.
            const two = [...new Set(speakers.slice().reverse().map(c => c.name))].slice(0, 2);
            const inRoom = present.length ? present : cast;
            if (inRoom.length === 2 || two.length === 2) {
              const lastName = speakers.length ? speakers[speakers.length - 1].name : null;
              const pool = two.length === 2 ? two : inRoom.map(c => c.name);
              const next = pool.find(n => n !== lastName) || null;
              if (next && (inRoom.length <= 2)) { speaker = byName.get(next.toLowerCase()); how = "guessed"; }
            }
          }
        }
      }
      if (quote.endsWith("?") && manner === "plain") manner = "ask";
      if (speaker) { speaker.lines++; lastQuoteSpeaker = speaker; if (!present.includes(speaker)) present.push(speaker); speakers.push(speaker); }
      else note(`q-${quote.slice(0, 30)}`, `Nobody is given “${quote.slice(0, 40)}${quote.length > 40 ? "…" : ""}” — add “said Name” after it.`);
      scene.beats.push({ kind: "line", speaker: speaker?.name || null, text: quote, manner, how });
    });
  });

  function firstPerson(s) {
    if (!s) return null;
    const m = nameRe && s.match(nameRe);
    const pm = s.match(/\b(she|he|they|her|his|their)\b/i);
    if (m && (!pm || m.index <= pm.index)) return byName.get(m[1].toLowerCase());
    if (pm) return resolve(pm[1], `“${clean(s).slice(0, 30)}…”`);
    return null;
  }

  if (scene) scene.present = present.map(c => c.name);
  const real = cast.filter(c => c.lines || scenes.some(s => s.beats.some(b => b.who === c.name)));
  return { cast: real.length ? real : cast, scenes, notes };
}

function movesIn(s) {
  const found = [];
  // Clauses: "stood up, crossed his arms and walked" is three; "Tom, Maya and Ruth sat" is one.
  for (const sentencePart of s.split(/,\s*(?=[a-z])|,?\s+(?:and then|then|and|but)\s+(?=[a-z])/)) {
    if (NOT_DONE.test(sentencePart)) continue;
    const hits = MOVES.map(([move, re]) => { const m = sentencePart.match(re); return m ? { move, at: m.index, text: m[0] } : null; })
      .filter(Boolean).sort((a, b) => a.at - b.at);
    // "sat down" is sit, not also stand/walk: one move per clause, the first.
    if (hits.length) found.push({ ...hits[0], clause: sentencePart });
    // …except holding something, which goes with any move: "sat down with a drink".
    const hold = hits.find(h => h.move === "hold");
    if (hold && hits[0] !== hold) found.push({ ...hold, clause: sentencePart });
  }
  return found;
}

// Past-tense-ish verbs after a subject, for the "no move for …" list.
function verbsIn(s) {
  return [...s.matchAll(/\b(?:she|he|they|[A-Z][a-z]+)\s+((?:[a-z]+ed|[a-z]+s)(?:\s+(?:up|down|out|in|back|away|over|around))?)\b/g)]
    .map(m => m[1]).filter(v => !/^(was|is|has|does|goes|says|seems|looks|feels|this|his|hers|its|yes|less|unless|was|waited|waits|paused|pauses|stayed|stays|listened|listens|watched|watches|stared|stares|looked|glanced|glances|lingered|remained|remains)$/i.test(v.split(" ")[0]) && !new RegExp(`^(${SPEECH_RE})$`, "i").test(v.split(" ")[0]));
}

// ---------------------------------------------------------------- blocking
// The sets (web/film/stage.mjs builds them). Each is its own space, in metres:
// where people stand (marks), where they sit (seats: where they are, and what
// they face), the door they come in by, a spot to walk to, the off-stage point
// beyond the door, and the wide shot that opens every scene there.
export const SETS = {
  "living room": { inside: true, door: [2.1, 1.6], off: [3.3, 2.2], window: [-1.6, 0.6],
    marks: [[0.6, 0.1], [-0.9, -0.7], [1.4, -0.9], [-1.6, 0.6]],
    seats: [{ at: [-0.9, -1.2], face: [-0.9, 0] }, { at: [-0.4, -1.2], face: [-0.4, 0] }],
    wide: { at: [2.4, 1.75, 3.4], look: [-0.4, 0.95, -0.6] } },
  kitchen: { inside: true, door: [2.1, 1.6], off: [3.3, 2.2], window: [-0.4, -1.9],
    marks: [[1.1, 0.9], [-0.7, -0.6], [1.5, -0.9], [-1.8, 1.4]],
    seats: [{ at: [-1.5, 0.45], face: [-0.4, 0.45] }, { at: [0.3, 0.45], face: [-0.8, 0.45] }],
    wide: { at: [2.5, 1.8, 3.4], look: [-0.5, 0.9, -0.8] } },
  bedroom: { inside: true, door: [2.1, 1.6], off: [3.3, 2.2], window: [0.8, -1.6],
    marks: [[0.7, 0.4], [-0.3, 0.4], [1.6, -0.6], [-2, 1]],
    seats: [{ at: [-1.6, -0.45], face: [-1.6, 1] }, { at: [-0.8, -0.45], face: [-0.8, 1] }],
    wide: { at: [2.4, 1.8, 3.3], look: [-0.6, 0.8, -0.8] } },
  office: { inside: true, door: [2.1, 1.6], off: [3.3, 2.2], window: [1.3, -1.8],
    marks: [[0.7, 0.5], [-0.9, -0.55], [1.5, -0.8], [-1.9, 1]],
    seats: [{ at: [-0.8, -1.75], face: [-0.8, 0] }, { at: [-0.8, 0.35], face: [-0.8, -2] }],
    wide: { at: [2.6, 1.9, 3.3], look: [-0.5, 0.9, -0.9] } },
  bar: { inside: true, door: [2.1, 1.6], off: [3.3, 2.2], window: [1.6, 0.9],
    marks: [[0.6, 0.2], [-0.7, -0.4], [1.5, -0.6], [-1.8, 0.9]],
    // Bar stools are higher than a chair: whoever sits on one is lifted onto it.
    seats: [{ at: [-1.1, -1.25], face: [-1.1, 0], lift: 0.4 }, { at: [-0.3, -1.25], face: [-0.3, 0], lift: 0.4 }],
    wide: { at: [2.5, 1.8, 3.4], look: [-0.5, 0.9, -0.8] } },
  street: { inside: false, door: [5, 0.6], off: [9, 0.6], window: [-3, -0.6],
    marks: [[0.7, 0.4], [-0.8, 0.1], [1.8, -0.3], [-2, 0.8]],
    seats: [{ at: [-2.6, -0.9], face: [-2.6, 1] }, { at: [-1.9, -0.9], face: [-1.9, 1] }],
    wide: { at: [4.6, 2.3, 7.4], look: [-0.6, 1.3, -1] } },
  park: { inside: false, door: [5, 0.8], off: [9, 0.8], window: [-3, 1.2],
    marks: [[0.7, 0.5], [-0.7, 0.1], [1.8, -0.4], [-2, 1]],
    seats: [{ at: [-1.1, -0.9], face: [-1.1, 1] }, { at: [-0.4, -0.9], face: [-0.4, 1] }],
    wide: { at: [3.2, 1.9, 5.2], look: [-0.6, 1.1, -0.6] } },
};
/** The one room of stage 1, kept for anything that still means "the living room". */
export const ROOM = SETS["living room"];
// Places the page reads, and the set each is played on. A place with no set
// of its own says so (a note), rather than pretending.
export const PLACE_SET = { "living room": "living room", kitchen: "kitchen", bedroom: "bedroom", office: "office", bar: "bar",
  street: "street", car: "street", park: "park", hospital: "bedroom", rooftop: "street" };
const SPEED = 1.25; // walking, m/s

const lineSeconds = text => Math.max(1.3, words(text) / WPM * 60 + 0.35);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// What each move puts in a hand. A glass stays in hand once drunk from, a gun
// once drawn; a phone only while it's in use. A new scene empties every hand.
const PROP_OF = { drink: "glass", hold: "glass", gun: "gun", shoot: "gun", phone: "phone" };
const KEEPS = new Set(["glass", "gun"]);

/**
 * Timelines from a read story, scene by scene on each scene's set. Returns
 * { people: { name: { timeline } }, lines: [[start, end, name, text, how, key]],
 * actions: [[start, end, name, move]], scenes: [start…], sets: [{ start, set,
 * light, place }], length, over }. A segment's options carry `prop` for what's
 * in the right hand, and `off` for someone not on stage.
 */
export function block(story, { gap = 0.25 } = {}) {
  const people = {};
  const cast = story.cast.slice(0, 4);
  const lines = [], actions = [], sceneStarts = [], sets = [];
  let t = 0, set = SETS["living room"];
  const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
  const seg = (name, start, clip, o) => {
    const tl = people[name].timeline;
    // A segment starting when the last one did replaces it.
    if (tl.length && Math.abs(tl[tl.length - 1][0] - start) < 2e-3) tl.pop();
    // Same loop, same place, same hand: carry on rather than restart it.
    const last = tl[tl.length - 1];
    if (last && last[1] === clip && !o.from && !last[2].from && same(last[2].at, o.at) && last[2].face === o.face && !o.once && last[2].prop === o.prop && !!last[2].off === !!o.off) return;
    tl.push([+start.toFixed(3), clip, o]);
  };
  const state = {};
  cast.forEach((c, i) => { people[c.name] = { timeline: [] }; state[c.name] = { i, here: false, seated: false, at: null, prop: null }; });
  const markOf = name => set.marks[state[name].i % set.marks.length];
  const others = name => cast.map(c => c.name).filter(n => n !== name && state[n].here);
  const face = name => { const o = others(name); return o.length ? "other" : null; };
  const settle = (name, start) => {
    const st = state[name];
    if (!st.here) seg(name, start, "Idle_Loop", { at: set.off, off: true });
    else if (st.dead) return;
    else seg(name, start, st.seated ? CLIPS.idle[1] : CLIPS.idle[0], { at: st.at, sit: st.seated, face: st.seated ? st.seatFace : face(name), prop: st.prop, lift: st.seated ? st.lift : 0 });
  };

  for (const scene of story.scenes) {
    set = SETS[scene.set] || SETS[PLACE_SET[scene.place]] || SETS["living room"];
    sceneStarts.push(t);
    sets.push({ start: t, set: Object.keys(SETS).find(k => SETS[k] === set), light: scene.light || "day", place: scene.place });
    // Who is in this scene: whoever it names or gives a line or a move. Those
    // whose first beat is coming in start outside; everyone else on a mark.
    const inScene = new Set(scene.present || []);
    for (const b of scene.beats) { if (b.who) inScene.add(b.who); if (b.speaker) inScene.add(b.speaker); }
    const firstBeat = name => scene.beats.find(b => b.who === name || b.speaker === name);
    for (const c of cast) {
      const st = state[c.name];
      Object.assign(st, { seated: false, prop: null, dead: false, lift: 0 });
      st.here = inScene.has(c.name) && !(firstBeat(c.name)?.move === "enter");
      st.at = st.here ? markOf(c.name) : set.off;
    }
    for (const c of cast) settle(c.name, t);
    t += 2.0; // the wide shot that opens every scene
    for (const beat of scene.beats) {
      if (beat.kind === "line") {
        // A recorded line lasts as long as the recording; otherwise it's read at WPM.
        const d = beat.seconds > 0 ? Math.min(30, beat.seconds) + 0.15 : lineSeconds(beat.text);
        if (beat.speaker && people[beat.speaker] && !state[beat.speaker].dead) {
          const st = state[beat.speaker];
          if (!st.here) walkIn(beat.speaker);
          seg(beat.speaker, t, st.seated ? CLIPS.talk[1] : CLIPS.talk[0], { at: st.at, sit: st.seated, face: st.seated ? st.seatFace : face(beat.speaker), prop: st.prop, lift: st.seated ? st.lift : 0 });
          lines.push([+t.toFixed(3), +(t + d).toFixed(3), beat.speaker, beat.text, beat.how, beat.key]);
          t += d + gap;
          settle(beat.speaker, t);
        } else {
          lines.push([+t.toFixed(3), +(t + d).toFixed(3), null, beat.text, beat.how, beat.key]);
          t += d + gap;
        }
        continue;
      }
      const name = beat.who;
      if (!people[name] || state[name].dead) continue;
      const st = state[name];
      const start = t;
      if (beat.move === "enter") { if (!st.here) walkIn(name); actions.push([+start.toFixed(3), +t.toFixed(3), name, "enter"]); continue; }
      if (!st.here) walkIn(name);
      const standUp = () => { seg(name, t, "Sitting_Exit", { at: st.at, sit: true, face: st.seatFace, once: true, prop: st.prop, lift: st.lift }); t += HOLD.stand; st.seated = false; st.lift = 0; };
      if (beat.move === "hold") { st.prop = "glass"; settle(name, t); continue; }
      if (beat.move === "exit") {
        if (st.seated) standUp();
        const d = (dist(st.at, set.door) + dist(set.door, set.off)) / SPEED;
        seg(name, t, "Walk_Loop", { from: st.at, to: set.off, prop: st.prop });
        t += d; st.at = set.off; st.here = false; st.prop = null;
        seg(name, t, "Idle_Loop", { at: set.off, off: true });
        actions.push([+start.toFixed(3), +t.toFixed(3), name, "exit"]);
        for (const n of others(name)) settle(n, t);
        continue;
      }
      if (beat.move === "sit") {
        if (st.seated) continue;
        const seat = set.seats.find(s => !cast.some(c => c.name !== name && state[c.name].seated && same(state[c.name].at, s.at))) || set.seats[0];
        if (dist(st.at, seat.at) > 0.3) { const d = dist(st.at, seat.at) / SPEED; seg(name, t, "Walk_Loop", { from: st.at, to: seat.at, prop: st.prop }); t += d; }
        seg(name, t, "Sitting_Enter", { at: seat.at, sit: true, face: seat.face, once: true, prop: st.prop, lift: seat.lift || 0 });
        t += HOLD.sit; st.at = seat.at; st.seated = true; st.seatFace = seat.face; st.lift = seat.lift || 0;
        settle(name, t);
        actions.push([+start.toFixed(3), +t.toFixed(3), name, "sit"]);
        continue;
      }
      if (beat.move === "stand") {
        if (!st.seated) continue;
        standUp();
        st.at = markOf(name);
        settle(name, t);
        actions.push([+start.toFixed(3), +t.toFixed(3), name, "stand"]);
        continue;
      }
      if (beat.move === "walk") {
        const to = dist(st.at, markOf(name)) > 0.5 ? markOf(name) : set.window;
        if (st.seated) standUp();
        const d = dist(st.at, to) / SPEED;
        seg(name, t, "Walk_Loop", { from: st.at, to, prop: st.prop });
        t += d; st.at = to;
        settle(name, t);
        actions.push([+start.toFixed(3), +t.toFixed(3), name, "walk"]);
        continue;
      }
      // Everything else plays where they are; seated people stand first, except to drink, talk or gesture.
      const clip = CLIPS[beat.move]?.[0];
      if (!clip) continue;
      if (st.seated && !["drink", "phone", "nod", "no", "arms"].includes(beat.move)) { standUp(); st.at = markOf(name); }
      const prop = PROP_OF[beat.move] || st.prop;
      if (KEEPS.has(PROP_OF[beat.move])) st.prop = PROP_OF[beat.move];
      const seatedClip = st.seated && beat.move === "phone" ? "Sitting_Talking_Loop" : st.seated ? CLIPS.idle[1] : clip;
      seg(name, t, st.seated ? seatedClip : clip, { at: st.at, sit: st.seated, face: st.seated ? st.seatFace : face(name), once: !/_Loop$/.test(clip), prop, lift: st.seated ? st.lift : 0 });
      t += HOLD[beat.move] || 2;
      actions.push([+start.toFixed(3), +t.toFixed(3), name, beat.move]);
      if (beat.move === "die") { st.dead = true; continue; }
      if (beat.move === "fall") { seg(name, t, "LayToIdle", { at: st.at, face: face(name), once: true, prop: st.prop }); t += HOLD.getup; }
      settle(name, t);
    }
    t += 0.8;
  }

  function walkIn(name) {
    const st = state[name];
    const to = markOf(name);
    st.here = true;
    const d = (dist(set.off, set.door) + dist(set.door, to)) / SPEED;
    seg(name, t, "Walk_Loop", { from: set.off, to, prop: st.prop });
    t += d; st.at = to;
    settle(name, t);
    for (const n of others(name)) settle(n, t);
  }

  return { people, lines, actions, scenes: sceneStarts, sets, length: +t.toFixed(2), over: t > LIMIT_SECONDS };
}

/** The set, light and place at t. */
export function setAt(film, t) {
  const s = film.sets || [];
  let i = 0;
  while (i + 1 < s.length && s[i + 1].start <= t) i++;
  return s[i] || { start: 0, set: "living room", light: "day", place: "living room" };
}

/** The segment a timeline is in at t: index. */
export function segIndex(timeline, t) {
  let i = 0;
  while (i + 1 < timeline.length && timeline[i + 1][0] <= t) i++;
  return i;
}

/**
 * Where everyone is at t, and which way they face (radians about y, 0 = +z).
 * Pure, so the renderer and the tests see the same room.
 */
export function placesAt(film, t) {
  const out = {};
  for (const [name, p] of Object.entries(film.people)) {
    const tl = p.timeline, i = segIndex(tl, t), seg = tl[i], o = seg[2];
    const end = (tl[i + 1] || [Infinity])[0];
    let at = o.at;
    if (o.from) {
      const d = dist(o.from, o.to), k = Math.min(1, (t - seg[0]) / Math.max(0.01, Math.min(end, seg[0] + d / SPEED) - seg[0]));
      at = [o.from[0] + (o.to[0] - o.from[0]) * k, o.from[1] + (o.to[1] - o.from[1]) * k];
    }
    out[name] = { at, seg, off: !!o.off, lift: o.lift || 0 };
  }
  for (const [name, p] of Object.entries(out)) {
    const o = p.seg[2];
    const others = Object.entries(out).filter(([n, q]) => n !== name && !q.off).map(([, q]) => q.at);
    const look = o.to ? o.to : o.face === "other" && others.length ? others[0] : Array.isArray(o.face) ? o.face : [p.at[0], p.at[1] + 1];
    p.facing = Math.hypot(look[0] - p.at[0], look[1] - p.at[1]) > 0.02 ? Math.atan2(look[0] - p.at[0], look[1] - p.at[1]) : 0;
  }
  return out;
}

// ---------------------------------------------------------------- voices
/** A character's voice: the same setting pitches the device voice (preview) and their recordings (video). */
export const PITCH = {
  natural: { tts: 1, rate: 1 },
  deeper: { tts: 0.75, rate: 0.88 },
  higher: { tts: 1.3, rate: 1.12 },
};

/**
 * Where the speech is in a recording: [start, end] sample indices with the
 * silence at either end cut, a little padding kept so no word is clipped.
 * The level is relative to the loudest moment, so a quiet phone mic works.
 */
export function trimBounds(samples, rate, { floor = 0.06, pad = 0.08, window = 0.02 } = {}) {
  const n = samples.length, w = Math.max(1, Math.round(window * rate));
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-4) return null;                       // silence: nothing was said
  const loud = i => { let m = 0; for (let j = i; j < Math.min(n, i + w); j++) m = Math.max(m, Math.abs(samples[j])); return m >= peak * floor; };
  let a = 0, b = n;
  while (a < n && !loud(a)) a += w;
  while (b > a && !loud(Math.max(0, b - w))) b -= w;
  const p = Math.round(pad * rate);
  return [Math.max(0, a - p), Math.min(n, b + p)];
}

/** m:ss */
export const clock = s => { const r = Math.max(0, Math.round(s)); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`; };

// ---------------------------------------------------------------- the camera
/**
 * The shot at t. Wide for the first two seconds of every scene and on any
 * walk; a speaker's close shot while they speak (and a beat after); on any
 * other action, the one doing it; otherwise both people.
 */
export function shotAt(film, t) {
  if (film.scenes.some(s => t >= s && t < s + 2)) return "wide";
  const line = film.lines.find(([a, b]) => t >= a - 0.1 && t < b + 0.25);
  if (line && line[2]) return line[2];
  const act = film.actions.find(([a, b]) => t >= a && t < b);
  if (act) return /^(enter|exit|walk|sit|stand)$/.test(act[3]) ? "wide" : act[2];
  return "two";
}

/**
 * Where the camera stands for a shot. heads: { name: [x, y, z] }, facing:
 * { name: radians }. The 180° rule: for every shot in a scene the camera stays
 * on one side of the line between the scene's two principal people — the
 * audience's side (+z) — so a cut never flips who is on the left.
 */
export function cameraFor(shot, heads, facing, pair, wide = SETS["living room"].wide) {
  const names = pair.filter(n => heads[n]);
  if (shot === "wide" || names.length < 1) return { fov: 58, at: wide.at, look: wide.look };
  const [a, b] = names.length >= 2 ? names : [names[0], names[0]];
  const A = heads[a], B = heads[b];
  let side = [-(B[2] - A[2]), 0, B[0] - A[0]];
  const len = Math.hypot(side[0], side[2]) || 1;
  side = [side[0] / len, 0, side[2] / len];
  if (side[2] < 0 || (side[2] === 0 && side[0] < 0)) side = [-side[0], 0, -side[2]];
  if (a === b) side = [0, 0, 1];
  if (shot === "two" || !heads[shot]) {
    const mid = [(A[0] + B[0]) / 2, 1.1, (A[2] + B[2]) / 2];
    const back = Math.max(2.2, Math.hypot(B[0] - A[0], B[2] - A[2]) * 1.6);
    return { fov: 50, at: [mid[0] + side[0] * back, 1.45, mid[2] + side[2] * back], look: mid, side };
  }
  const h = heads[shot], ry = facing[shot] || 0;
  let fwd = [Math.sin(ry), 0, Math.cos(ry)];
  // A speaker facing away from the audience's side is shot from that side anyway.
  if (fwd[0] * side[0] + fwd[2] * side[2] < -0.2) fwd = side;
  // A medium close-up: head and chest, far enough back that talking hands stay below the face.
  return { fov: 36, at: [h[0] + fwd[0] * 1.9 + side[0] * 0.4, h[1] - 0.02, h[2] + fwd[2] * 1.9 + side[2] * 0.4], look: [h[0], h[1] - 0.22, h[2]], side };
}

/** Which side of the line A→B a point is on: >0 left, <0 right. */
export const sideOf = (A, B, P) => Math.sign((B[0] - A[0]) * (P[2] - A[2]) - (B[2] - A[2]) * (P[0] - A[0]));

export const SAMPLE = `Maya let herself in. The flat was dark except for the lamp by the window.

"You said you'd be gone by now," she said.

Tom sat on the sofa. He didn't look up. "I said a lot of things. Sit down, Maya."

"I'll stand."

He stood up. "The money's gone. All of it. I'm sorry."

Maya shook her head. "No. Don't you dare say sorry to me."

Her phone rang. She answered the phone and walked to the window. "It's me. He knows. Tell them to wait."

"Who was that?" Tom whispered. "Maya — who was that?"`;
