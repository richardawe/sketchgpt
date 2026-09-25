// A picture-book story written by rules, in the tab, with no model.
//
// The owner, after Book mode ran on real devices: "its story generation is
// faulty and never good". Even handed a shape — one line per page saying what
// the page is for — Qwen3-0.6B made sense in 7 of 8 stories (docs/storybook.md)
// and still copied the shape into the text. The page already owned the shape,
// the pictures and the continuity; this file takes the words too.
//
// A story here is the same six jobs (SHAPE in book.mjs) filled from word lists
// that were chosen so that three things hold by construction, and a test
// checks each one for every combination (tests/story.test.mjs):
//
//   - the page draws exactly what the words mark: every drawable noun is
//     written [in brackets] in a template, and planFromWords() finds those
//     and nothing else — no "lighthouse" drawn as a light bulb, no sea on the
//     page where the hero has not got there yet
//   - the help makes sense: a helper is picked because it can do what the
//     problem needs (a ball up a tree needs something that flies or climbs; a
//     river needs something that swims), and never the thing the hero can do
//   - the animation tells the same story: the hero's "tries" and "works" pages
//     use verbs animate.mjs acts out, and the "wants" page only wishes
//
// The helper is in the cast under its kind as a name ("Owl"), the way picture
// books do it. That is what lets the page draw it as the same picture on every
// page it is on, and lets animate.mjs give "Owl flies down" to the owl rather
// than to the hero.
//
// Same choices and seed, same book, on every device. "Another version" is a
// new seed.

import { PAGES, planFromWords, drawAs } from "./book.mjs?v=9";

// ---- What the person chooses ------------------------------------------------

// Kinds with an illustration of their own, and what each can do. A hero's own
// abilities decide which problems are problems for it: a duck is not stuck at
// a river.
export const KINDS = {
  dog:      { can: ["run", "dig", "swim"], names: ["Pip", "Max", "Biscuit", "Rosie"] },
  cat:      { can: ["climb"], names: ["Luna", "Tom", "Mittens", "Ginger"] },
  rabbit:   { can: ["dig", "run"], names: ["Thumper", "Clover", "Bun", "Daisy"] },
  bear:     { can: ["climb", "strong"], names: ["Bruno", "Honey", "Barney", "Moss"] },
  fox:      { can: ["dig", "run"], names: ["Rusty", "Fern", "Scout", "Amber"] },
  mouse:    { can: ["small"], names: ["Pip", "Squeak", "Tilly", "Nibbles"] },
  hedgehog: { can: ["small", "dig"], names: ["Spike", "Prickles", "Hazel", "Bramble"] },
  penguin:  { can: ["swim"], names: ["Pingu", "Waddles", "Ice", "Poppy"] },
  dragon:   { can: ["fly", "strong"], names: ["Spark", "Ember", "Blaze", "Puff"] },
  unicorn:  { can: ["run"], names: ["Star", "Sparkle", "Misty", "Moonbeam"] },
  dinosaur: { can: ["strong", "tall"], names: ["Rex", "Dino", "Stomp", "Pebbles"] },
  elephant: { can: ["strong", "tall"], names: ["Ellie", "Jumbo", "Peanut", "Tusk"] },
  robot:    { can: ["strong"], names: ["Bolt", "Beep", "Cog", "Zip"] },
  girl:     { can: ["climb", "run"], names: ["Lila", "Maya", "Zara", "Ada"] },
  boy:      { can: ["climb", "run"], names: ["Leo", "Sam", "Kofi", "Arlo"] },
  child:    { can: ["climb", "run"], names: ["Alex", "Robin", "Sky", "Jo"] },
  // The reader's own drawing (selfie.html). No kind word is written for them:
  // "Kate is a child" would draw a second, stand-in child beside the drawing.
  me:       { can: ["climb", "run"], names: ["Alex", "Robin", "Sky", "Jo"] },
};

