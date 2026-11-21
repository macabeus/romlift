import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256Of } from 'romlift/node';

import {
  PARITY_SCHEMA,
  parityDigest,
  parityText,
  parseParityView,
  parsePocDigests,
} from '../../../bench/src/parity-view.ts';

/** A hand-written view: an ARM entry, a Thumb function with a pool, a table, a far and a noreturn site. */
function view(): Record<string, unknown> {
  return {
    schema: PARITY_SCHEMA,
    functions: [
      {
        entry: 0x0800_0000,
        mode: 'arm',
        end: 0x0800_0010,
        codeEnd: 0x0800_000c,
        code: [[0x0800_0000, 0x0800_000c]],
        pools: [0x0800_000c],
        tables: [],
        far: [],
        noreturn: [],
        origin: 'rom-entry',
      },
      {
        entry: 0x0800_0010,
        mode: 'thumb',
        end: 0x0800_0040,
        codeEnd: 0x0800_0030,
        code: [
          [0x0800_0010, 0x0800_0020],
          [0x0800_0024, 0x0800_0030],
        ],
        pools: [0x0800_0030, 0x0800_0034],
        tables: [[0x0800_0038, 2]],
        far: [0x0800_0014],
        noreturn: [0x0800_0018],
        origin: 'gap-scan',
      },
    ],
    claims: [
      [0x0800_0000, 0x0800_000c, 1],
      [0x0800_000c, 0x0800_0010, 2],
      [0x0800_0010, 0x0800_0020, 1],
      [0x0800_0020, 0x0800_0024, 4],
      [0x0800_0024, 0x0800_0030, 1],
      [0x0800_0030, 0x0800_0038, 2],
      [0x0800_0038, 0x0800_0040, 3],
    ],
    startup: { end: 0x0800_0010, entries: [0x0800_0000] },
    codeEnd: 0x0800_0040,
  };
}

