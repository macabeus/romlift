// Confirm mode: the listed entries are functions from round 0; a listed entry whose seed asks for validation
// and fails validity is kept and reported, one that does not ask is taken unchecked; a discovery beyond the
// list is reported and claims nothing; extents are cut.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyze, runAnalysis } from '../../../../src/core/analysis/driver/run.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import { romFromBytes } from '../../../../src/foundation/rom/rom.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { OverrideFact, Seed } from '../../../../src/core/analysis/types.ts';
import { compareOverrides, compareSeeds } from '../../../../src/core/analysis/driver/confirm.ts';
import { fakeRule, registry, romWith, testProfile, tuningFor, words } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { calls, decodes, extent, inRom, listed, walk } from './fakes.ts';

const A = 0x0800_0200;
const B = 0x0800_0240;
const C = 0x0800_0280;

function run(seeds: readonly Seed[]) {
  const rom = romWith([
    { at: A, bytes: thumbAt(A)`ldr r0, _08000204; bx lr` },
    { at: A + 4, bytes: words(0x1234) },
    { at: B, bytes: thumbAt(B)`push {lr}; bl _08000280; pop {pc}` },
    { at: C, bytes: thumbAt(C)`bx lr` },
  ]);
  const badB = fakeRule('valid.dense', { kind: 'valid', reason: 'not-dense', intrinsic: true, check: (r) => (r.entry === B ? 'holes by construction' : undefined) });
  const profile = testProfile({
    seed: ['seed.listed'],
    queue: ['seed.call'],
    validity: ['valid.in-rom-unclaimed', 'valid.decodes', 'valid.dense'],
    claim: ['claim.adjacent-pools'],
    walk: walk.map((w) => w.meta.id),
  });
  const reg = registry(listed, calls, inRom, decodes, badB, extent, ...walk);
  return runAnalysis(rom, profile, { mode: 'confirm', seeds, overrides: [], trail: 'off' }, tuningFor(profile, reg), reg);
}

const seed = (entry: number, extra: Partial<Seed> = {}): Seed => ({ entry, mode: 'thumb', rule: 'seed.listed', ...extra });

test('listed entries are the functions; an unlisted callee is reported and claims nothing', () => {
  const result = run([seed(A), seed(B, { validate: true })]);
  assert.equal(result.mode, 'confirm');
  if (result.mode !== 'confirm') return;
  assert.deepEqual(result.functions.map((f) => [f.entry, f.origin]), [
    [A, 'listed'],
    [B, 'listed'],
  ]);
  assert.deepEqual(result.unlisted.map((u) => [u.entry, u.origin, u.provenance.rule]), [[C, 'call', 'seed.call']]);
  assert.equal(result.claims.some((c) => c.span.start <= C && C < c.span.end && c.kind !== Claim.free), false, 'the unlisted function claims nothing');
  assert.deepEqual(result.listedInvalid.map((l) => [l.entry, l.rejection.rule, l.rejection.reason]), [[B, 'valid.dense', 'not-dense']]);
  assert.deepEqual(result.diagnostics.map((d) => [d.code, d.addr]).sort((x, y) => (x[0]! < y[0]! ? -1 : 1)), [
    ['W_LISTED_INVALID', B],
    ['W_UNLISTED_FUNCTION', C],
  ]);
});

test('a listed entry without validate is taken unchecked: no W_LISTED_INVALID, no listedInvalid row, still listed', () => {
  const unchecked = run([seed(A), seed(B)]);
  const checked = run([seed(A), seed(B, { validate: true })]);
  assert.equal(unchecked.mode, 'confirm');
  assert.equal(checked.mode, 'confirm');
  if (unchecked.mode !== 'confirm' || checked.mode !== 'confirm') return;
  assert.deepEqual(unchecked.listedInvalid, []);
  assert.deepEqual(unchecked.diagnostics.map((d) => [d.code, d.addr]), [['W_UNLISTED_FUNCTION', C]]);
  assert.deepEqual(unchecked.functions.map((f) => [f.entry, f.origin]), [
    [A, 'listed'],
    [B, 'listed'],
  ]);
  // Only the check's own record differs: functions, claims, rejections and the unlisted finding are the same.
  assert.deepEqual(unchecked.functions, checked.functions);
  assert.deepEqual(unchecked.claims, checked.claims);
  assert.deepEqual(unchecked.rejections, checked.rejections);
  assert.deepEqual(unchecked.unlisted, checked.unlisted);
  assert.deepEqual(checked.listedInvalid.map((l) => [l.entry, l.rejection.rule]), [[B, 'valid.dense']]);
  assert.deepEqual(checked.diagnostics.map((d) => d.code).filter((c) => c === 'W_LISTED_INVALID'), ['W_LISTED_INVALID']);
});

