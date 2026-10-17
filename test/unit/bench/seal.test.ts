import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FoundFunction } from '../../../bench/src/classify.ts';
import { contextFromEnv } from '../../../bench/src/context.ts';
import { isSealed, loadDatasets, parseDataset } from '../../../bench/src/dataset.ts';
import {
  adoptRefusal,
  appendReveal,
  assertCountsOnly,
  FAMILY_WAIVER,
  heldOutVerdict,
  sealedCounts,
  sealedDataset,
  sealedPasses,
  type SealedCounts,
  type SealedInput,
} from '../../../bench/src/seal.ts';
import { dataset } from './fixtures.ts';

function fn(entry: number, end: number, overrides: Partial<FoundFunction> = {}): FoundFunction {
  return { entry, mode: 'thumb', extent: { start: entry, end }, holes: [], branchTargets: [], noReturnSites: [], origin: 'call', ...overrides };
}

const t = (addr: number, size: number): { addr: number; size: number; thumb: boolean } => ({ addr, size, thumb: true });

// Startup ends at 0x08000100. ELF: a startup function, then A (0x100, 0x40), B (0x140, 0x20; the found
// extent 0x1E agrees by padding), L (0x150, a label inside B), F (0x180, 0x80), G (0x200, glued into F)
// and an unsized H (0x300). Found: the startup piece and a false startup entry, A, B, F (running over G),
// H, and four false entries: a veneer, an adr callback, one inside A and one elsewhere.
const INPUT: SealedInput = {
  name: 'sealed-fixture',
  found: [
    fn(0x08000000, 0x08000080),
    fn(0x08000090, 0x080000A0, { origin: 'gap-scan' }),
    fn(0x08000100, 0x08000140),
    fn(0x08000140, 0x0800015E, { branchTargets: [0x08000150] }),
    fn(0x08000180, 0x08000280),
    fn(0x08000300, 0x08000310),
    fn(0x08000400, 0x08000408, { origin: 'veneer' }),
    fn(0x08000410, 0x08000420, { origin: 'adr' }),
    fn(0x08000120, 0x08000130, { origin: 'gap-scan' }),
    fn(0x08000500, 0x08000510, { origin: 'gap-scan' }),
  ],
  truth: [t(0x08000000, 0x80), t(0x08000100, 0x40), t(0x08000140, 0x20), t(0x08000150, 0x10), t(0x08000180, 0x80), t(0x08000200, 0x80), t(0x08000300, 0)],
  startupEnd: 0x08000100,
  isPrologue: (addr) => addr === 0x08000200,
  codeEnd: 0x08000290,
};

test('sealedCounts counts from the end of the startup region and classifies every miss and false entry', () => {
  const counts = sealedCounts(INPUT);
  assert.deepEqual(counts, {
    name: 'sealed-fixture',
    entries: 8,
    elfFunctions: 6,
    tp: 4,
    glued: 1,
    gluedWhere: { insideExtent: 1, outsideExtents: 0, pastCodeEnd: 0 },
    labelCandidates: 1,
    falseEntries: { startup: 1, veneer: 1, adrCallback: 1, insideElfFunction: 1, other: 1 },
    // A agrees exactly, B by padding, F's 0x100 bytes do not agree with 0x80; H is unsized.
    extents: { sized: 3, agree: 2 },
    codeEnd: { delta: 0x08000290 - 0x08000300 },
  });
  assert.doesNotThrow(() => assertCountsOnly(counts));
  const f = counts.falseEntries;
  assert.equal(f.veneer + f.adrCallback + f.insideElfFunction + (f.other ?? 0), counts.entries - counts.tp, 'the non-startup classes are every false entry that counts against precision');
});

