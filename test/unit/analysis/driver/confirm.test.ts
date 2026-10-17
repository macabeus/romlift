// Confirm mode: the listed entries are functions from round 0; a listed entry that fails validity is
// kept and reported; a discovery beyond the list is reported and claims nothing; extents are cut.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAnalysis } from '../../../../src/core/analysis/driver/run.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { Seed } from '../../../../src/core/analysis/types.ts';
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
  const result = run([seed(A), seed(B)]);
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