test('an extent is the listed size, else the reading cut at the next listed entry that is not a label', () => {
  const result = run([seed(A), seed(A + 4, { label: true }), seed(B, { size: 4 })]);
  const extent = (entry: number): number | undefined => {
    const f = result.functions.find((x) => x.entry === entry);
    return f === undefined ? undefined : f.extent.end - f.entry;
  };
  assert.equal(extent(A), 8, 'a label does not cut its function');
  assert.equal(extent(B), 4, 'the listed size');
  const cut = run([seed(A), seed(A + 4)]);
  assert.equal(cut.functions.find((f) => f.entry === A)?.extent.end, A + 4, 'cut at the next listed entry');
});

test('discover mode lists nothing and accepts what the rules accept', () => {
  const rom = romWith([{ at: A, bytes: thumbAt(A)`bx lr` }]);
  const profile = testProfile({ seed: ['seed.listed'] });
  const reg = registry(listed);
  const result = runAnalysis(rom, profile, { mode: 'discover', seeds: [seed(A)], overrides: [], trail: 'off' }, tuningFor(profile, reg), reg);
  assert.equal(result.mode, 'discover');
  assert.deepEqual(result.functions.map((f) => f.entry), [A]);
  assert.equal('unlisted' in result, false);
});

test('a label is no walk boundary: the function around it reads through it, as discover read it', () => {
  const rom = romWith([{ at: A, bytes: thumbAt(A)`movs r0, #1; adds r0, #1; bx lr` }]);
  const profile = testProfile({ seed: ['seed.listed'], validity: ['valid.in-rom-unclaimed', 'valid.decodes'], claim: ['claim.adjacent-pools'], walk: walk.map((w) => w.meta.id) });
  const reg = registry(listed, inRom, decodes, extent, ...walk);
  const confirm = (seeds: readonly Seed[]) => runAnalysis(rom, profile, { mode: 'confirm', seeds, overrides: [], trail: 'off' }, tuningFor(profile, reg), reg);
  const ends = (seeds: readonly Seed[]): number[] => confirm(seeds).functions.map((f) => f.extent.end - f.entry);
  // A + 2 is a second entry inside A: as a label, A's walk passes it; as a function, A stops there.
  assert.deepEqual(ends([seed(A), seed(A + 2, { label: true })]), [6, 4]);
  assert.deepEqual(ends([seed(A), seed(A + 2)]), [2, 4]);
});

test('compareSeeds is a total order: entry, Thumb first, rule, name, size, label, then validate', () => {
  const base: Seed = { entry: A, mode: 'thumb', rule: 'seed.listed' };
  const ordered: readonly Seed[] = [
    base,
    { ...base, name: 'a' },
    { ...base, name: 'b' },
    { ...base, name: 'b', size: 4 },
    { ...base, name: 'b', size: 8 },
    { ...base, name: 'b', size: 8, label: true },
    { ...base, name: 'b', size: 8, label: true, validate: true },
    { ...base, rule: 'seed.override' },
    { ...base, mode: 'arm' },
    { ...base, entry: B },
  ];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) {
      const c = compareSeeds(ordered[i] as Seed, ordered[j] as Seed);
      assert.equal(Math.sign(c), Math.sign(i - j), `${i} vs ${j}`);
    }
  }
});

test('compareOverrides is a total order: span, kind, mode, then run address', () => {
  const base: OverrideFact = { span: { start: A, end: A + 4 }, kind: 'code' };
  const ordered: readonly OverrideFact[] = [
    base,
    { ...base, mode: 'arm' },
    { ...base, mode: 'thumb' },
    { ...base, mode: 'thumb', runsAt: 0x0300_0000 },
    { ...base, kind: 'data' },
    { ...base, span: { start: A, end: A + 8 } },
    { ...base, span: { start: B, end: B + 4 } },
  ];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) assert.equal(Math.sign(compareOverrides(ordered[i] as OverrideFact, ordered[j] as OverrideFact)), Math.sign(i - j), `${i} vs ${j}`);
  }
});

