// heldOutVerdict and the D60/D61 waiver, the function g2.held-out calls (test/gates/held-out-verdict.ts).
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

test('heldOutVerdict with the D60 and D61 waiver: both family conditions are waived, with the owner\'s words; the count and the per-ROM verdicts still decide', () => {
  const sealed = [
    { name: 'pokefirered', family: 'pret-gen3', pass: true },
    { name: 'pokeruby', family: 'pret-gen3', pass: true },
  ];
  const v = heldOutVerdict(sealed, AT_D60, WAIVER);
  assert.equal(v.pass, true);
  assert.equal(v.waiverRefused, undefined);
  assert.deepEqual(v.problems, []);
  assert.equal(v.waived?.length, 2);
  assert.match(v.waived?.[0] ?? '', /^the passing ROMs span 1 codebase families, at least two must: waived by the owner, Bruno Macabeus .* on 2026-10-17 \(D60, D61; the owner's answer to Q4 .* "Waive both"\)$/);
  assert.match(v.waived?.[1] ?? '', /^no passing ROM is from a family absent from the tuning set: waived by the owner, Bruno Macabeus .* \(D60, D61; the owner's words/);
  // A condition without grounds is not waived: it fails with the waiver's pending text (the shape before Q4's answer).
  const freshOnly = heldOutVerdict(sealed, AT_D60, {
    waiver: { ...FAMILY_WAIVER, grounds: { freshFamily: FAMILY_WAIVER.grounds.freshFamily ?? '' }, pending: { twoFamilies: 'not waived: owner question' } },
    sealed: SEALED,
  });
  assert.equal(freshOnly.pass, false);
  assert.deepEqual(freshOnly.problems, ['the passing ROMs span 1 codebase families, at least two must (not waived: owner question)']);
  // With two families passing, only the fresh-family condition needs the waiver.
  const two = heldOutVerdict([sealed[0]!, { name: 'pokeruby', family: 'sat-r', pass: true }], AT_D60, WAIVER);
  assert.equal(two.pass, true);
  assert.deepEqual(two.problems, []);
  assert.equal(two.waived?.length, 1);
  // The waiver never covers a ROM that fails, or fewer than two passing ROMs.
  const one = heldOutVerdict([sealed[0]!, { ...sealed[1]!, pass: false }], AT_D60, WAIVER);
  assert.equal(one.pass, false);
  assert.ok(one.problems.includes('1 of 2 sealed ROMs pass, at least two must'));
  const none = heldOutVerdict([{ ...sealed[0]!, pass: false }, { ...sealed[1]!, pass: false }], AT_D60, WAIVER);
  assert.equal(none.pass, false);
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
    assert.match(v.waiverRefused ?? '', /the D60, D61 waiver does not apply: .*a new owner decision is needed$/, what);
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
