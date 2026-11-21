// The rows of a romlift run against the PoC baseline (g2.baseline-rows, g2.extents): every kind of
// diff, the accepted and the stale improvements, a regression that no listing accepts, the extents
// that stopped agreeing, and the whole path through `bench run --json` on the synthetic tier.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  type BaselineRow,
  compareWithBaseline,
  judgeDiffs,
  lostExtents,
  parseBaselineRow,
  rowDiffs,
} from '../../../bench/src/baseline-rows.ts';
import { type BenchIo, main } from '../../../bench/src/cli.ts';
import type { RomliftRow } from '../../../bench/src/row.ts';
import { fact, row, withTempDir } from './fixtures.ts';
import { syntheticTier, tinyDeps, tinyResult } from './harness.ts';

const BASE: BaselineRow = {
  name: 'tiny',
  tp: 10,
  misses: [
    { addr: '0x08000100', reason: 'inside-code' },
    { addr: '0x08000200', reason: 'unanchored' },
    { addr: '0x08000300', reason: 'not-dense' },
  ],
  falseEntries: [
    { addr: '0x08000400', origin: 'call', size: 8 },
    { addr: '0x08000500', origin: 'gap-scan', size: 4, owner: 'host' },
    { addr: '0x08000600', origin: 'call', size: 2 },
  ],
  mismatches: [
    { addr: '0x08000700', name: 'a', elf: 16, found: 4 },
    { addr: '0x08000800', name: 'b', elf: 16, found: 8 },
    { addr: '0x08000900', name: 'c', elf: 16, found: 8 },
    { addr: '0x08000A00', name: 'd', elf: 16, found: 8 },
  ],
};

const NOW = row({
  misses: [
    { addr: '0x08000200', name: 'm2', size: 4, reason: 'unanchored', listed: true, category: 'loop-label' },
    { addr: '0x08000300', name: 'm3', size: 4, reason: 'pops-frame', listed: true, category: 'loop-label' },
    { addr: '0x08000350', name: 'm4', size: 4, reason: 'inside-code', listed: false },
  ],
  falseEntries: [
    // Listing fields are the dataset's, not the analysis's: a changed category is no diff.
    { addr: '0x08000500', origin: 'gap-scan', size: 4, owner: 'host', listed: true, category: 'veneer' },
    { addr: '0x08000600', origin: 'call', size: 6, listed: true, category: 'veneer' },
    { addr: '0x08000650', origin: 'adr', size: 8, listed: false },
  ],
  extents: {
    sized: 10,
    agree: 7,
    mismatches: [
      { addr: '0x08000800', name: 'b', elf: 16, found: 8 },
      { addr: '0x08000900', name: 'c', elf: 16, found: 12 },
      { addr: '0x08000B00', name: 'e', elf: 32, found: 8 },
    ],
  },
});

// 0x08000700 is found and now agrees; 0x08000A00 is no longer found.
const FOUND = new Set(['0x08000700', '0x08000800', '0x08000900', '0x08000B00']);

test('rowDiffs names every row that moved, improvements and changes, by address', () => {
  assert.deepEqual(rowDiffs(BASE, NOW, FOUND), [
    { kind: 'miss-removed', addr: '0x08000100' },
    { kind: 'miss-changed', addr: '0x08000300' },
    { kind: 'miss-added', addr: '0x08000350' },
    { kind: 'false-entry-removed', addr: '0x08000400' },
    { kind: 'false-entry-changed', addr: '0x08000600' },
    { kind: 'false-entry-added', addr: '0x08000650' },
    { kind: 'extent-agrees', addr: '0x08000700' },
    { kind: 'extent-changed', addr: '0x08000900' },
    { kind: 'extent-unscored', addr: '0x08000A00' },
    { kind: 'extent-mismatch-added', addr: '0x08000B00' },
  ]);
  assert.deepEqual(
    rowDiffs(BASE, { misses: [], falseEntries: [], extents: { sized: 0, agree: 0, mismatches: [] } }, new Set()).length,
    10,
  );
});