test('the glued misses split by where they lie: inside a found extent, in no extent below the code end, past the code end', () => {
  const counts = sealedCounts({
    ...INPUT,
    truth: [...INPUT.truth, t(0x08000288, 4), t(0x08000600, 0x10)],
  });
  assert.equal(counts.glued, 3);
  assert.deepEqual(counts.gluedWhere, { insideExtent: 1, outsideExtents: 1, pastCodeEnd: 1 });
  const g = counts.gluedWhere;
  assert.equal((g?.insideExtent ?? 0) + (g?.outsideExtents ?? 0) + (g?.pastCodeEnd ?? 0), counts.glued);
});

test('a glued miss inside a false entry\'s extent is not a glued split: only extents of found functions with an ELF entry count, as for labels', () => {
  // 0x08000508 lies inside the false entry 0x08000500..0x08000510, below the code end.
  const counts = sealedCounts({ ...INPUT, truth: [...INPUT.truth, t(0x08000508, 4)], codeEnd: 0x08000600 });
  assert.equal(counts.glued, 2);
  assert.deepEqual(counts.gluedWhere, { insideExtent: 1, outsideExtents: 1, pastCodeEnd: 0 });
});

test('a sealed entry has exactly the shape g2.held-out reads and nothing its leak check rejects', () => {
  const counts = sealedCounts(INPUT);
  assert.deepEqual(Object.keys(counts), ['name', 'entries', 'elfFunctions', 'tp', 'glued', 'gluedWhere', 'labelCandidates', 'falseEntries', 'extents', 'codeEnd']);
  assert.deepEqual(Object.keys(counts.falseEntries), ['startup', 'veneer', 'adrCallback', 'insideElfFunction', 'other']);
  const leak = /0x[0-9a-f]{5,}|"(addr|addrs|names|symbol|symbols|misses|rows|labels|untyped)"\s*:/i;
  assert.doesNotMatch(JSON.stringify(counts), leak);
});

function passing(overrides: Partial<SealedCounts> = {}): SealedCounts {
  return {
    name: 'r',
    entries: 1000,
    elfFunctions: 1000,
    tp: 1000,
    glued: 0,
    labelCandidates: 0,
    falseEntries: { startup: 0, veneer: 0, adrCallback: 0, insideElfFunction: 0 },
    extents: { sized: 1000, agree: 1000 },
    codeEnd: { delta: 0 },
    ...overrides,
  };
}

test('sealedPasses: each threshold passes at its boundary and fails one step past it', () => {
  assert.deepEqual(sealedPasses(passing()), { pass: true, failures: [] });
  assert.equal(sealedPasses(passing({ entries: 1000, tp: 997, elfFunctions: 997 })).pass, true);
  assert.deepEqual(sealedPasses(passing({ entries: 1000, tp: 996, elfFunctions: 996 })).failures, ['precision']);
  assert.equal(sealedPasses(passing({ entries: 4973, tp: 4973, elfFunctions: 5000 })).pass, true);
  assert.deepEqual(sealedPasses(passing({ entries: 4972, tp: 4972, elfFunctions: 5000 })).failures, ['recall']);
  assert.deepEqual(sealedPasses(passing({ glued: 1 })).failures, ['glued']);
  assert.equal(sealedPasses(passing({ labelCandidates: 11 })).pass, true);
  assert.deepEqual(sealedPasses(passing({ labelCandidates: 12 })).failures, ['label-candidates']);
  assert.equal(sealedPasses(passing({ extents: { sized: 1000, agree: 999 } })).pass, true);
  assert.deepEqual(sealedPasses(passing({ extents: { sized: 1000, agree: 998 } })).failures, ['extents']);
  for (const delta of [16, -16]) assert.equal(sealedPasses(passing({ codeEnd: { delta } })).pass, true);
  for (const delta of [17, -17]) assert.deepEqual(sealedPasses(passing({ codeEnd: { delta } })).failures, ['code-end']);
});

test('sealedPasses: an empty run fails rather than dividing by zero', () => {
  const empty = passing({ entries: 0, elfFunctions: 0, tp: 0, extents: { sized: 0, agree: 0 } });
  assert.deepEqual(sealedPasses(empty).failures, ['precision', 'recall', 'extents']);
});