/** The same value with every object's keys in reverse order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).reverse()) out[key] = reversedKeys((value as Record<string, unknown>)[key]);
  return out;
}

test('parseParityView reads a hand-written view field by field', () => {
  const parsed = parseParityView(view(), 'v');
  assert.equal(parsed.functions.length, 2);
  assert.deepEqual(parsed.functions[1]?.code, [
    [0x0800_0010, 0x0800_0020],
    [0x0800_0024, 0x0800_0030],
  ]);
  assert.deepEqual(parsed.functions[1]?.tables, [[0x0800_0038, 2]]);
  assert.equal(parsed.claims.length, 7);
  assert.deepEqual(parsed.startup, { end: 0x0800_0010, entries: [0x0800_0000] });
});

test('the parity digest is the sha256 of the canonical JSON, whatever the input key order', () => {
  const parsed = parseParityView(view(), 'v');
  const text = parityText(parsed);
  assert.ok(text.endsWith('}\n'));
  assert.ok(text.startsWith('{"claims":'), 'keys sorted by code unit');
  assert.equal(parityDigest(parsed), sha256Of(text.slice(0, -1)));
  const reordered = parseParityView(reversedKeys(view()), 'v');
  assert.equal(parityDigest(reordered), parityDigest(parsed));
  // The parsed value and the raw value have the same canonical text.
  const raw = reversedKeys(view()) as Parameters<typeof parityDigest>[0];
  assert.equal(parityDigest(raw), parityDigest(parsed));
  // A different value has a different digest.
  const other = view();
  other['codeEnd'] = 0x0800_0044;
  assert.notEqual(parityDigest(parseParityView(other, 'v')), parityDigest(parsed));
});

test('parseParityView names the first field that is not as frozen', () => {
  const cases: ReadonlyArray<readonly [(v: Record<string, unknown>) => void, RegExp]> = [
    [(v) => (v['schema'] = 'other'), /v\.schema: is "other"/],
    [(v) => (v['extra'] = 1), /v\.extra: not a field/],
    [(v) => (fn(v, 1)['mode'] = 'mips'), /v\.functions\[1\]\.mode: expected thumb or arm/],
    [(v) => (fn(v, 1)['entry'] = '0x08000010'), /v\.functions\[1\]\.entry: expected an address/],
    [(v) => (fn(v, 1)['entry'] = -1), /v\.functions\[1\]\.entry: expected an address/],
    [
      (v) =>
        (fn(v, 1)['code'] = [
          [0x0800_0010, 0x0800_0020],
          [0x0800_0020, 0x0800_0030],
        ]),
      /v\.functions\[1\]\.code\[1\]: overlaps or touches/,
    ],
    [(v) => (fn(v, 1)['code'] = [[0x0800_0020, 0x0800_0010]]), /v\.functions\[1\]\.code\[0\]: empty or reversed/],
    [(v) => (fn(v, 1)['pools'] = [0x0800_0034, 0x0800_0030]), /v\.functions\[1\]\.pools\[1\]: not above/],
    [
      (v) => (fn(v, 1)['tables'] = [[0x0800_0038, 0]]),
      /v\.functions\[1\]\.tables\[0\]\[1\]: expected a positive integer/,
    ],
    [(v) => (fn(v, 1)['origin'] = 'gap scan'), /v\.functions\[1\]\.origin: expected a nonempty text with '-'/],
    [(v) => (fn(v, 0)['far'] = [0x0800_0004]), /v\.functions\[0\]: an ARM function has no far/],
    [(v) => (fn(v, 1)['noreturn'] = undefined), /v\.functions\[1\]\.noreturn: expected an array/],
    [(v) => (v['functions'] = [fn(v, 1), fn(v, 0)]), /v\.functions \(entries\)\[1\]: not above/],
    [
      (v) =>
        (v['claims'] = [
          [0x0800_0000, 0x0800_000c, 1],
          [0x0800_000c, 0x0800_0010, 1],
        ]),
      /v\.claims\[1\]: continues the run before it/,
    ],
    [(v) => (v['claims'] = [[0x0800_0000, 0x0800_000c, 5]]), /v\.claims\[0\]\[2\]: expected a claim kind/],
    [
      (v) =>
        (v['claims'] = [
          [0x0800_0000, 0x0800_000c, 1],
          [0x0800_0008, 0x0800_0010, 2],
        ]),
      /v\.claims\[1\]: overlaps/,
    ],
    [(v) => (v['startup'] = { end: 0x0800_0010 }), /v\.startup\.entries: expected an array/],
    [(v) => (v['codeEnd'] = 1.5), /v\.codeEnd: expected an address/],
  ];
  for (const [mutate, pattern] of cases) {
    const v = view();
    mutate(v);
    assert.throws(() => parseParityView(v, 'v'), pattern, String(pattern));
  }
});

function fn(v: Record<string, unknown>, i: number): Record<string, unknown> {
  const f = (v['functions'] as Record<string, unknown>[])[i];
  if (f === undefined) throw new Error('no such function');
  return f;
}

test('parsePocDigests reads the digests file and sorts its ROMs', () => {
  const digest = 'a'.repeat(64);
  const parsed = parsePocDigests(
    { schema: 'romlift-bench/poc-digests@1', pocSourceDigest: 'b'.repeat(64), roms: { sa2: digest, klonoa: digest } },
    'd',
  );
  assert.deepEqual(Object.keys(parsed.roms), ['klonoa', 'sa2']);
  assert.throws(() => parsePocDigests({ schema: 'x', pocSourceDigest: digest, roms: {} }, 'd'), /d\.schema/);
  assert.throws(
    () => parsePocDigests({ schema: 'romlift-bench/poc-digests@1', pocSourceDigest: 'B'.repeat(64), roms: {} }, 'd'),
    /d\.pocSourceDigest/,
  );
  assert.throws(
    () =>
      parsePocDigests({ schema: 'romlift-bench/poc-digests@1', pocSourceDigest: digest, roms: { sa2: 'short' } }, 'd'),
    /d\.roms\.sa2/,
  );
});