// Who can help, and with what. Every kind here has an illustration.
export const HELPERS = {
  owl: ["fly", "see"], bird: ["fly"], bee: ["fly"], butterfly: ["fly"], duck: ["fly", "swim"],
  frog: ["swim", "small"], snail: ["small"], squirrel: ["climb"], hedgehog: ["small", "dig"],
  rabbit: ["dig"], fox: ["dig"], deer: ["run"], bear: ["strong", "climb"], crab: ["dig", "small"],
  turtle: ["swim"], dolphin: ["swim"], horse: ["run", "strong", "tall"], cow: ["strong"],
  pig: ["dig"], mouse: ["small"], cat: ["climb"], dog: ["run", "dig", "swim"], penguin: ["swim"],
  reindeer: ["run", "strong"], dragon: ["fly", "strong"], unicorn: ["run"], giraffe: ["tall"],
  monkey: ["climb"], elephant: ["tall", "strong"],
};

// Places: where the hero lives, what is there, and who might help there.
// `home` is page one; `back` is the last page's way home.
export const PLACES = {
  garden: { label: "a garden", in: "in a little [house] with a big [garden]",
    home: ["Every morning, {name} says hello to the [bees] and the [butterflies] among the [flowers].",
           "{name} likes the [apple] [tree] best of all, and the [flowers] all around it."],
    helpers: ["bird", "bee", "butterfly", "frog", "snail", "squirrel", "hedgehog"], dark: "out into the [garden]" },
  forest: { label: "a forest", in: "in a cosy [house] in the [forest]",
    home: ["All day long, {name} listens to the [birds] singing in the tall [trees].",
           "{name} knows every [mushroom] and every [bush] between the tall [trees]."],
    helpers: ["owl", "squirrel", "deer", "bear", "fox", "rabbit", "bird"], dark: "out into the [forest]" },
  beach: { label: "the seaside", in: "in a little [house] by the [sea]",
    home: ["Every day, {name} counts the [boats] out on the [waves].",
           "{name} likes to look for [shells] on the [sand]."],
    helpers: ["crab", "turtle", "dolphin", "bird"], dark: "out onto the [beach]" },
  farm: { label: "a farm", in: "on a busy [farm]",
    home: ["Every morning, {name} says hello to the [cow], the [pig] and the [sheep] by the red [barn].",
           "{name} likes to sit in the long [grass] and watch the [horses] by the [barn]."],
    helpers: ["horse", "cow", "duck", "pig", "mouse", "cat", "bird"], dark: "out across the [farm]" },
  town: { label: "a town", in: "in a tall [house] in a busy [town]",
    home: ["From the [window], {name} watches the [buses] and the [cars] go by.",
           "{name} knows every [shop] on the [street], and the [cat] who sleeps outside the bakery."],
    helpers: ["bird", "cat", "dog", "mouse"], dark: "out into the [town]" },
  snow: { label: "the snowy hills", in: "in a warm [house] in the snowy [hills]",
    home: ["Outside, the [pine] [trees] are white, and a [snowman] stands by the [door].",
           "{name} likes to slide down the [hills] and build a [snowman] by the [pine] [trees]."],
    helpers: ["penguin", "reindeer", "owl", "fox", "bear"], dark: "out into the snowy [hills]" },
  castle: { label: "a castle", in: "in a tall [castle] on a [hill]",
    home: ["From the top of the [castle], {name} can see the [trees] and a [flag] flying.",
           "{name} likes to count the [horses] in the yard below the [castle] walls."],
    helpers: ["owl", "horse", "unicorn", "dragon", "mouse", "bird"], dark: "out into the [castle] yard" },
};

// ---- What happens -----------------------------------------------------------

