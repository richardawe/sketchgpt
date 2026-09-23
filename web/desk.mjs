// Desk — two tools for the work you would not paste into a cloud chatbot.
//
// This replaced Work mode, and the reasons are measured, not taste:
//
//   - Work mode's retrieval layer was the part that failed. It searched with
//     text that was an instruction ("French", "half the length"), declared
//     documents too long at half their real size, and offered no task that
//     asked for retrieval at all. docs/fix-plan-work-ui.md has the review.
//   - The tasks that survive are the ones this project's oldest finding says a
//     0.6B model can be trusted with: OPEN shapes, where there is no single
//     correct answer and a bad result looks mediocre rather than confidently
//     wrong. Summarise, explain and translate have a correct answer, so they
//     went, for the same reason the mood tagger was deleted.
//   - Every tool starts from something the person typed. Small models need a
//     seed; asked to generate from nothing they waffle.
//
// The page does what the page can compute. The model names the steps; the page
// draws the checklist, counts the words, and decides before anything runs
// whether the input fits.

import { estimateTokens } from "./sketch.mjs?v=6";   // ?v= matches browser.html

const GROUND =
  "You work only with what the person gives you. You cannot browse and you " +
  "know nothing about their situation beyond what they wrote. Never add a " +
  "fact, name, number, date or claim they did not give — where something is " +
  "missing, leave an obvious blank like [date].";

const quoted = s => `"""\n${s}\n"""`;

export const TONES = ["clearer", "friendlier", "firmer", "shorter",
  "more professional", "warmer", "simpler"];

// Two tools, deliberately. Five were built and run through Qwen3-0.6B and
// 1.7B on Ollama (docs/desk.md). "Draft a reply" and "Rehearse" were cut on
// the numbers — the 0.6B inverted what the person wanted to say in a reply,
// and neither size played a rehearsal convincingly. "Break it down" worked but
// was cut for focus: two things done well beat five on a menu. Each of the
// two that remain fails, when it fails, in a way the page can catch.
//
// `smallWeak` marks a tool Qwen3-0.6B measurably failed at and Qwen3-1.7B did
// not. The page says so when a sub-1B model is loaded, rather than letting a
// phone user find out from a bad draft.
//
// `list` means the answer is a list of actions, and the page renders it as a
// checklist rather than as prose. `checked` means the page compares the answer
// with the input (checkRewrite) and says what it finds.
export const TOOLS = [
  {
    id: "dump", label: "Brain dump", icon: "inbox",
    blurb: "Empty your head. Get back a to-do list you can tick off.",
    ask: "Type everything on your mind, in any order…",
    example: "dentist, email Sam about the budget, buy milk, worried about Monday, renew passport",
    // A to-do list of a dozen short lines is ~200 tokens. The cap is the cheap
    // half of the defence against a model that loops ("dont forget to buy
    // milk" x40, SmolLM2-360M, measured); collapseRepeats is the other half.
    temp: 0.3, list: true, maxOutput: 320,
    build: ({ text }) => ({
      system: `${GROUND} Turn their brain dump into a to-do list. Keep only things ` +
        `they can act on, one per line, each starting with "- " and a verb. Keep ` +
        `their own words where you can. Leave out feelings and worries that are ` +
        `not tasks. No introduction.`,
      user: `Brain dump:\n${quoted(text)}`
    })
  },
  {
    id: "polish", label: "Say it better", icon: "wand",
    blurb: "Rewrite a message in the tone you need. Every fact stays.",
    ask: "Paste what you wrote…",
    example: "hi, the report wont be ready friday because the data came late, sorry",
    options: { label: "Make it", values: TONES },
    // Measured: with no worked example Qwen3-0.6B turned "won't be ready
    // Friday" into "will be ready Friday"; WITH one, it copied the example's
    // content into an unrelated message. So no example, and the page checks
    // the result instead — see checkRewrite().
    temp: 0.3, checked: true, smallWeak: true,
    build: ({ text, option }) => ({
      system: `${GROUND} You rewrite the person's own message so they can send it. ` +
        `Write as them, to the same person they were writing to. Make it ` +
        `${option || "clearer"}. Keep every fact, name and number exactly — and if ` +
        `they say something will NOT happen, your version must say it will not ` +
        `happen. Change the wording only. Return only the rewritten message.`,
      user: `${quoted(text)}\n\nRewrite it to be ${option || "clearer"}.`
    })
  }
];

