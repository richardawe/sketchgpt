import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSketch, toSource, resolveStamp, estimateTokens, planSketchTurn,
  sketchPrompt, MAX_COMMANDS, MIN_CONTEXT, GRID
} from '../web/sketch.mjs';

const draw = (...c) => JSON.stringify({ t: 'Sketch', c });
const tools = d => parseSketch(d).commands.map(c => c.tool);

// ---- the wire format ------------------------------------------------------

test('accepts every drawing tool on the 0-100 grid', () => {
  const d = draw('line 0 0 100 100', 'circle 50 50 20', 'box 20 30 40 30',
    'curve 0 0 50 50 100 100', 'curve 0 0 20 20 40 40 60 60 80 80',
    'label 20 30 hello there', 'house 25 55 40');
  assert.deepEqual(tools(d),
    ['line', 'circle', 'box', 'curve', 'curve', 'label', 'stamp']);
});

test('accepts the names a model reaches for instead of ours', () => {
  const d = draw('rect 10 10 20 20', 'rectangle 10 10 20 20', 'path 0 0 5 5 10 10',
    'text 10 10 hi', 'CIRCLE 50 50 10');
  assert.deepEqual(tools(d), ['box', 'box', 'curve', 'label', 'circle']);
});

test('commas are as good as spaces', () => {
  assert.deepEqual(parseSketch(draw('line 0,0,100,100')).commands[0].args, [0, 0, 100, 100]);
});

test('a label keeps its words, markup and all', () => {
  const [c] = parseSketch(draw('label 20 30 <script>alert(1)</script> & co')).commands;
  assert.equal(c.text, '<script>alert(1)</script> & co');
});

// ---- stamps ---------------------------------------------------------------

test('a stamp resolves through plurals, case, aliases and near misses', () => {
  assert.equal(resolveStamp('house'), 'house');
  assert.equal(resolveStamp('Home'), 'house');          // alias
  assert.equal(resolveStamp('tree'), 'tree-deciduous'); // alias
  assert.equal(resolveStamp('trees'), 'trees');         // exact wins over the singular
  assert.equal(resolveStamp('cats'), 'cat');            // plural
  assert.equal(resolveStamp('mountain-snow'), 'mountain-snow');
  assert.equal(resolveStamp('rockets'), 'rocket');
  assert.equal(resolveStamp('zzzz'), null);
});

test('an unknown noun degrades to a label, not to nothing', () => {
  const [c] = parseSketch(draw('bungalow 30 40 20')).commands;
  assert.deepEqual([c.tool, c.text, c.args], ['label', 'bungalow', [30, 40]]);
});

test('a stamp without a size still draws', () => {
  assert.deepEqual(parseSketch(draw('sun 15 15')).commands[0].args, [15, 15, 12]);
});

// ---- staying on the canvas ------------------------------------------------

test('shapes are shrunk onto the canvas, not thrown away', () => {
  const [circle, box] = parseSketch(draw('circle 10 10 40', 'box 80 80 50 50')).commands;
  assert.deepEqual(circle.args, [10, 10, 10]);
  assert.deepEqual(box.args, [80, 80, 20, 20]);
});

test('coordinates outside the grid are clamped onto it', () => {
  assert.deepEqual(parseSketch(draw('line -20 0 400 50')).commands[0].args, [0, 0, GRID, 50]);
});

// ---- placing what the model could only name -------------------------------

const stamps = d => d.commands.filter(c => c.tool === 'stamp');
const closest = d => {
  const s = stamps(d);
  let worst = Infinity;
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    worst = Math.min(worst, Math.hypot(s[i].args[0] - s[j].args[0], s[i].args[1] - s[j].args[1])
      / ((s[i].args[2] + s[j].args[2]) / 2));
  }
  return worst;
};
const onCanvas = d => stamps(d).every(c => {
  const r = c.args[2] / 2;
  return c.args[0] - r >= -0.5 && c.args[0] + r <= GRID + 0.5
      && c.args[1] - r >= -0.5 && c.args[1] + r <= GRID + 0.5;
});