const TUNING = ['fe-gba', 'kleod', 'pret-gen3', 'sat-r'];

test('heldOutVerdict: two passing pret-gen3 siblings do not pass the gate', () => {
  const v = heldOutVerdict(
    [
      { name: 'pokefirered', family: 'pret-gen3', pass: true },
      { name: 'pokeruby', family: 'pret-gen3', pass: true },
      { name: 'tmc', family: 'zeldaret-tmc', pass: false },
    ],
    TUNING,
  );
  assert.equal(v.pass, false);
  assert.deepEqual(v.families, ['pret-gen3']);
  assert.deepEqual(v.freshFamilies, []);
  assert.equal(v.problems.length, 2);
});

test('heldOutVerdict: pret-gen3 and zeldaret-tmc passing pass the gate', () => {
  const v = heldOutVerdict(
    [
      { name: 'pokefirered', family: 'pret-gen3', pass: true },
      { name: 'pokeruby', family: 'pret-gen3', pass: false },
      { name: 'tmc', family: 'zeldaret-tmc', pass: true },
    ],
    TUNING,
  );
  assert.deepEqual(v, { pass: true, passing: ['pokefirered', 'tmc'], families: ['pret-gen3', 'zeldaret-tmc'], freshFamilies: ['zeldaret-tmc'], problems: [] });
});

test('heldOutVerdict with the owner waiver (D60): two passing pret-gen3 siblings pass, the family conditions reported as waived', () => {
  const sealed = [
    { name: 'pokefirered', family: 'pret-gen3', pass: true },
    { name: 'pokeruby', family: 'pret-gen3', pass: true },
  ];
  const v = heldOutVerdict(sealed, [...TUNING, 'zeldaret-tmc'], FAMILY_WAIVER);
  assert.equal(v.pass, true);
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.waived, [
    'the passing ROMs span 1 codebase families, at least two must: waived by the owner, Bruno Macabeus (architecture section 12 item 4) on 2026-10-17 (D60)',
    'no passing ROM is from a family absent from the tuning set: waived by the owner, Bruno Macabeus (architecture section 12 item 4) on 2026-10-17 (D60)',
  ]);
  // The waiver never covers a ROM that fails, or fewer than two passing ROMs.
  const one = heldOutVerdict([sealed[0]!, { ...sealed[1]!, pass: false }], [...TUNING, 'zeldaret-tmc'], FAMILY_WAIVER);
  assert.deepEqual(one.problems, ['1 of 2 sealed ROMs pass, at least two must']);
  // A sealed ROM of a family absent from the tuning set ends the waiver: the full rule applies again.
  const fresh = heldOutVerdict([...sealed, { name: 'kirby', family: 'kirby-am', pass: false }], [...TUNING, 'zeldaret-tmc'], FAMILY_WAIVER);
  assert.equal(fresh.pass, false);
  assert.equal(fresh.waived, undefined);
  assert.equal(fresh.problems.length, 2);
});

test('heldOutVerdict: one pass, or two families both in the tuning set, fail', () => {
  assert.equal(heldOutVerdict([{ name: 'tmc', family: 'zeldaret-tmc', pass: true }], TUNING).pass, false);
  const v = heldOutVerdict(
    [
      { name: 'a', family: 'pret-gen3', pass: true },
      { name: 'b', family: 'sat-r', pass: true },
    ],
    TUNING,
  );
  assert.deepEqual(v.problems, ['no passing ROM is from a family absent from the tuning set']);
});