export const toolById = id => TOOLS.find(t => t.id === id) || null;

export const wordCount = text => (text.match(/\S+/g) || []).length;

// ---- Planning a turn ------------------------------------------------------

const RESERVE = 64;          // template drift, role tokens, a stop token
const MIN_OUTPUT = 160;      // below this a reply is not worth starting
const MAX_OUTPUT = 700;
const MESSAGE_OVERHEAD = 4;
const msgTokens = content => estimateTokens(content) + MESSAGE_OVERHEAD;


/**
 * Decide what the model sees, and whether it runs at all.
 *
 * Returns `{ run: true, messages, maxTokens }` or `{ run: false, note }`.
 * A turn that does not fit is refused with a sentence the person can act on,
 * never truncated: trimming someone's text silently changes what they asked.
 * Every turn is one-shot. Nothing from an earlier turn rides along, so turn
 * ten costs what turn one did.
 */
export function planDeskTurn({ tool, text = "", option = "", ctx = 4096 }) {
  if (!tool) return { run: false, note: "Pick a tool first." };
  const t = text.trim();
  if (!t) return { run: false, note: tool.ask };

  const built = tool.build({ text: t, option });
  const messages = [{ role: "system", content: built.system },
                    { role: "user", content: built.user }];
  const cost = messages.reduce((n, m) => n + msgTokens(m.content), 0);
  const room = ctx - cost - RESERVE;
  if (room < MIN_OUTPUT) {
    return {
      run: false,
      note: `That is ${wordCount(t)} words. On this device the model can take about ` +
        `${maxWords(tool, ctx)} at once — trim it to the part that matters.`
    };
  }
  return { run: true, messages, maxTokens: Math.min(tool.maxOutput || MAX_OUTPUT, room) };
}

/**
 * About how many words of input fit alongside the tool's prompt and a useful
 * reply. The composer shows this as the person types, so "too long" is never a
 * surprise after pressing Send. Estimated with the same (conservative) counter
 * the planner uses, so the two can never disagree.
 */
export function maxWords(tool, ctx) {
  if (!tool) return 0;
  const probe = tool.build({ text: "", option: "" });
  const fixed = msgTokens(probe.system) + msgTokens(probe.user);
  const room = ctx - fixed - RESERVE - MIN_OUTPUT;
  // estimateTokens charges an average English word about three tokens.
  return Math.max(0, Math.floor(room / 3));
}

// ---- Output the page lays out itself ---------------------------------------

/**
 * Pull list items out of a model's answer. The model is asked for "- " lines,
 * and small models also number them, star them or put them in brackets, so all
 * of those count. Returns null when fewer than two lines look like items: a
 * one-line answer is not a checklist, and forcing it into one hides that the
 * model did not do what was asked.
 */
export function parseChecklist(text) {
  const items = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(/^\s*(?:[-*•+]|\d+[.)]|\[[ xX]?\])\s+(?:\[[ xX]?\]\s+)?(.+?)\s*$/);
    // "- - Buy milk" is a real Qwen3-0.6B output: a bullet inside a bullet.
    if (m) items.push(m[1].replace(/^(?:[-*•]\s+)+/, ""));
  }
  const out = tidyItems(items);
  return out.length >= 2 ? out : null;
}