test('stamps the model piled up are spread out, in the order it listed them', () => {
  // Exactly what Qwen3-0.6B returned on a phone for "a house with a tree and
  // a car": three correct nouns, all at x=50, y two apart.
  const d = parseSketch(draw('house 50 50 30', 'tree-deciduous 50 52 30', 'car 50 54 30'));
  assert.equal(d.moved, 2);
  assert.ok(closest(d) > 0.85, `still overlapping: ${closest(d)}`);
  assert.ok(onCanvas(d));
  // The order it gave is the only intent it expressed, so it survives.
  assert.deepEqual(stamps(d).map(c => c.text), ['house', 'tree-deciduous', 'car']);
  const ys = stamps(d).map(c => c.args[1]);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'the listed order was scrambled');
});

test('stamps at the very same point fan out rather than stacking', () => {
  const d = parseSketch(draw('house 50 50 30', 'tree 50 50 30', 'car 50 50 30', 'sun 50 50 30'));
  assert.ok(closest(d) > 0.85, `still overlapping: ${closest(d)}`);
  assert.ok(onCanvas(d));
  assert.equal(d.moved, 4);
});

test('a drawing that was already placed well is left alone', () => {
  for (const d of [
    parseSketch(draw('house 25 55 40', 'tree 78 50 34', 'sun 15 15 14')),
    // A sun tucked behind a cloud is a composition, not a collapse.
    parseSketch(draw('cloud 50 30 30', 'sun 62 24 20')),
    parseSketch(draw('cat 50 52 34', 'line 5 82 95 82')),
  ]) assert.equal(d.moved, 0);
});

test('only stamps are moved — a primitive means what it says', () => {
  const d = parseSketch(draw('circle 50 50 20', 'box 45 45 10 10', 'line 50 50 50 52',
    'house 50 50 30', 'tree 50 51 30'));
  assert.deepEqual(d.commands.find(c => c.tool === 'circle').args, [50, 50, 20]);
  assert.deepEqual(d.commands.find(c => c.tool === 'box').args, [45, 45, 10, 10]);
  assert.deepEqual(d.commands.find(c => c.tool === 'line').args, [50, 50, 50, 52]);
  assert.equal(d.moved, 2);
});

test('the commands shown are the model\'s own, and the ones re-sent are the tidied ones', () => {
  const d = parseSketch(draw('house 50 50 30', 'tree-deciduous 50 52 30'));
  assert.deepEqual(d.source, ['house 50 50 30', 'tree-deciduous 50 52 30']);
  // The next turn is seeded with coordinates that work, not the pile.
  assert.notDeepEqual(JSON.parse(toSource(d)).c, d.source);
  assert.equal(parseSketch(toSource(d)).moved, 0, 'the tidied drawing must be stable');
});

// ---- failure, and the difference between sloppy and broken ----------------

test('a few bad commands are dropped, and counted', () => {
  const d = parseSketch(draw('circle 50 50 20', 'house 25 55 40', 'line 0 0', 'circle 50 50 0'));
  assert.equal(d.commands.length, 2);
  assert.equal(d.dropped, 2);
});

test('mostly-bad output fails instead of rendering a fragment', () => {
  assert.throws(() => parseSketch(draw('circle 50 50 20', 'line 0 0', 'box', 'what')));
});

test('a drawing cut off mid-JSON keeps the commands that arrived', () => {
  const cut = '{"t":"A house","c":["house 25 55 40","tree 80 45 30","circle 15 1';
  const d = parseSketch(cut);
  assert.equal(d.truncated, true);
  assert.deepEqual(d.commands.map(c => c.text), ['house', 'tree-deciduous']);
});

test('rejects nothing-at-all, oversized input and empty drawings', () => {
  for (const raw of ['{', 'null', '[]', '{"t":"x","c":[]}', '{"t":"x"}',
    'x'.repeat(24001), draw('x'.repeat(121)), draw(42)]) {
    assert.throws(() => parseSketch(raw), raw.slice(0, 60));
  }
});