// How each kind of help is given: page four is `arrive` and `offer`; page
// five is `does`, then the problem's own ending, then `then`. The helper's
// verbs are in sentences that name the helper first and the hero's in
// sentences that name the hero first, because animate.mjs gives a sentence's
// verbs to the first character it names.
const JOY = "{name} jumps for joy.";
const HELP = {
  fly:    { arrive: "{Helper} flies down beside {name}", offer: "\"I can fly up for you,\" says {Helper}.",
            does: "{Helper} flies up to the top", then: JOY },
  climb:  { arrive: "{Helper} runs over to {name}", offer: "\"I can climb up for you,\" says {Helper}.",
            does: "{Helper} climbs up, quick as anything", then: JOY },
  tall:   { arrive: "{Helper} walks over to {name}", offer: "\"I am tall enough to reach,\" says {Helper}.",
            does: "{Helper} reaches up high", then: JOY },
  swim:   { arrive: "{Helper} swims up to {name}", offer: "\"Climb on my back,\" says {Helper}. \"I can swim across.\"",
            does: "{name} climbs on, and {Helper} swims all the way across", then: "" },
  dig:    { arrive: "{Helper} runs over to {name}", offer: "\"I can dig it out for you,\" says {Helper}.",
            does: "{Helper} digs and digs", then: JOY },
  small:  { arrive: "{Helper} peeks out at {name}", offer: "\"I am small enough to fit,\" says {Helper}.",
            does: "{Helper} squeezes in", then: JOY },
  strong: { arrive: "{Helper} walks over to {name}", offer: "\"I am strong enough to move it,\" says {Helper}.",
            does: "{Helper} pushes and pushes", then: JOY },
  run:    { arrive: "{Helper} runs up to {name}", offer: "\"Climb on my back,\" says {Helper}. \"I am fast, and I know the way.\"",
            does: "{name} climbs on, and {Helper} runs and runs", then: "" },
};