// Clean and de-duplicate list items. Measured shapes: Qwen2.5-0.5B and
// SmolLM2-360M wrap every item in quotes; SmolLM2 repeats items ("call mum
// back" twice in one list) and loops. A to-do list never needs the same line
// twice, so the page keeps the first and drops the rest.
function tidyItems(items) {
  const seen = new Set();
  const out = [];
  for (let it of items) {
    it = it.replace(/\*\*(.+?)\*\*/g, "$1").trim()
      .replace(/^["“'‘]+|["”'’]+$/g, "").replace(/[.;,]+$/, "").trim();
    const key = it.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= 15) break;
  }
  return out;
}

/**
 * When a model ignores the list format and writes prose — SmolLM2-360M did in
 * 4 of 12 runs, the bug a phone user hit "after a few chats" — the page splits
 * the prose itself, on lines and then on sentences. The words are still the
 * model's; only the shape is the page's. Returns null when there is not enough
 * to call a list, so a refusal or a single sentence is shown as what it is.
 */
export function listFromProse(text) {
  const parts = [];
  for (const line of String(text).split("\n")) {
    const l = line.trim();
    if (!l) continue;
    for (const piece of l.split(/(?<=[.!?])\s+(?=[A-Z"“])/)) parts.push(piece);
  }
  // A greeting or sign-off is not a task.
  const out = tidyItems(parts.filter(p => !/^(here|sure|certainly|of course|okay|ok)\b.*:$/i.test(p)))
    .filter(p => p.split(/\s+/).length <= 16);
  return out.length >= 2 ? out : null;
}

/**
 * Cut a repetition loop. Small models at 4-bit fall into them: SmolLM2-360M
 * repeated "I'm not doing overtime again this weekend." 60+ times until it ran
 * out of tokens. Any line that has already appeared twice is dropped from then
 * on. Returns the cleaned text and whether a loop was cut, so the page can say
 * so rather than quietly hide it.
 */
export function collapseRepeats(text) {
  const lines = String(text).split("\n");
  const count = new Map();
  const out = [];
  let looped = false;
  for (const line of lines) {
    const key = line.trim().toLowerCase().replace(/^[-*•\d.)\s"“]+|["”\s.]+$/g, "");
    if (key) {
      const n = (count.get(key) || 0) + 1;
      count.set(key, n);
      if (n > 2) { looped = true; continue; }
    }
    out.push(line);
  }
  // A loop usually stops mid-line when the token budget runs out.
  let t = out.join("\n").trim();
  if (looped) t = t.replace(/\n[^\n]{0,40}$/, "").trim();
  return { text: t, looped };
}

// ---- Checks the page makes on the model's work ------------------------------
// The model cannot be trusted to keep meaning; the page can check the parts of
// meaning that are mechanical. Each check turns a silent failure into a
// visible one, which is the line this project ships on.

const NEGATION = /\b(not|no|never|none|nothing|nobody|cannot|can't|cant|won't|wont|don't|dont|doesn't|doesnt|didn't|didnt|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|shouldn't|couldn't|wouldn't|unable|unavailable)\b|n't\b/i;
const NUMBER = /\d+(?:[.,:]\d+)*/g;
const WORDS = /[a-z][a-z'’-]{2,}/g;
const FILLER = new Set(("the and for with from that this have has had you your are was were " +
  "will would can could should about into onto them they their our out not but " +
  "all any get got too also just need needs").split(" "));

/** Strip a chatty first line such as "Sure! Here's a friendlier version:". */
export function stripPreamble(text) {
  const lines = String(text).trim().split("\n");
  if (lines.length && /^(sure|certainly|of course|okay|ok|here(?:'s| is| are))\b.*:\s*$/i.test(lines[0].trim()))
    lines.shift();
  return lines.join("\n").trim();
}

/**
 * Compare a rewrite with the text it came from. Returns sentences to show under
 * the answer; empty means nothing mechanical looks wrong — NOT that the
 * rewrite is right.
 */
export function checkRewrite(source, output) {
  const warn = [];
  if (NEGATION.test(source) && !NEGATION.test(output))
    warn.push("Your message says something will not happen. This version may say it will — check before sending.");
  const have = new Set(output.match(NUMBER) || []);
  const lost = [...new Set(source.match(NUMBER) || [])].filter(n => !have.has(n));
  if (lost.length)
    warn.push(`${lost.map(n => `"${n}"`).join(", ")} ${lost.length === 1 ? "is" : "are"} in your message but not in this version.`);
  return warn;
}

/**
 * Which parts of a brain dump appear nowhere in the list made from it. A dump
 * is split on commas, line breaks, semicolons and " and "; a part counts as
 * kept if any of its content words appears in any item. Measured: Qwen3-1.7B
 * silently dropped "dentist" from a seven-item dump. Shown, it is one tap to
 * add back; hidden, it is a missed appointment.
 */
export function leftOut(dump, items) {
  const kept = new Set(items.join(" ").toLowerCase().match(WORDS) || []);
  const out = [];
  for (const part of String(dump).split(/[,;\n]|\band\b/i)) {
    const p = part.trim();
    const words = (p.toLowerCase().match(WORDS) || []).filter(w => !FILLER.has(w));
    if (!words.length) continue;
    if (!words.some(w => kept.has(w) || [...kept].some(k => k.startsWith(w.slice(0, 5)) && w.length >= 5)))
      out.push(p);
  }
  return out;
}
