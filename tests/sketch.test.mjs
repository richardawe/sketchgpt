import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSketch } from '../web/sketch.mjs';
const command = (tool, args, text = '') => ({ tool, args, text });
const json = commands => JSON.stringify({ title: 'Sketch', commands });

test('accepts reasoning wrappers and JSON fences without changing labels', () => {
  const raw = json([command('text', [20, 30], 'Keep <think> and </think> literally')]);
  const expected = JSON.parse(raw);
  for (const wrapped of [raw, '<think>Plan {a shape} first.</think>\n' + raw,
    '</think>\n' + raw, 'Plan {a shape} first.</think>\n' + raw,
    '```json\n' + raw + '\n```', '<think></think>\n```json\n' + raw + '\n```']) {
    assert.deepEqual(parseSketch(wrapped), expected);
  }
});

test('rejects unfinished reasoning, raw SVG and incomplete wrapped JSON', () => {
  for (const raw of ['<think>Still thinking', '<svg><circle /></svg>',
    '<think>Plan</think>{"title":', '```json\n{}', '<think>{"title":"Hidden"}']) {
    assert.throws(() => parseSketch(raw));
  }
});

test('accepts all five drawing tools', () => {
  const commands = [command('line', [0, 0, 400, 400]), command('circle', [200, 200, 50]),
    command('rectangle', [20, 30, 100, 80]), command('path', [0, 0, 50, 50, 100, 100, 200, 200, 300, 300]),
    command('text', [20, 30], '<script>alert(1)</script>')];
  assert.deepEqual(parseSketch(json(commands)).commands, commands);
});

test('rejects malformed, oversized and executable commands', () => {
  for (const raw of ['{', 'null', '[]', 'x'.repeat(24001), json([]),
    json(Array(41).fill(command('line', [0, 0, 1, 1]))),
    json([command('script', [])]), json([command('constructor', [])]),
    json([{ ...command('line', [0, 0, 1, 1]), onclick: 'alert(1)' }]),
    json([command('path', [0, 0, 1, 1])]), json([command('line', ['0', 0, 1, 1])]),
    json([command('line', [0, -1, 1, 1])]), json([command('line', [0, 0, null, 1])]),
    json([command('circle', [10, 10, 40])]), json([command('circle', [10, 10, 0])]),
    json([command('rectangle', [300, 300, 200, 200])]),
    json([command('text', [0, 0], 'x'.repeat(81))])]) {
    assert.throws(() => parseSketch(raw), raw.slice(0, 120));
  }
});