test('confirm on a fixture with one listed function deleted reaches its fixpoint: the unlisted callee and the tiled hole after it are reported once each', () => {
  // The edit g4.toml-mutations makes. Before fix round 2 the unlisted hole head counted as an added
  // function in every fillGaps call, and the impatient pass ran to W_FIXPOINT_LIMIT (10,000 rounds).
  const file = fileURLToPath(new URL('../../../../bench/dataset/synthetic/adr-handler-block/build/adr-handler-block.gba', import.meta.url));
  const rom = romFromBytes(new Uint8Array(readFileSync(file)), 'adr-handler-block');
  const options = { mode: 'discover' as const, seeds: [], overrides: [], trail: 'off' as const };
  const discovered = analyze(rom, AGBCC, options);
  const omitted = 0x0800_0104;
  assert.ok(discovered.functions.some((f) => f.entry === omitted));
  const seeds: Seed[] = discovered.functions.filter((f) => f.entry !== omitted).map((f) => ({ entry: f.entry, mode: f.mode, rule: 'seed.listed' }));
  const confirmed = analyze(rom, AGBCC, { ...options, mode: 'confirm', seeds });
  assert.deepEqual(confirmed.diagnostics.filter((d) => d.code === 'W_FIXPOINT_LIMIT'), []);
  assert.deepEqual(
    confirmed.diagnostics.map((d) => [d.code, d.addr]),
    [
      ['W_UNLISTED_FUNCTION', omitted],
      ['W_UNLISTED_FUNCTION', 0x0800_0118],
    ],
  );
});

test('a malformed seed is left out before round 0 with W_SEED_MALFORMED; the run neither hangs nor makes an extent that misses its entry', () => {
  const malformed: readonly Seed[] = [
    seed(Number.NaN),
    seed(1.5),
    seed(A, { size: -8 }),
    seed(A, { size: 0 }),
    seed(A, { size: 0.5 }),
    seed(A, { size: 0x400_0000 }),
  ];
  for (const bad of malformed) {
    const result = run([bad, seed(B)]);
    assert.deepEqual(
      result.diagnostics.filter((d) => d.code === 'W_SEED_MALFORMED').map((d) => d.rule),
      ['seed.listed'],
      `${String(bad.entry)} size ${String(bad.size)}`,
    );
    assert.equal(result.options.seeds.length, 1, 'the result records only the seeds the run used');
    for (const f of result.functions) assert.ok(f.extent.start <= f.entry && f.entry < f.extent.end, `${f.entry} lies in its extent`);
  }
  const fits = run([seed(A, { size: 8 }), seed(B)]);
  assert.equal(fits.diagnostics.some((d) => d.code === 'W_SEED_MALFORMED'), false, 'a size that fits is kept');
  assert.equal(fits.functions.find((f) => f.entry === A)?.extent.end, A + 8);
});

test('a candidate in the other mode of a listed entry neither takes it nor is reported: the entry keeps its listed mode', () => {
  // A listed function queues an ARM candidate at an entry listed as Thumb (on the 32 MiB synthetic ROM a `bx pc`
  // at 0x0949B90C proposes 0x0949B910 as ARM; discover took it as Thumb first). Before the fix the ARM candidate,
  // popped before the entry's own seed, was taken in its mode, so confirm's layout lost a legal border init wrote.
  const rom = romWith([
    { at: A, bytes: thumbAt(A)`bx lr` },
    { at: C, bytes: thumbAt(C)`bx lr` },
  ]);
  const armAtC = fakeRule('seed.veneer', { kind: 'queue', queue: (f) => (f.entry === A ? [{ entry: C, mode: 'arm' as const, proposedBy: 'seed.veneer' as const, cites: [A] }] : []) }, 'veneer');
  const profile = testProfile({ seed: ['seed.listed'], queue: ['seed.veneer'], claim: ['claim.adjacent-pools'], walk: walk.map((w) => w.meta.id) });
  const reg = registry(listed, armAtC, extent, ...walk);
  const result = runAnalysis(rom, profile, { mode: 'confirm', seeds: [seed(A), seed(C)], overrides: [], trail: 'off' }, tuningFor(profile, reg), reg);
  assert.equal(result.mode, 'confirm');
  if (result.mode !== 'confirm') return;
  assert.deepEqual(result.functions.map((f) => [f.entry, f.mode, f.extent.end - f.entry]), [
    [A, 'thumb', 2],
    [C, 'thumb', 2],
  ]);
  assert.deepEqual(result.unlisted, []);
  assert.deepEqual(result.diagnostics, []);
});
