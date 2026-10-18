// The order property of milestone M4 (architecture §4.4, D10): under the default tuning (the ascending
// worklist, whose key (addr, modeRank, ruleRank, seq) is total), the order in which the seeds and the
// TOML's overrides are given never changes the analysis. On every synthetic fixture, in discover mode
// (evidence hints and overrides) and in confirm mode (the expected entries listed, some as labels, with
// sizes), seeded permutations of the seed and override lists give one canonical analysis digest.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { analyze, canonicalJson, profileById, romFromBytes, type AnalysisOptions, type AnalysisResult, type JsonValue, type OverrideFact, type Seed } from 'romlift';
import { DEFAULT_TUNING } from 'romlift/internal';
import { sha1Of } from 'romlift/node';

import { listSyntheticFixtures, readExpect } from '../../../helpers/fixtures.ts';
import { xorshift32 } from '../../../helpers/prng.ts';

const PERMUTATIONS = 6;

/** A seeded Fisher-Yates shuffle; returns the next generator state with the permuted copy. */
function shuffle<T>(items: readonly T[], state: number): { readonly items: T[]; readonly state: number } {
  const out = [...items];
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    s = xorshift32(s);
    const j = s % (i + 1);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return { items: out, state: s };
}

const digest = (r: AnalysisResult): string => Array.from(canonicalJson(r as unknown as JsonValue)).join('');

test('the default tuning is the epoch cache with nothing disabled (the worklist is always ascending)', () => {
  assert.deepEqual(DEFAULT_TUNING, { cache: 'epoch', disabled: [] });
});

test('permuting the seeds and the overrides gives one analysis on every synthetic fixture, in both modes', () => {
  const profile = profileById('agbcc');
  assert.ok(profile !== undefined);
  const fixtures = listSyntheticFixtures();
  assert.ok(fixtures.length > 0);
  let state = 0x2545f491;
  for (const f of fixtures) {
    const bytes = new Uint8Array(readFileSync(f.rom));
    const rom = romFromBytes(bytes, sha1Of(bytes));
    const entries = readExpect(f).entries;
    const hints: Seed[] = entries.map((e, i) => ({ entry: e.addr, mode: e.mode, rule: i % 2 === 0 ? 'seed.evidence-hint' : 'seed.override' }));
    const listed: Seed[] = entries.map((e, i) => ({
      entry: e.addr,
      mode: e.mode,
      rule: 'seed.listed',
      name: `f_${i}`,
      ...(e.extent === undefined || i % 3 !== 1 ? {} : { size: e.extent.end - e.extent.start }),
      ...(i % 4 === 3 ? { label: true } : {}),
    }));
    const overrides: OverrideFact[] = entries.slice(0, 3).map((e, i) => ({ span: { start: e.addr, end: e.addr + 4 + 2 * i }, kind: i === 1 ? 'data' : 'code', ...(i === 2 ? { mode: e.mode } : {}) }));
    for (const [mode, seeds] of [['discover', hints], ['confirm', listed]] as const) {
      const run = (s: readonly Seed[], o: readonly OverrideFact[]): string => {
        const options: AnalysisOptions = { mode, seeds: s, overrides: o, trail: 'off' };
        return digest(analyze(rom, profile, options));
      };
      const reference = run(seeds, overrides);
      for (let k = 0; k < PERMUTATIONS; k++) {
        const a = shuffle(seeds, state);
        const b = shuffle(overrides, a.state);
        state = b.state;
        assert.equal(run(a.items, b.items), reference, `${f.name} (${mode}), permutation ${k}`);
      }
    }
  }
});