// The six jobs, per wish. Each wish lists its problems; each problem says what
// help it needs (any one of `need`) and how page three goes wrong.
//
// Page two only wishes: "wants", "has never", "dreams" — animate.mjs does not
// act a wish out. Pages three and five use verbs it does act out (runs,
// jumps, looks, flies, swims, dances).
// No teddy: a teddy is drawn as a bear, and a bear hero lost its teddy into
// its own picture.
const LOST = ["ball", "kite", "hat", "drum", "book"];
// Plurals the "s" rule gets wrong.
const PLURAL = { mouse: "mice", fox: "foxes", deer: "deer", reindeer: "reindeer", butterfly: "butterflies" };
export const WISHES = {
  sea: { label: "see the sea", not: ["beach"],
    title: ["{name} and the Big Blue Sea", "{name} Goes to the Sea"],
    want: ["{name} has never seen the [sea]. More than anything, {name} wants to see the [boats] and the [waves].",
           "{name} dreams of the [sea], with its [boats] and its [waves]. One day, {name} will go there."],
    problems: [
      // Anyone gets tired on a long way, except a hero that can fly.
      { need: ["run", "fly"], stops: ["fly"],
        fail: "{name} runs down the path, but it is a long, long way. Soon {name} is tired, and sits on a [stone] to rest.",
        help: { fly: { arrive: "{Helper} flies down beside {name}", offer: "\"Follow me,\" says {Helper}. \"I know the way.\"",
                       does: "{name} runs after {Helper}, on and on", then: "" } },
        works: "Over the [hill] they go, and there it is: the [sea], with [boats] on the [waves]!" },
      { need: ["swim"], stops: ["swim", "fly"], fail: "{name} runs down the [road] until a wide [river] is in the way. {name} looks up and down, but there is no way across.",
        works: "On the other side, {name} runs over the [hill], and there it is: the [sea], with [boats] on the [waves]!" },
    ],
    end: ["{name} splashes in the [waves] and finds a pink [shell]. {name} gives the [shell] to {Helper}, to say thank you.",
          "{name} dances on the [sand] as the [sun] goes down. What a day! Tomorrow, {name} will tell everyone all about it."] },
  lost: { label: "find something lost",
    title: ["{name} and the Lost {Item}", "Where Is the {Item}?"],
    want: ["{name} has a {colour} [{item}], and loves it more than anything. But one windy day, the [{item}] is gone!",
           "{name} cannot find the {colour} [{item}] anywhere. Without it, nothing feels right."],
    problems: [
      { need: ["fly", "climb", "tall"], stops: ["fly", "climb", "tall"], fail: "At last {name} looks up. The [{item}] is stuck at the top of a tall [tree]! {name} jumps and jumps, but it is too high.",
        works: "Down comes the [{item}], safe and sound!" },
      { need: ["swim"], fail: "At last {name} sees it. The [{item}] is floating far out on the [{water}]. {name} cannot swim that far.",
        works: "Back they come with the [{item}], safe and sound!",
        help: { swim: { arrive: "{Helper} swims up to {name}", offer: "\"I can swim out and get it,\" says {Helper}.",
                        does: "{Helper} swims out across the [{water}]", then: JOY } } },
      { need: ["dig", "small"], fail: "At last {name} finds it. The [{item}] has rolled down a little hole under a [rock]. {name} looks in, but it is too deep and too small.",
        works: "Out comes the [{item}], safe and sound!" },
    ],
    end: ["{name} hugs the [{item}] tight. Then {name} and {Helper} play with it until the [sun] goes down.",
          "From that day on, {name} keeps the [{item}] safe, and {Helper} comes to play every day."] },
  friend: { label: "make a friend",
    title: ["{name} Makes a Friend", "A Friend for {name}"],
    want: ["{name} has a box full of [toys], but nobody to play with. {name} wishes for a friend more than anything.",
           "{name} is new here, and does not know anyone yet. {name} wants a friend to play [ball] with."],
    problems: [
      { need: [], fail: "{name} runs up to the [{others}] and shouts, \"Can I play?\" But it is too loud, and everyone hides.",
        works: "{name} walks over quietly, with [apples] for everyone. \"Would you like one?\"",
        helpAny: "\"Try being gentle, and bring something to share,\" says {Helper}." },
      { need: [], fail: "{name} says hello to the [{others}], but nobody hears. So {name} runs off and sits all alone under a [tree].",
        works: "{name} runs back with a [ball] and a big [cake], and says, \"Who wants to play?\"",
        helpAny: "\"They are busy,\" says {Helper}. \"Bring something fun, and ask them to join in.\"" },
    ],
    helpAny: true,
    end: ["Soon {name} and the [{others}] are laughing and playing together. {name} has not one friend, but lots of them!",
          "They have a [picnic] in the [grass], and {name} and {Helper} are the best of friends."] },
  dark: { label: "be brave in the dark", night: true,
    title: ["{name} and the Dark Night", "{name} Is Brave"],
    want: ["{name} is scared of the dark, and wishes the [sun] would stay up for ever.",
           "{name} has never been out after dark. {name} wants to be brave, but at bedtime {name} hides in [bed]."],
    problems: [
      { need: ["see", "fly"], stops: ["see"], fail: "One [night], {name} tiptoes {dark}. Something goes whoosh! {name} runs back to [bed] and hides.",
        works: "So {name} goes out again, holding the little [lantern]. Now {name} looks up and sees the [moon]." },
    ],
    helpAny: "\"Here, take this [lantern],\" says {Helper}. \"And look up. The [night] is full of lights.\"",
    end: ["It is only {Helper}, and the sky is full of [stars]. {name} is not scared any more. Then off to [bed], sleepy and brave.",
          "{name} and {Helper} count the [stars] together. Now {name} loves the [night], and falls asleep smiling."] },
  fly: { label: "fly", not: [],
    title: ["{name} Wants to Fly", "{name} in the Sky"],
    want: ["{name} loves the [clouds], and wishes and wishes to fly up and touch them.",
           "{name} dreams of flying high above the [clouds]. If only {name} had wings!"],
    problems: [
      { need: [], fail: "{name} climbs up a [rock], flaps and jumps, and lands in a pile of [leaves]. Oof!",
        works: "{name} holds the [{flyer}] tight, and up flies {name}, high above the [clouds]!" },
      { need: [], fail: "{name} runs as fast as anything and jumps into the air, but comes straight back down on the [grass]. Bump!",
        works: "{name} runs into the wind, and up flies {name} with the red [{flyer}], high over everything!" },
    ],
    helpAny: "\"You don't need wings,\" says {Helper}, and gives {name} a big red [{flyer}].",
    end: ["Slowly, softly, {name} floats back down, just in time for [tea]. \"Again tomorrow?\" asks {Helper}.",
          "From up high, everything looks tiny. When {name} comes down, {Helper} is waiting with a big hug."] },
  grow: { label: "grow a flower", not: ["beach", "snow"],
    title: ["{name} and the Sunflower", "{name}'s Little Seed"],
    want: ["{name} has a tiny seed and wants to grow the tallest [flower] ever.",
           "{name} wishes for a [flower] of their own, as tall as the sky."],
    problems: [
      { need: [], fail: "{name} puts the seed in the ground. Every morning {name} runs out to look, but the [sun] is hot, the ground is dry, and nothing grows.",
        works: "Every day they water it, and one morning {name} looks out and sees a tall [sunflower]!" },
    ],
    helpAny: "\"It needs water,\" says {Helper}, and brings a [cup] of water from the [{water}].",
    end: ["{name} and {Helper} sit under the [sunflower] and look up at it, so bright and so yellow.",
          "{name} gives the first [sunflower] to {Helper}, and sows the new seeds all around."] },
};

