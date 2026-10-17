// heldOutVerdict and the D60 waiver, the function g2.held-out calls (test/gates/held-out-verdict.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILY_WAIVER, heldOutVerdict, waiverMismatch, type SealedBinding } from '../../gates/held-out-verdict.ts';

const TUNING = ['fe-gba', 'kleod', 'pret-gen3', 'sat-r'];
const AT_D60 = [...TUNING, 'zeldaret-tmc'];
const SEALED: readonly SealedBinding[] = FAMILY_WAIVER.sealed;
const WAIVER = { waiver: FAMILY_WAIVER, sealed: SEALED };

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

test('heldOutVerdict with the D60 waiver: only the fresh-family condition is waived; two pret-gen3 ROMs still fail on two families (Q4)', () => {
  const sealed = [
    { name: 'pokefirered', family: 'pret-gen3', pass: true },
    { name: 'pokeruby', family: 'pret-gen3', pass: true },
  ];
  const v = heldOutVerdict(sealed, AT_D60, WAIVER);
  assert.equal(v.pass, false);
  assert.equal(v.waiverRefused, undefined);
  assert.equal(v.waived?.length, 1);
  assert.match(v.waived?.[0] ?? '', /^no passing ROM is from a family absent from the tuning set: waived by the owner, Bruno Macabeus .* on 2026-10-17 \(D60; the owner's words/);
  assert.equal(v.problems.length, 1);
  assert.match(v.problems[0] ?? '', /^the passing ROMs span 1 codebase families, at least two must \(not waived: .*owner question Q4/);
  // With two families passing, the fresh-family waiver alone lets the gate pass.
  const two = heldOutVerdict([sealed[0]!, { name: 'pokeruby', family: 'sat-r', pass: true }], AT_D60, WAIVER);
  assert.equal(two.pass, true);
  assert.deepEqual(two.problems, []);
  assert.equal(two.waived?.length, 1);
  // A waiver with grounds for both conditions waives both (the shape an owner's confirmation of Q4 takes).
  const both = heldOutVerdict(sealed, AT_D60, { waiver: { ...FAMILY_WAIVER, grounds: { ...FAMILY_WAIVER.grounds, twoFamilies: 'confirmed' } }, sealed: SEALED });
  assert.equal(both.pass, true);
  assert.equal(both.waived?.length, 2);
  // The waiver never covers a ROM that fails, or fewer than two passing ROMs.
  const one = heldOutVerdict([sealed[0]!, { ...sealed[1]!, pass: false }], AT_D60, WAIVER);
  assert.equal(one.pass, false);
  assert.ok(one.problems.includes('1 of 2 sealed ROMs pass, at least two must'));
});

test('heldOutVerdict: the D60 waiver ends on any change to the sealed set or the tuning families', () => {
  const results = [
    { name: 'pokefirered', family: 'pret-gen3', pass: true },
    { name: 'pokeruby', family: 'pret-gen3', pass: true },
  ];
  const cases: [string, readonly SealedBinding[], readonly string[]][] = [
    ['a sealed ROM added', [...SEALED, { name: 'kirby', sha1: 'a'.repeat(40), elfSha256: 'b'.repeat(64) }], AT_D60],
    ['a sealed ROM removed', [SEALED[0]!], AT_D60],
    ['a sealed ROM rebuilt', [SEALED[0]!, { ...SEALED[1]!, elfSha256: '0'.repeat(64) }], AT_D60],
    ['a tuning family added', SEALED, [...AT_D60, 'kirby-am']],
    ['a tuning family dropped', SEALED, TUNING],
  ];
  for (const [what, sealed, families] of cases) {
    const v = heldOutVerdict(results, families, { waiver: FAMILY_WAIVER, sealed });
    assert.equal(v.pass, false, what);
    assert.equal(v.waived, undefined, what);
    assert.match(v.waiverRefused ?? '', /the D60 waiver does not apply: .*a new owner decision is needed$/, what);
    assert.ok(v.problems.includes('no passing ROM is from a family absent from the tuning set'), what);
    assert.ok(v.problems.includes('the passing ROMs span 1 codebase families, at least two must'), what);
  }
  assert.equal(waiverMismatch(FAMILY_WAIVER, [...SEALED].reverse(), [...AT_D60].reverse()), undefined);
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

test('FAMILY_WAIVER is bound to the committed sealed datasets', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const b of SEALED) {
    const d = JSON.parse(await readFile(new URL(`../../../bench/dataset/real/${b.name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
    assert.equal(d['sha1'], b.sha1);
    assert.equal(d['elfSha256'], b.elfSha256);
    assert.deepEqual(d['revealed'], []);
  }
});