test('an executable-looking noun is inert text, and reaches no prototype', () => {
  // Unknown nouns become labels, and a label is inserted with textContent.
  // The stamp table is a Map keyed by resolved names, so "constructor" and
  // "__proto__" resolve to nothing rather than to a function.
  for (const word of ['script', 'constructor', '__proto__', 'toString']) {
    assert.equal(resolveStamp(word), null);
    const [c] = parseSketch(draw(`${word} 10 10 20`)).commands;
    assert.equal(c.tool, 'label');
    assert.match(c.text, /^[a-z0-9 ]+$/);  // stripped to plain words on the way in
  }
});

// ---- reasoning wrappers (the fault this inherited) ------------------------

test('accepts reasoning wrappers and fences without changing labels', () => {
  const raw = draw('label 20 30 Keep <think> and </think> literally');
  const expected = parseSketch(raw).commands;
  for (const wrapped of [raw, '<think>Plan {a shape} first.</think>\n' + raw,
    '</think>\n' + raw, 'Plan {a shape} first.</think>\n' + raw,
    '```json\n' + raw + '\n```', '<think></think>\n```json\n' + raw + '\n```']) {
    assert.deepEqual(parseSketch(wrapped).commands, expected);
  }
});

test('rejects unfinished reasoning and raw SVG', () => {
  for (const raw of ['<think>Still thinking', '<svg><circle /></svg>',
    '<think>{"t":"Hidden","c":["circle 50 50 20"]}']) {
    assert.throws(() => parseSketch(raw));
  }
});

// ---- what gets re-sent ----------------------------------------------------

test('the stored source is canonical, cheap, and free of bad commands', () => {
  const messy = '<think>hmm</think>\n```json\n' +
    draw('RECT 10 10 20 20', 'line 0 0', 'home 25 55 40', 'text 5 90 a note') + '\n```';
  const source = toSource(parseSketch(messy));
  assert.equal(source, '{"t":"Sketch","c":["box 10 10 20 20","house 25 55 40","label 5 90 a note"]}');
  assert.deepEqual(parseSketch(source).commands, parseSketch(messy).commands);
});

// ---- the context budget ---------------------------------------------------

test('the estimator never reads low on the characters that matter', () => {
  // Checked against Qwen3's real tokenizer by scripts/token-budget.mjs; this
  // guards the shape of the rule, which is that a digit is a token.
  assert.equal(estimateTokens('160'), 3);
  assert.equal(estimateTokens(' 160'), 4);
  assert.ok(estimateTokens(sketchPrompt(14)) >= 197);
  assert.equal(estimateTokens(''), 0);
});

test('the prompt teaches only commands the page can actually draw', () => {
  // Every example the prompt shows is parsed back through the real parser. A
  // noun in the example that did not resolve would teach the model a word
  // that silently degrades to a text label.
  const prompt = sketchPrompt(14);
  // Only the worked examples, not the empty template on the first line.
  const examples = [...prompt.matchAll(/-> (\{"t":.*?\]\})/g)].map(m => m[1]);
  assert.ok(examples.length >= 2, 'needs more than one example');
  for (const example of examples) {
    const drawing = parseSketch(example);
    assert.equal(drawing.dropped, 0, example);
    for (const c of drawing.commands) assert.notEqual(c.tool, 'label', `unresolved noun in ${example}`);
  }
  // Qwen3-0.6B copied a single example's shape — two objects and a ground
  // line — and drew two houses when asked for one. The examples must differ
  // in length, or they teach a fixed answer rather than a rule.
  const lengths = new Set(examples.map(e => JSON.parse(e).c.length));
  assert.ok(lengths.size > 1, `examples all have the same command count: ${[...lengths]}`);
  // Two examples were not enough on their own: asked for one cat it drew two,
  // because every shape it had seen — the template included — held at least
  // two commands. It has to see that one is a complete answer.
  assert.equal(Math.min(...lengths), 1, 'no example shows a one-command drawing');
  assert.doesNotMatch(prompt.split("\n")[0], /"command","command"/,
    'the template on the first line shows two slots again');
  // And a title that strips the imperative, since it echoed "Draw a house" back.
  for (const example of examples) assert.doesNotMatch(JSON.parse(example).t, /^Draw /i);
});