test('assertCountsOnly rejects an address string, a name, a row list and an address-sized number, without echoing the value', () => {
  const counts = passing();
  assert.throws(() => assertCountsOnly({ ...counts, codeEnd: { delta: 0, found: '0x08123456' } }), (e: Error) => /codeEnd\.found/.test(e.message) && !e.message.includes('0x08123456'));
  assert.throws(() => assertCountsOnly({ ...counts, worst: 'sub_08001234' }), /worst/);
  assert.throws(() => assertCountsOnly({ ...counts, falseEntries: { ...counts.falseEntries, name: 'x' } }), /falseEntries\.name/);
  assert.throws(() => assertCountsOnly({ ...counts, misses: [] }), /misses/);
  assert.throws(() => assertCountsOnly({ ...counts, codeEnd: { delta: 0x08000000 } }), /codeEnd\.delta/);
  assert.throws(() => assertCountsOnly({ entries: 1 }), /name/);
  assert.throws(() => assertCountsOnly([counts]));
  assert.doesNotThrow(() => assertCountsOnly({ ...counts, pass: true }));
});

test('appendReveal appends and never rewrites an earlier entry', () => {
  const first = { at: '2026-10-17T00:00:00.000Z', commit: 'abc1234', reason: 'first' };
  const sealed = dataset({ name: 'held', heldout: true });
  const once = appendReveal(sealed, first);
  assert.deepEqual(sealed.revealed, []);
  assert.equal(isSealed(once), false);
  const twice = appendReveal(once, { at: '2026-10-18T00:00:00.000Z', commit: 'def5678', reason: 'second' });
  assert.equal(twice.revealed.length, 2);
  assert.equal(twice.revealed[0], once.revealed[0]);
  assert.deepEqual(twice.revealed[0], first);
  assert.deepEqual(once.revealed, [first]);
  assert.deepEqual(Object.keys(twice), Object.keys(sealed));
  assert.deepEqual({ ...twice, revealed: [] }, sealed);
});

test('appendReveal refuses a tuning dataset and an empty field', () => {
  assert.throws(() => appendReveal(dataset(), { at: 'a', commit: 'c', reason: 'r' }), /not a held-out dataset/);
  assert.throws(() => appendReveal(dataset({ heldout: true }), { at: 'a', commit: 'c', reason: ' ' }), /reason/);
});

test('adoptRefusal refuses a sealed dataset only', () => {
  assert.match(adoptRefusal(dataset({ name: 'held', heldout: true })) ?? '', /held is sealed/);
  assert.equal(adoptRefusal(dataset({ heldout: true, revealed: [{ at: 'a', commit: 'c', reason: 'r' }] })), undefined);
  assert.equal(adoptRefusal(dataset()), undefined);
});

test('sealedDataset is a well-formed sealed dataset with the committed key order', () => {
  const d = sealedDataset({ name: 'x', rom: 'x/x.gba', elf: 'x/x.elf', map: 'x/x.map', sha1: 'a'.repeat(40), elfCommit: 'abc1234', elfSha256: 'b'.repeat(64), family: 'f', buildNote: 'unchanged' });
  assert.deepEqual(Object.keys(d), ['name', 'rom', 'elf', 'map', 'sha1', 'elfCommit', 'elfSha256', 'family', 'buildNote', 'heldout', 'revealed', 'labels', 'untyped']);
  assert.ok(isSealed(d));
  assert.deepEqual(parseDataset(d, 'x.json'), { dataset: d, problems: [] });
});

test('the committed held-out datasets are sealed, listless and recorded with their families; tmc is revealed', async () => {
  const { datasets, problems } = await loadDatasets(contextFromEnv({}));
  assert.deepEqual(problems, []);
  const sealed = datasets.filter(isSealed).map((d) => [d.name, d.family, d.labels.length + d.untyped.length]);
  assert.deepEqual(sealed, [
    ['pokefirered', 'pret-gen3', 0],
    ['pokeruby', 'pret-gen3', 0],
  ]);
  // The owner decision of 17 October 2026 (D60): tmc is held out by creation and tuning data by its reveal.
  const tmc = datasets.find((d) => d.name === 'tmc');
  assert.ok(tmc !== undefined && tmc.heldout && tmc.revealed.length === 1 && !isSealed(tmc));
});
