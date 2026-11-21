// pooled, onTargets and withSharedAgbcc (test/gates/gate.ts): how a gate works on its fixtures at once while
// reporting them as a serial loop would.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

import { onTargets, pooled, reportTargets, withSharedAgbcc } from '../../gates/gate.ts';

/** Work that finishes in the reverse of its start order, recording how many items ran at once. */
function reversing(n: number): {
  readonly work: (item: number) => Promise<number>;
  readonly peak: () => number;
  readonly started: number[];
} {
  let running = 0;
  let peak = 0;
  const started: number[] = [];
  return {
    started,
    peak: () => peak,
    work: async (item) => {
      started.push(item);
      running++;
      peak = Math.max(peak, running);
      for (let k = 0; k < n - item; k++) await tick();
      running--;
      return item * 10;
    },
  };
}

test("pooled returns the results in the items' order whatever order they finish in, at most `limit` at once", async () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7];
  const r = reversing(items.length);
  assert.deepEqual(await pooled(items, 3, r.work), [0, 10, 20, 30, 40, 50, 60, 70]);
  assert.equal(r.peak(), 3);
  assert.deepEqual(r.started, items);
});

test('pooled with limit 1 is a serial loop, and an empty list or a limit above its length is fine', async () => {
  const r = reversing(4);
  assert.deepEqual(await pooled([0, 1, 2, 3], 1, r.work), [0, 10, 20, 30]);
  assert.equal(r.peak(), 1);
  assert.deepEqual(await pooled([], 4, async () => 1), []);
  assert.deepEqual(await pooled([1, 2], 99, async (x) => x), [1, 2]);
});

test("pooled: after a failure no item starts, the started ones finish, and the earliest failing item's error is thrown", async () => {
  const started: number[] = [];
  const finished: number[] = [];
  const work = async (item: number): Promise<number> => {
    started.push(item);
    // Item 3 fails first in time; item 1, started before it, fails later.
    for (let k = 0; k < (item === 1 ? 6 : 1); k++) await tick();
    if (item === 1 || item === 3) throw new Error(`item ${item}`);
    finished.push(item);
    return item;
  };
  await assert.rejects(pooled([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4, work), /^Error: item 1$/);
  assert.ok(!started.includes(9), `started ${started.join(',')}`);
  for (const item of started)
    if (item !== 1 && item !== 3) assert.ok(finished.includes(item), `item ${item} was abandoned`);
});

test('onTargets runs the fixtures together and the datasets one at a time, fixtures first; reportTargets keeps that order', async () => {
  let running = 0;
  const peaks: Record<string, number> = { f: 0, d: 0 };
  const order: string[] = [];
  const results = await onTargets(['f1', 'f2', 'f3'], ['d1', 'd2'], async (name) => {
    running++;
    const kind = name.slice(0, 1);
    peaks[kind] = Math.max(peaks[kind] ?? 0, running);
    await tick();
    running--;
    order.push(name);
    return { problems: [`${name} problem`], notes: [`${name} note`] };
  });
  assert.equal(peaks['d'], 1);
  assert.deepEqual(order.slice(-2), ['d1', 'd2']);
  const notes: string[] = [];
  assert.deepEqual(reportTargets({ note: (n) => notes.push(n) }, results), [
    'f1 problem',
    'f2 problem',
    'f3 problem',
    'd1 problem',
    'd2 problem',
  ]);
  assert.deepEqual(notes, ['f1 note', 'f2 note', 'f3 note', 'd1 note', 'd2 note']);
});

test('withSharedAgbcc: one at a time until one builds agbcc, then the rest together, each given it', async () => {
  const given: (string | undefined)[] = [];
  let running = 0;
  let peak = 0;
  // The first item builds nothing (it fails before setup.sh, say); the second builds agbcc.
  const results = await withSharedAgbcc(
    ['a', 'b', 'c', 'd', 'e'],
    async (item, agbcc) => {
      running++;
      peak = Math.max(peak, running);
      given.push(agbcc);
      await tick();
      running--;
      return { item, agbcc: agbcc === undefined && item === 'b' ? '/b/tools/agbcc' : undefined };
    },
    2,
  );
  assert.deepEqual(
    results.map((r) => r.item),
    ['a', 'b', 'c', 'd', 'e'],
  );
  assert.deepEqual(given, [undefined, undefined, '/b/tools/agbcc', '/b/tools/agbcc', '/b/tools/agbcc']);
  assert.equal(peak, 2);
});

test('withSharedAgbcc: when no item builds agbcc, every item runs alone, as a serial loop would', async () => {
  let running = 0;
  let peak = 0;
  const results = await withSharedAgbcc(
    [1, 2, 3],
    async (item): Promise<{ readonly item: number; readonly agbcc?: string }> => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
      return { item };
    },
  );
  assert.deepEqual(
    results.map((r) => r.item),
    [1, 2, 3],
  );
  assert.equal(peak, 1);
});