test('an unchanged row has no diff', () => {
  const same = row({
    misses: BASE.misses.map((m) => ({
      addr: m.addr,
      name: 'x',
      size: 4,
      reason: m.reason as 'inside-code',
      listed: true,
      category: 'loop-label' as const,
    })),
    falseEntries: BASE.falseEntries.map((f) => ({
      addr: f.addr,
      origin: f.origin as 'call',
      size: f.size,
      ...(f.owner === undefined ? {} : { owner: f.owner }),
      listed: true,
      category: 'veneer' as const,
    })),
    extents: { sized: 4, agree: 0, mismatches: BASE.mismatches },
  });
  assert.deepEqual(rowDiffs(BASE, same, FOUND), []);
});

test('judgeDiffs: listed improvements are accepted, unlisted ones and every change are not, a listed one that no longer differs is stale', () => {
  const diffs = rowDiffs(BASE, NOW, FOUND);
  const judged = judgeDiffs(diffs, [
    { kind: 'miss-removed', addr: '0x08000100' },
    { kind: 'extent-agrees', addr: '0x08000700' },
    { kind: 'false-entry-removed', addr: '0x08000999' },
  ]);
  assert.deepEqual(judged.diffs, diffs);
  assert.deepEqual(
    judged.unaccepted.map((d) => d.kind),
    [
      'miss-changed',
      'miss-added',
      'false-entry-removed',
      'false-entry-changed',
      'false-entry-added',
      'extent-changed',
      'extent-unscored',
      'extent-mismatch-added',
    ],
  );
  assert.deepEqual(judged.staleAccepted, [{ kind: 'false-entry-removed', addr: '0x08000999' }]);
  // A change is never accepted, even when a listing names it.
  assert.deepEqual(
    judgeDiffs([{ kind: 'miss-added', addr: '0x08000350' }], [{ kind: 'miss-added', addr: '0x08000350' } as never])
      .unaccepted,
    [{ kind: 'miss-added', addr: '0x08000350' }],
  );
});

test('lostExtents: a mismatch now at a function the baseline neither missed nor mismatched', () => {
  assert.deepEqual(lostExtents(BASE, NOW), [{ addr: '0x08000B00', name: 'e', elf: 32, found: 8 }]);
  const missedBefore = { ...BASE, misses: [...BASE.misses, { addr: '0x08000B00', reason: 'inside-code' }] };
  assert.deepEqual(lostExtents(missedBefore, NOW), []);
  const c = compareWithBaseline(BASE, NOW, FOUND, []);
  assert.deepEqual(c.poc, { tp: 10 });
  assert.equal(c.lost.length, 1);
  assert.equal(c.baselineRows.unaccepted.length, 10);
});

test('parseBaselineRow reads the committed baseline shape and names a malformed field', () => {
  const parsed = parseBaselineRow(
    {
      name: 'tiny',
      tp: 3,
      misses: [{ addr: '0x08000100', name: 'x', size: 0, reason: 'inside-code', listed: true }],
      falseEntries: [{ addr: '0x08000200', origin: 'call', size: 2, owner: 'o', listed: true }],
      extents: { sized: 1, agree: 1, mismatches: [] },
    },
    'b.json',
  );
  assert.deepEqual(parsed, {
    name: 'tiny',
    tp: 3,
    misses: [{ addr: '0x08000100', reason: 'inside-code' }],
    falseEntries: [{ addr: '0x08000200', origin: 'call', size: 2, owner: 'o' }],
    mismatches: [],
  });
  assert.throws(
    () =>
      parseBaselineRow({ name: 'tiny', tp: 3, misses: 'x', falseEntries: [], extents: { mismatches: [] } }, 'b.json'),
    /b\.json: row tiny\.misses must be a list of objects/,
  );
});

async function runJson(
  cx: Parameters<typeof main>[1],
  deps: Parameters<typeof main>[3],
): Promise<{ readonly code: number; readonly rom: RomliftRow | undefined }> {
  const lines: string[] = [];
  const io: BenchIo = { out: (l) => lines.push(l), err: () => {} };
  const code = await main(['run', '--json'], cx, io, deps);
  return { code, rom: (JSON.parse(lines.at(-1) ?? '{}') as { roms?: RomliftRow[] }).roms?.[0] };
}

