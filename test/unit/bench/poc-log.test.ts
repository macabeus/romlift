import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  POC_METHODS,
  type PocQuery,
  expandInsnRuns,
  openPocLog,
  readReadings,
  readingKey,
} from '../../../bench/src/poc-log.ts';
import { withTempDir } from './fixtures.ts';

/** A stored reading (insnRuns form), as export-poc-child writes it. */
function stored(
  entry: number,
  mode: 'thumb' | 'arm',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    adrs: [],
    balance: [0],
    blSites: [],
    calls: [],
    codeEnd: entry + 8,
    deadEnd: [],
    end: entry + 12,
    entry,
    errors: [],
    insnRuns:
      mode === 'arm'
        ? [[entry, 4, 2]]
        : [
            [entry, 2, 2],
            [entry + 4, 4, 1],
          ],
    mode,
    pools: [[entry + 8, 0x0800_0101]],
    returns: 1,
    tables: [],
    tailExits: 0,
    tails: [],
    veneers: [],
    ...overrides,
  };
}

const THUMB = stored(0x0800_0100, 'thumb', {
  blSites: [[0x0800_0104, 0x0800_0200]],
  calls: [[0x0800_0200, 'thumb', 0x0800_0104]],
  balance: [-4, 0],
  adrs: [0x0800_0110],
  tables: [[0x0800_0120, [0x0800_0100, 0x0800_0102]]],
  errors: [['not_code', 0x0800_0108]],
});
const ARM = stored(0x0800_0000, 'arm');
const K_THUMB = readingKey(THUMB);
const K_ARM = readingKey(ARM);

const HEADER = {
  schema: 'romlift-bench/poc-queries@1',
  rom: 'tiny',
  sha1: 'f'.repeat(40),
  pocSourceDigest: 'p'.repeat(64),
  readings: 'readings.ndjson',
};

/** One record of every method, with nesting (seq 3..5 inside seq 2) and two epochs. */
function records(): Record<string, unknown>[] {
  const r = (seq: number, parent: number | null, epoch: number, method: string, args: unknown[], result: unknown) => ({
    seq,
    parent,
    epoch,
    method,
    args,
    result,
  });
  return [
    r(0, null, 0, 'analyzeArm', [0x0800_0000], { reading: K_ARM }),
    r(1, null, 0, 'claim', [0x0800_0000], { entry: 0x0800_0000, mode: 'arm', origin: 'rom entry', absorbed: false }),
    r(2, null, 0, 'valid', [0x0800_0100], true),
    r(3, 2, 0, 'whyInvalid', [0x0800_0100], null),
    r(4, 3, 0, 'settle', [0x0800_0100], { reading: K_THUMB, far: [0x0800_0104], noret: [] }),
    r(5, 3, 0, 'couldBeCode', [0x0800_0200], false),
    r(6, null, 1, 'forgetCandidates', [], null),
    r(7, null, 1, 'pointerCandidates', [], { pool: [0x0800_0100], data: [0x0800_0200, 0x0800_0300] }),
    r(8, null, 1, 'acceptable', [0x0800_0100, 'pool pointer'], true),
    r(9, null, 1, 'inPointerTable', [0x0800_0300], false),
    r(10, null, 1, 'whyInvalid', [0x0800_0300], 'decode error not_code at 8000300'),
    r(11, null, 1, 'absorbBlock', [0x140, 0x140, 0x180], 0x150),
    r(12, null, 1, 'absorbBlock', [0x150, 0x140, 0x180], null),
    r(13, null, 1, 'holeHead', [0x0800_0100, 0x180], { reading: K_THUMB }),
    r(14, null, 1, 'holeHead', [0x0800_0150, 0x180], null),
    r(15, null, 1, 'thumbCandidate', [0x0800_0100, 0x100, 0x180], { reading: K_THUMB }),
    r(16, null, 1, 'thumbCandidate', [0x0800_0150, 0x100, 0x180], null),
    r(17, 16, 1, 'valid', [0x0800_0150], false),
    r(18, null, 1, 'armAhead', [0x0, 0x40], [0x0, { reading: K_ARM }]),
    r(19, 18, 1, 'analyzeArm', [0x0800_0000], { reading: K_ARM }),
    r(20, null, 1, 'armAhead', [0x150, 0x180], null),
    r(21, null, 1, 'tryTiledHole', [0x0800_0100, 0x180], { reading: K_THUMB }),
    r(22, 21, 1, 'claim', [0x0800_0100], { entry: 0x0800_0100, mode: 'thumb', origin: 'tiled hole', absorbed: false }),
    r(23, null, 1, 'tryTiledHole', [0x0800_0150, 0x180], null),
    r(24, null, 1, 'claim', [0x0800_0140], { entry: 0x0800_0140, mode: 'thumb', origin: null, absorbed: true }),
    r(25, null, 2, 'forgetCandidates', [], null),
  ];
}