// ---- The generator ----------------------------------------------------------

// Seeded, so the same choices and seed give the same book everywhere.
export function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickFrom = rand => arr => arr[Math.floor(rand() * arr.length)];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Which problems this hero has in this place: one the hero cannot solve
// alone, with a helper there who can.
function problemsFor(wish, kind, place) {
  const own = new Set(KINDS[kind].can);
  return WISHES[wish].problems.filter(p => !(p.stops || p.need).some(n => own.has(n)))
    .map(p => ({ p, helpers: PLACES[place].helpers.filter(h => h !== kind &&
      (!p.need.length || p.need.some(n => HELPERS[h].includes(n)))) }))
    .filter(x => x.helpers.length);
}

/** The wishes that make a story for this hero in this place. */
export function wishesFor(kind, place) {
  if (!KINDS[kind] || !PLACES[place]) return [];
  return Object.keys(WISHES).filter(w => !(WISHES[w].not || []).includes(place) &&
    !(w === "fly" && KINDS[kind].can.includes("fly")) && problemsFor(w, kind, place).length);
}

// A template filled in. Returns the text as read, and the words it marked to
// be drawn, so a test can hold the page to exactly those.
function fill(template, ctx) {
  const t = template.replace(/\{(\w+)\}/g, (m, k) => (k in ctx ? ctx[k] : m));
  const marked = [...t.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
  return { text: t.replace(/\[([^\]]+)\]/g, "$1"), marked };
}

/**
 * Write a book. Every choice is optional: whatever is missing (or does not fit
 * the rest) is picked with the seed.
 *   writeStory({ kind: "dog", name: "Pip", place: "farm", wish: "sea", seed: 1 })
 * → { title, cast: [hero, helper], pages: [six strings], drawn: [[words]…], choices }
 */
export function writeStory({ kind, name, place, wish, seed = Date.now() } = {}) {
  const rand = rng(seed);
  const pick = pickFrom(rand);
  if (!KINDS[kind]) kind = pick(Object.keys(KINDS).filter(k => k !== "me"));
  if (!PLACES[place]) place = pick(Object.keys(PLACES));
  const fits = wishesFor(kind, place);
  if (!fits.length) {                                   // no problem this hero has here: move house
    place = pick(Object.keys(PLACES).filter(p => wishesFor(kind, p).length));
    return writeStory({ kind, name, place, wish, seed });
  }
  if (!fits.includes(wish)) wish = pick(fits);
  name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40) || pick(KINDS[kind].names);

  const w = WISHES[wish], pl = PLACES[place];
  const { p: problem, helpers } = pick(problemsFor(wish, kind, place));
  const helperKind = pick(helpers);
  const Helper = cap(helperKind);
  const way = problem.need.find(n => HELPERS[helperKind].includes(n));
  // A wish with its own help (a lantern, an idea, water) uses it whoever
  // helps; `need` then only chose who comes — an owl for the dark.
  const help = way && !w.helpAny ? (problem.help || {})[way] || HELP[way] : null;
  const advice = problem.helpAny || w.helpAny;
  const item = pick(LOST);
  const ctx = { name, Helper, item, Item: cap(item), dark: pl.dark, flyer: pick(["balloon", "kite"]),
    water: place === "beach" ? "sea" : pick(["pond", "lake"]),
    others: (k => PLURAL[k] || k + "s")(pick(pl.helpers.filter(h => h !== kind && h !== helperKind))),
    colour: pick(["red", "blue", "yellow", "green"]) };
  // "Pip is a little dog": the kind is drawn as the hero, so it is not
  // marked. For the reader's own drawing no kind is written at all.
  const who = kind === "me" ? `${name} lives ${pl.in}.` :
    `${name} is a ${pick(["little", "young", "small"])} ${kind} who lives ${pl.in}.`;

  const lines = [
    who + " " + pick(pl.home),
    pick(w.want),
    problem.fail,
    help ? `Just then, ${help.arrive}. ${help.offer}` :
      `Just then, {Helper} ${pick(["comes over to", "stops to say hello to"])} {name}. ${advice}`,
    help ? `${help.does}. ${problem.works}${help.then ? " " + help.then : ""}` : problem.works,
    pick(w.end),
  ];
  const pages = lines.map(l => fill(l, ctx));
  return {
    title: fill(pick(w.title), ctx).text,
    cast: [{ name, is: kind }, { name: Helper, is: helperKind }],
    pages: pages.map(p => p.text),
    drawn: pages.map(p => p.marked),
    choices: { kind, name, place, wish, seed, helper: helperKind, problem: w.problems.indexOf(problem) },
  };
}

