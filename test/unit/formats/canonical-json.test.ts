import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RomliftInvariantError } from '../../../src/foundation/diagnostics/diagnostic.ts';
import { canonicalJson } from '../../../src/foundation/formats/canonical-json.ts';
import type { JsonValue } from '../../../src/foundation/formats/types.ts';

function text(value: JsonValue, chunkSize?: number): string {
  return [...canonicalJson(value, chunkSize)].join('');
}

test('scalars', () => {
  assert.equal(text(null), 'null');
  assert.equal(text(true), 'true');
  assert.equal(text(false), 'false');
  assert.equal(text(0), '0');
  assert.equal(text(-0), '0');
  assert.equal(text(1.5e300), '1.5e+300');
  assert.equal(text(0x0800_0000), '134217728');
  assert.equal(text(''), '""');
});

test('object keys sorted by code unit, undefined members omitted, no whitespace', () => {
  const value: JsonValue = { b: 1, a: [1, 2, { z: null, y: undefined }], B: 'x', é: 1, 10: 0, 9: 0, '': true };
  assert.equal(text(value), '{"":true,"10":0,"9":0,"B":"x","a":[1,2,{"z":null}],"b":1,"é":1}');
  assert.equal(text({ only: undefined }), '{}');
  assert.equal(text({ a: undefined, b: 1, c: undefined }), '{"b":1}');
  assert.equal(text([]), '[]');
  assert.equal(text([[], {}]), '[[],{}]');
});

test('key order ignores insertion order', () => {
  assert.equal(text({ x: 1, y: 2 }), text({ y: 2, x: 1 }));
});

test('strings are escaped as JSON.stringify escapes them', () => {
  const s = 'quote " backslash \\ newline \n tab \t nul \u0000 lone \ud800 emoji 😀';
  assert.equal(text(s), JSON.stringify(s));
  assert.equal(text({ [s]: s }), `{${JSON.stringify(s)}:${JSON.stringify(s)}}`);
  assert.deepEqual(JSON.parse(text({ [s]: [s] })), { [s]: [s] });
});

test('non-finite numbers, undefined in arrays and cycles are invariant violations', () => {
  assert.throws(() => text(Number.NaN), RomliftInvariantError);
  assert.throws(() => text({ a: Infinity }), RomliftInvariantError);
  assert.throws(() => text([1, -Infinity]), RomliftInvariantError);
  assert.throws(() => text([undefined] as unknown as JsonValue), RomliftInvariantError);
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  assert.throws(() => text(cycle as JsonValue), RomliftInvariantError);
});

test('a value shared twice (not a cycle) is written twice', () => {
  const shared = { k: [1] };
  assert.equal(text([shared, shared]), '[{"k":[1]},{"k":[1]}]');
});

test('chunks concatenate to the same text whatever their size, and stay bounded', () => {
  const value: JsonValue = { list: Array.from({ length: 2000 }, (_, i) => ({ i, name: `n${i}`, flag: i % 2 === 0 })) };
  const whole = text(value);
  assert.equal(whole, JSON.stringify(JSON.parse(whole)), 'valid JSON without whitespace');
  for (const size of [1, 7, 100, 4096]) {
    const chunks: string[] = [...canonicalJson(value, size)];
    assert.equal(chunks.join(''), whole);
    const longest = Math.max(...chunks.map((c) => c.length));
    assert.ok(longest < size + 64, `chunk of ${longest} with size ${size}`);
  }
  assert.ok([...canonicalJson(value)].length >= 1);
});

test('deep nesting and 10,000-element arrays need no recursion', () => {
  let deep: JsonValue = 0;
  for (let i = 0; i < 100_000; i++) deep = i % 2 === 0 ? [deep] : { k: deep };
  const out = text(deep);
  assert.equal(out.length, (100_000 / 2) * ('[]'.length + '{"k":}'.length) + 1);
  const wide: JsonValue = Array.from({ length: 10_000 }, (_, i) => Array.from({ length: 3 }, () => i));
  assert.equal(text(wide), JSON.stringify(wide));
});