async function writeLog(dir: string, recs: readonly unknown[], readingLines?: readonly string[]): Promise<string> {
  const path = join(dir, 'queries.ndjson');
  await writeFile(path, [HEADER, ...recs].map((v) => `${JSON.stringify(v)}\n`).join(''));
  const lines =
    readingLines ??
    [
      { key: K_ARM, reading: ARM },
      { key: K_THUMB, reading: THUMB },
    ].map((v) => JSON.stringify(v));
  await writeFile(join(dir, 'readings.ndjson'), lines.map((l) => `${l}\n`).join(''));
  return path;
}

async function collect(path: string): Promise<PocQuery[]> {
  const log = await openPocLog(path);
  const out: PocQuery[] = [];
  for await (const q of log.queries) out.push(q);
  return out;
}

test('openPocLog reads a hand-written log: nesting, epochs and every result shape', async () => {
  await withTempDir('poc-log-', async (dir) => {
    const path = await writeLog(dir, records());
    const log = await openPocLog(path);
    assert.equal(log.header.rom, 'tiny');
    assert.equal(log.readings.size, 2);
    const qs: PocQuery[] = [];
    for await (const q of log.queries) qs.push(q);
    assert.equal(qs.length, 26);
    assert.deepEqual(new Set(qs.map((q) => q.method)), new Set(Object.keys(POC_METHODS)), 'every method appears');
    assert.deepEqual(qs.map((q) => q.parent).slice(2, 6), [null, 2, 3, 3]);
    assert.deepEqual(
      qs.map((q) => q.epoch),
      [0, 0, 0, 0, 0, 0, ...Array<number>(19).fill(1), 2],
    );
    const settle = qs[4];
    assert.ok(settle?.method === 'settle');
    assert.equal(settle.result.key, K_THUMB);
    assert.deepEqual(settle.result.far, [0x0800_0104]);
    assert.deepEqual(settle.result.reading.insns, [
      [0x0800_0100, 2],
      [0x0800_0102, 2],
      [0x0800_0104, 4],
    ]);
    assert.deepEqual(settle.result.reading.calls, [[0x0800_0200, 'thumb', 0x0800_0104]]);
    assert.deepEqual(settle.result.reading.tables, [[0x0800_0120, [0x0800_0100, 0x0800_0102]]]);
    assert.deepEqual(settle.result.reading.balance, [-4, 0]);
    const ahead = qs[18];
    assert.ok(ahead?.method === 'armAhead' && ahead.result !== null);
    assert.equal(ahead.result[0], 0);
    assert.equal(ahead.result[1].reading.mode, 'arm');
    const absorbed = qs[24];
    assert.ok(absorbed?.method === 'claim');
    assert.deepEqual(absorbed.result, { entry: 0x0800_0140, mode: 'thumb', origin: null, absorbed: true });
    const cands = qs[7];
    assert.ok(cands?.method === 'pointerCandidates');
    assert.deepEqual(cands.result, { pool: [0x0800_0100], data: [0x0800_0200, 0x0800_0300] });
    assert.equal(qs[10]?.result, 'decode error not_code at 8000300');
    assert.equal(qs[11]?.result, 0x150);
    assert.equal(qs[12]?.result, null);
  });
});

test('a malformed record is rejected with its file, line number and field', async () => {
  const cases: ReadonlyArray<readonly [(recs: Record<string, unknown>[]) => void, RegExp]> = [
    [
      (recs) => ((recs[1] as Record<string, unknown>)['method'] = 'fillGaps'),
      /queries\.ndjson:3\.method: "fillGaps" is not a recorded method/,
    ],
    [
      (recs) => ((recs[4] as Record<string, unknown>)['result'] = { reading: 'e'.repeat(64), far: [], noret: [] }),
      /queries\.ndjson:6\.result\.reading: no reading has the key e+/,
    ],
    [
      (recs) => ((recs[0] as Record<string, unknown>)['result'] = { reading: 'nope' }),
      /queries\.ndjson:2\.result\.reading: no reading has the key nope/,
    ],
    [
      (recs) => ((recs[7] as Record<string, unknown>)['parent'] = 3),
      /queries\.ndjson:9\.parent: 3 is not a call that is still running/,
    ],
    [(recs) => ((recs[7] as Record<string, unknown>)['epoch'] = 0), /queries\.ndjson:9\.epoch: is 0, expected 1/],
    [(recs) => ((recs[6] as Record<string, unknown>)['epoch'] = 2), /queries\.ndjson:8\.epoch: is 2, expected 1/],
    [(recs) => recs.splice(3, 1), /queries\.ndjson:5\.seq: is 4, expected 3/],
    [
      (recs) => ((recs[8] as Record<string, unknown>)['args'] = [0x0800_0100]),
      /queries\.ndjson:10\.args: expected 2 items/,
    ],
    [
      (recs) => ((recs[8] as Record<string, unknown>)['args'] = [0x0800_0100, 7]),
      /queries\.ndjson:10\.args\[1\]: expected a string/,
    ],
    [
      (recs) => ((recs[2] as Record<string, unknown>)['result'] = 1),
      /queries\.ndjson:4\.result: expected true or false/,
    ],
    [
      (recs) => ((recs[7] as Record<string, unknown>)['result'] = { pool: [2, 1], data: [] }),
      /queries\.ndjson:9\.result\.pool\[1\]: not above/,
    ],
    [(recs) => ((recs[6] as Record<string, unknown>)['result'] = 0), /queries\.ndjson:8\.result: expected null/],
  ];
  for (const [mutate, pattern] of cases) {
    await withTempDir('poc-log-', async (dir) => {
      const recs = records();
      mutate(recs);
      const path = await writeLog(dir, recs);
      await assert.rejects(collect(path), pattern, String(pattern));
    });
  }
});