test('the prompt stops growing after the first revision', () => {
  const drawing = toSource(parseSketch(draw('house 25 55 40', 'tree 80 45 30')));
  const history = [];
  const sizes = [];
  for (let turn = 0; turn < 12; turn++) {
    history.push({ role: 'user', content: 'make the tree bigger' });
    const plan = planSketchTurn(history, 1024);
    sizes.push(plan.messages.reduce((n, m) => n + estimateTokens(m.content), 0));
    history.push({ role: 'assistant', content: drawing });
  }
  assert.equal(history.length, 24);
  assert.deepEqual(new Set(sizes.slice(2)).size, 1, 'flat from turn 3 on');
  assert.ok(sizes.at(-1) < sizes[0] * 2);
});

test('the page never offers a context the prompt cannot serve', () => {
  // CTX_LADDER in browser.html bottoms out at 1024. MIN_CONTEXT is the floor
  // below which a sketch turn does not fit at all; if the prompt ever grows
  // past the ladder, this fails rather than the phone failing.
  const CTX_LADDER = [4096, 2048, 1024];
  assert.ok(Math.min(...CTX_LADDER) > MIN_CONTEXT,
    `prompt outgrew the lowest context rung: needs > ${MIN_CONTEXT}`);
  const MESSAGE_ALLOWANCE = 6 * 13 + 48 + 20;   // min drawing + reserve + a request
  const brief = estimateTokens(sketchPrompt(6, true));
  assert.ok(brief + MESSAGE_ALLOWANCE < MIN_CONTEXT,
    `the brief prompt (${brief}) no longer fits MIN_CONTEXT ${MIN_CONTEXT}`);
});

test('a turn is planned to fit its window, at every context rung', () => {
  const drawing = toSource(parseSketch(draw('house 25 55 40', 'tree 80 45 30')));
  for (const ctx of [4096, 2048, 1024]) {
    const history = [];
    for (let turn = 0; turn < 6; turn++) {
      history.push({ role: 'user', content: 'draw a house beside a tree' });
      const plan = planSketchTurn(history, ctx);
      const prompt = plan.messages.reduce((n, m) => n + estimateTokens(m.content) + 5, 0);
      assert.ok(prompt + plan.maxTokens <= ctx, `ctx ${ctx} turn ${turn}: ${prompt} + ${plan.maxTokens}`);
      assert.ok(plan.maxCommands >= 6 && plan.maxCommands <= MAX_COMMANDS);
      assert.equal(plan.messages[0].role, 'system');
      assert.equal(plan.messages.at(-1).content, 'draw a house beside a tree');
      history.push({ role: 'assistant', content: drawing });
    }
  }
});

test('the previous drawing is carried as a seed when there is room', () => {
  const drawing = toSource(parseSketch(draw('house 25 55 40')));
  const history = [{ role: 'user', content: 'draw a house' },
    { role: 'assistant', content: drawing }, { role: 'user', content: 'bigger' }];
  assert.equal(planSketchTurn(history, 4096).seeded, true);
  assert.equal(planSketchTurn(history, 4096).messages.length, 4);
  // A window too small for a seed still sends a usable turn.
  const tight = planSketchTurn(history, 320);
  assert.equal(tight.seeded, false);
  assert.equal(tight.messages.length, 2);
});

test('a style preference rides along with the sketch prompt', () => {
  const plan = planSketchTurn([{ role: 'user', content: 'a cat' }], 4096, 'minimal, few lines');
  assert.match(plan.messages[0].content, /Style preference: minimal, few lines/);
});