test('bench run --json: an improvement is unaccepted until accepted-diffs.json lists it, and stale once it no longer differs', async () => {
  await withTempDir('romlift-baseline-rows-', async (root) => {
    const cx = await syntheticTier(root);
    // The run now finds thumb_two, which the PoC missed.
    const better = tinyResult();
    const improved = {
      ...better,
      functions: [...better.functions, fact(0x0800_000e, 0x0800_0018)].sort((a, b) => a.entry - b.entry),
    };
    const first = await runJson(cx, tinyDeps(improved));
    assert.equal(first.code, 0);
    assert.deepEqual(first.rom?.baselineRows, {
      diffs: [{ kind: 'miss-removed', addr: '0x0800000E' }],
      unaccepted: [{ kind: 'miss-removed', addr: '0x0800000E' }],
      staleAccepted: [],
    });
    assert.equal(first.rom?.tp, 3);
    assert.deepEqual(first.rom?.poc, { tp: 2, source: 'baseline' });
    const accepted = {
      schema: 'romlift-bench/accepted-diffs@1',
      improvements: [
        {
          rom: 'tiny',
          kind: 'miss-removed',
          addr: '0x0800000E',
          commit: 'abc1234',
          reason: 'the gap rule now takes it',
        },
      ],
    };
    await writeFile(join(cx.repoRoot, 'bench', 'baseline', 'accepted-diffs.json'), JSON.stringify(accepted));
    assert.deepEqual((await runJson(cx, tinyDeps(improved))).rom?.baselineRows.unaccepted, []);
    // Back to the PoC's rows: the listed improvement is stale.
    assert.deepEqual((await runJson(cx, tinyDeps())).rom?.baselineRows, {
      diffs: [],
      unaccepted: [],
      staleAccepted: [{ kind: 'miss-removed', addr: '0x0800000E' }],
    });
    // A regression: the run drops a true positive; it is a change no listing can accept.
    const worse = await runJson(
      cx,
      tinyDeps(tinyResult([0x0800_0018]), {
        reasons: new Map([
          [0x0800_000e, 'unanchored'],
          [0x0800_0018, 'unanchored'],
        ]),
      }),
    );
    assert.deepEqual(worse.rom?.baselineRows.unaccepted, [{ kind: 'miss-added', addr: '0x08000018' }]);
    // A non-improvement in the file is refused before any run.
    await writeFile(
      join(cx.repoRoot, 'bench', 'baseline', 'accepted-diffs.json'),
      JSON.stringify({ ...accepted, improvements: [{ ...accepted.improvements[0], kind: 'miss-added' }] }),
    );
    assert.equal((await runJson(cx, tinyDeps())).code, 1);
  });
});

test("pocReference: the baseline row; for a revealed ROM without one, the PoC dump's own row (D60); else none", async () => {
  const { pocReference } = await import('../../../bench/src/run.ts');
  const { dataset } = await import('./fixtures.ts');
  const row = { name: 'tiny', tp: 2 };
  const tc = {
    baseline: { meta: {}, roms: [row] },
    accepted: { schema: 'romlift-bench/accepted-diffs@1', improvements: [] },
    pinnedPocDigest: '',
  } as const;
  const dumpRow = { name: 'tmc', tp: 7 };
  assert.deepEqual(pocReference(tc, dataset(), dumpRow), { record: row, source: 'baseline' });
  const revealed = dataset({ name: 'tmc', heldout: true, revealed: [{ at: 'now', commit: 'c', reason: 'r' }] });
  assert.deepEqual(pocReference(tc, revealed, dumpRow), { record: dumpRow, source: 'dump' });
  assert.equal(pocReference(tc, revealed, undefined), undefined, 'no dump: no reference, never a vacuous 0');
  assert.equal(
    pocReference(tc, dataset({ name: 'other' }), dumpRow),
    undefined,
    'a tuning ROM never revealed has the baseline or nothing',
  );
});