test('a parent is the previous record or one of its ancestors, never a call a later top-level call closed', async () => {
  await withTempDir('poc-log-', async (dir) => {
    const recs = records();
    // seq 5 nests inside seq 4 (the previous record) instead of 3: still a well-formed tree.
    (recs[5] as Record<string, unknown>)['parent'] = 4;
    const qs = await collect(await writeLog(dir, recs));
    assert.deepEqual(
      qs.slice(2, 6).map((q) => q.parent),
      [null, 2, 3, 4],
    );
    // seq 17 nests in 16; seq 18 may go back to null, but seq 19 cannot then name 16.
    (recs[19] as Record<string, unknown>)['parent'] = 16;
    await assert.rejects(
      collect(await writeLog(dir, recs)),
      /queries\.ndjson:21\.parent: 16 is not a call that is still running at seq 19/,
    );
  });
});

test('readings: insnRuns expand, keys are verified, duplicates and bad fields are rejected with the line', async () => {
  assert.deepEqual(
    expandInsnRuns(
      [
        [0x100, 2, 3],
        [0x106, 4, 1],
      ],
      'r',
    ),
    [
      [0x100, 2],
      [0x102, 2],
      [0x104, 2],
      [0x106, 4],
    ],
  );
  assert.throws(
    () =>
      expandInsnRuns(
        [
          [0x100, 2, 2],
          [0x102, 2, 1],
        ],
        'r',
      ),
    /r\[1\]: starts at or before/,
  );
  await withTempDir('poc-log-', async (dir) => {
    const path = join(dir, 'readings.ndjson');
    const good = JSON.stringify({ key: K_ARM, reading: ARM });
    await writeFile(path, `${good}\n`);
    assert.equal((await readReadings(path)).get(K_ARM)?.insns.length, 2);
    await writeFile(path, `${good}\n${good}\n`);
    await assert.rejects(readReadings(path), /readings\.ndjson:2\.key: the reading [0-9a-f]+ is listed twice/);
    await writeFile(path, `${JSON.stringify({ key: K_THUMB, reading: ARM })}\n`);
    await assert.rejects(readReadings(path), /readings\.ndjson:1\.key: is not the sha256/);
    assert.equal((await readReadings(path, { verifyKeys: false })).size, 1);
    const bad = { ...ARM, mode: 'mips' };
    await writeFile(path, `${good}\n${JSON.stringify({ key: readingKey(bad), reading: bad })}\n`);
    await assert.rejects(readReadings(path), /readings\.ndjson:2\.reading\.mode: expected thumb or arm/);
    const extra = { ...ARM, insns: [] };
    await writeFile(path, `${JSON.stringify({ key: readingKey(extra), reading: extra })}\n`);
    await assert.rejects(readReadings(path), /readings\.ndjson:1\.reading\.insns: not a field of a reading/);
  });
});

test('the header is checked before any record', async () => {
  await withTempDir('poc-log-', async (dir) => {
    const path = join(dir, 'queries.ndjson');
    await writeFile(path, `${JSON.stringify({ ...HEADER, schema: 'other' })}\n`);
    await assert.rejects(openPocLog(path), /queries\.ndjson:1\.schema/);
    await writeFile(path, `${JSON.stringify({ ...HEADER, readings: '../elsewhere.ndjson' })}\n`);
    await assert.rejects(openPocLog(path), /queries\.ndjson:1\.readings: expected a file name beside the log/);
    await writeFile(path, '');
    await assert.rejects(openPocLog(path), /empty; expected the header/);
  });
});