// ---- A story the person writes (stage 3) --------------------------------------
//
// Someone writes or pastes their own story; the page splits it into pages,
// asks who the hero is, and shows what each page will draw BEFORE drawing
// it. It never rewrites a word: the page corrects the model, never the person.

// What a share link holds (web/share.mjs LIMITS): 8 pages of 600 characters.
export const OWN = { pages: 8, text: 600, title: 120 };

// Sentences, the unit a long page is broken at. "Mr." does not end one.
const TITLES = /\b(Mr|Mrs|Ms|Dr|St|Mt|Prof|Capt)\.$/;
function sentences(text) {
  const out = [];
  for (const piece of String(text).trim().split(/(?<=[.!?…]["'’”)]?)\s+/)) {
    if (out.length && TITLES.test(out.at(-1))) out[out.length - 1] += " " + piece;
    else if (piece) out.push(piece);
  }
  return out;
}

// Sentences into pages of about `per`, none over the limit. A single sentence
// longer than a page is cut at a word — said in `notes`, never silently.
function group(sents, per, notes) {
  const pages = [];
  let cur = "";
  for (let sn of sents) {
    if (sn.length > OWN.text) {
      notes.push("A sentence was longer than a page, so it was split.");
      while (sn.length > OWN.text) {
        const cut = sn.lastIndexOf(" ", OWN.text - 1);
        const at = cut > 0 ? cut : OWN.text;
        if (cur) { pages.push(cur); cur = ""; }
        pages.push(sn.slice(0, at).trim()); sn = sn.slice(at).trim();
      }
    }
    const next = cur ? cur + " " + sn : sn;
    if (cur && (next.length > OWN.text || sentences(cur).length >= per)) { pages.push(cur); cur = sn; }
    else cur = next;
  }
  if (cur) pages.push(cur);
  return pages;
}

/**
 * The person's text as a title and pages. Paragraphs are pages when there are
 * 2–8 of them and each fits; otherwise the sentences are grouped into about
 * six pages. More than a book holds keeps the first eight pages and says so.
 */
export function splitPages(raw) {
  const notes = [];
  let text = String(raw || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  let title = "";
  const lines = text.split("\n");
  // A short first line with no full stop is a title — shown, so it can be changed.
  if (lines.length > 1 && lines[0].trim().length <= 60 && !/[.!?,;:]$/.test(lines[0].trim()) && lines.slice(1).join("").trim()) {
    title = lines[0].trim().replace(/^#+\s*/, "").slice(0, OWN.title);
    text = lines.slice(1).join("\n").trim();
  }
  let paras = text.split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  // One line per paragraph, with no blank lines between: still paragraphs.
  if (paras.length === 1 && text.split("\n").filter(l => l.trim()).length >= 3)
    paras = text.split("\n").map(l => l.trim()).filter(Boolean);
  let pages;
  if (paras.length >= 2 && paras.length <= OWN.pages && paras.every(p => p.length <= OWN.text)) pages = paras;
  else {
    const all = paras.flatMap(sentences);
    const per = Math.max(1, Math.ceil(all.length / 6));
    pages = paras.length > OWN.pages || paras.length < 2 ? group(all, per, notes) : paras.flatMap(p => group(sentences(p), per, notes));
  }
  if (pages.length > OWN.pages) {
    notes.push(`That is more than a book holds, so only the first ${OWN.pages} pages are used.`);
    pages = pages.slice(0, OWN.pages);
  }
  return { title, pages, notes };
}

const SIZE = "(?:(?:little|young|small|big|tiny|old|brave|clever|kind|shy|happy|sleepy|curious|friendly)\\s+)*";
const can = kind => !!drawAs({ is: kind });
const STARTERS = /^(The|A|An|One|Once|Then|But|And|So|When|It|He|She|They|There|In|On|At|After|Soon|Just|Every|That|This|What|Where|Why|How|We|You|Her|His|Their|My|Our|Its|Now|Next|Later|Finally|At|Suddenly|All|Some|No|Yes|Oh|Mr|Mrs|Ms|Dr|I)$/;
/**
 * Who the hero is, when the text says so plainly: "a dog named Max", "Max the
 * dog", "Max was a little dog". Only when the kind has a picture; otherwise
 * the name alone, and the person is asked. It is a suggestion in the builder,
 * never applied without being shown.
 */
export function guessHero(text) {
  const t = String(text || "");
  const found = [
    [...t.matchAll(new RegExp(`\\b(?:[Aa]|[Aa]n|[Tt]he)\\s+${SIZE}([a-z]+)\\s+(?:named|called)\\s+([A-Z][\\w'-]+)`, "g"))].map(m => [m[2], m[1]]),
    [...t.matchAll(new RegExp(`\\b([A-Z][\\w'-]+)\\s+(?:is|was)\\s+(?:a|an)\\s+${SIZE}([a-z]+)`, "g"))].map(m => [m[1], m[2]]),
    [...t.matchAll(new RegExp(`\\b([A-Z][\\w'-]+),?\\s+the\\s+${SIZE}([a-z]+)\\b`, "g"))].map(m => [m[1], m[2]]),
  ].flat().filter(([name]) => !STARTERS.test(name));
  // The hero is the one the story names most: "a robin called Rosie" once
  // does not make Rosie the hero of Max's story.
  const mentions = name => (t.match(new RegExp("\\b" + name + "\\b", "g")) || []).length;
  const withKind = found.filter(([, kind]) => can(kind)).sort((a, b) => mentions(b[0]) - mentions(a[0]))[0];
  if (withKind) return { name: withKind[0], kind: withKind[1] };
  // Otherwise the capitalised word said most often that is not a word that
  // merely starts sentences.
  const counts = new Map();
  for (const m of t.matchAll(/\b([A-Z][a-z][\w'-]*)/g)) if (!STARTERS.test(m[1])) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? { name: best[0], kind: null } : found.length ? { name: found[0][0], kind: null } : null;
}

/** A person's story as a book: { title, cast, pages, notes }. */
export function storyFromText(text, { name = "", kind = null } = {}) {
  const { title, pages, notes } = splitPages(text);
  name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const cast = name ? [{ name, is: kind || "child" }] : [];
  if (name && kind && !can(kind)) notes.push(`There is no ${kind} picture, so ${name} is drawn as a stand-in.`);
  return { title: title || (name ? `${name}'s Story` : "My Story"), cast, pages, notes };
}

/**
 * What each page will draw, before anything is drawn — the guide under the
 * text box. Every row is something the page can check mechanically.
 */
export function checkPages(story) {
  const hero = story.cast[0];
  const heroWords = hero ? hero.name.toLowerCase().split(/\s+/) : [];
  return story.pages.map(text => {
    const draws = planFromWords(text, story).map(e => e.replace(/\s+x\d+$/, ""));
    const lower = text.toLowerCase();
    return { draws, nothing: !draws.length,
      heroNamed: !hero || heroWords.some(w => new RegExp("\\b" + w.replace(/[^a-z0-9'-]/g, "") + "\\b").test(lower)),
      tooLong: text.length > OWN.text };
  });
}

export { PAGES };
