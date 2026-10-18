// bench/src/readability.ts: the shares (each 1 over an empty denominator), the statistics summed over the
// chunks that hold code of a committed fixture's discover model, the tree digest as g3.tree-determinism
// computes it, and the floor file: its schema, and floors that are only ever added, never changed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { addPrintStats, buildModel, configFromDiscover, discover, emitTree, emptyPrintStats, printChunk, profileById, type PrintStats } from 'romlift';

import { BenchError } from '../../../../bench/src/files.ts';
import {
  addFloors,
  parseReadabilityFloors,
  READABILITY_FLOOR_SCHEMA,
  readabilityFloorPath,
  readabilityMember,
  readableStats,
  readReadabilityFloors,
  sharesOf,
  treePass,
  writeReadabilityFloors,
} from '../../../../bench/src/readability.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../../helpers/fixtures.ts';
import { withTempDir } from '../fixtures.ts';

const stats = (s: Partial<PrintStats>): PrintStats => ({ ...emptyPrintStats(), ...s });

test('the shares: 1 - raw/insns, symbolic branches and pool loads over their totals, 1 over an empty denominator', () => {
  assert.deepEqual(sharesOf(stats({ insns: 10, rawInsns: 1, branches: 4, symbolicBranches: 3, poolLoads: 8, symbolicPoolLoads: 2 })), {
    mnemonicShare: 0.9,
    symbolicBranchShare: 0.75,
    symbolicPoolShare: 0.25,
  });
  assert.deepEqual(sharesOf(emptyPrintStats()), { mnemonicShare: 1, symbolicBranchShare: 1, symbolicPoolShare: 1 });
  assert.deepEqual(sharesOf(stats({ insns: 4, rawInsns: 4 })), { mnemonicShare: 0, symbolicBranchShare: 1, symbolicPoolShare: 1 });
});

test('readabilityMember carries the floor, or null when the ROM has none', () => {
  const shares = { mnemonicShare: 0.5, symbolicBranchShare: 1, symbolicPoolShare: 1 };
  assert.deepEqual(readabilityMember(shares, undefined), { ...shares, floor: null });
  assert.deepEqual(readabilityMember(shares, { ...shares, mnemonicShare: 0.25 }), { ...shares, floor: { ...shares, mnemonicShare: 0.25 } });
});

const profile = profileById('agbcc');
if (profile === undefined) throw new Error('the agbcc profile is not registered');

for (const name of ['far-jump', 'arm-pools-in-front', 'large-data-referenced']) {
  test(`${name}: the statistics are every code chunk's, the tree digest is g3.tree-determinism's`, () => {
    const fixture = listSyntheticFixtures().find((f) => f.name === name);
    assert.ok(fixture !== undefined, name);
    const rom = readFixtureRom(fixture);
    const analysis = discover(rom, { profile });
    const model = buildModel(rom, analysis, configFromDiscover(rom, analysis));
    let all = emptyPrintStats();
    model.chunks.forEach((_, i) => {
      all = addPrintStats(all, printChunk(rom, model, i, 'readable').stats);
    });
    // Leaving out the header and data chunks leaves out no instruction.
    assert.deepEqual(readableStats(rom, model), all);
    assert.ok(all.insns > 0);

    const hash = createHash('sha256');
    const paths: string[] = [];
    for (const entry of emitTree(rom, model, { decomp: { defined: new Set() } })) {
      hash.update(`${entry.path}\0${entry.ownership === 'reconciled' ? JSON.stringify(entry.edits) : entry.text}\0`);
      paths.push(entry.path);
    }
    assert.deepEqual(treePass(emitTree(rom, model, { decomp: { defined: new Set() } })), { paths, treeDigest: hash.digest('hex') });
  });
}

test('treePass hashes a reconciled entry by its edits', () => {
  const pass = treePass([{ ownership: 'reconciled', path: 'src/a.c', baseSha1: 'x', edits: [{ start: 0, end: 1, text: 'y', reason: 'rename' }] }]);
  const expected = createHash('sha256').update(`src/a.c\0${JSON.stringify([{ start: 0, end: 1, text: 'y', reason: 'rename' }])}\0`).digest('hex');
  assert.deepEqual(pass, { paths: ['src/a.c'], treeDigest: expected });
});

const SHARES = { mnemonicShare: 0.99, symbolicBranchShare: 1, symbolicPoolShare: 0.98 };

test('the floor file: its schema, every share in [0, 1], ROMs sorted by name', () => {
  const floors = parseReadabilityFloors({ schema: READABILITY_FLOOR_SCHEMA, roms: { sa2: SHARES, klonoa: SHARES } }, 'f');
  assert.deepEqual(Object.keys(floors.roms), ['klonoa', 'sa2']);
  assert.throws(() => parseReadabilityFloors({ schema: 'other', roms: {} }, 'f'), BenchError);
  assert.throws(() => parseReadabilityFloors({ schema: READABILITY_FLOOR_SCHEMA, roms: { sa2: { ...SHARES, mnemonicShare: 1.5 } } }, 'f'), /mnemonicShare must be a number in \[0, 1\]/);
  assert.throws(() => parseReadabilityFloors({ schema: READABILITY_FLOOR_SCHEMA, roms: { sa2: { mnemonicShare: 1 } } }, 'f'), /symbolicBranchShare/);
});

test('addFloors adds the ROMs without a floor and never changes, lowers or raises an existing one', () => {
  const first = addFloors(undefined, { sa2: SHARES, klonoa: SHARES });
  assert.deepEqual(first.added, ['klonoa', 'sa2']);
  assert.deepEqual(first.kept, []);
  const lower = { mnemonicShare: 0.5, symbolicBranchShare: 0.5, symbolicPoolShare: 0.5 };
  const second = addFloors(first.floors, { sa2: lower, tmc: lower });
  assert.deepEqual(second.added, ['tmc']);
  assert.deepEqual(second.kept, ['sa2']);
  assert.deepEqual(second.floors.roms, { klonoa: SHARES, sa2: SHARES, tmc: lower });
});

test('the floor file is read when committed and written as two-space JSON', async () => {
  await withTempDir('romlift-floor-', async (root) => {
    const cx = { repoRoot: root, benchRoot: root, pocRoot: root };
    assert.equal(await readReadabilityFloors(cx), undefined);
    await mkdir(join(root, 'bench', 'baseline'), { recursive: true });
    await writeReadabilityFloors(cx, addFloors(undefined, { sa2: SHARES }).floors);
    const text = await readFile(readabilityFloorPath(cx), 'utf8');
    assert.ok(text.startsWith(`{\n  "schema": "${READABILITY_FLOOR_SCHEMA}"`));
    assert.deepEqual(await readReadabilityFloors(cx), { schema: READABILITY_FLOOR_SCHEMA, roms: { sa2: SHARES } });
    await writeFile(readabilityFloorPath(cx), '{"schema": "x"}');
    await assert.rejects(readReadabilityFloors(cx), BenchError);
  });
});
