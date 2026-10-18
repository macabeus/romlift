// parityCheck, the one check g2.poc-parity runs before and after it is historical (test/gates/poc-parity-check.ts).
// The harness step that runs it once the gate is frozen is tested in gate.test.ts (code-quality-r0-7).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TMC_AT_D61 } from '../../gates/dataset-binding.ts';
import { LOCKSTEP_SETS, parityCheck, SCOPED_OUT, type ParityEvidence, type PocDigests, type TuningRom } from '../../gates/poc-parity-check.ts';

const FIVE = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3'];
const FIVE_ROMS: readonly TuningRom[] = FIVE.map((name) => ({ name, sha1: `${name}-sha1`, elfSha256: `${name}-elf` }));
const TMC: TuningRom = { name: 'tmc', ...TMC_AT_D61 };
const SIX: readonly TuningRom[] = [...FIVE_ROMS, TMC];
const D = (name: string): string => `${name}-digest`;

const DIGESTS: PocDigests = { pocSourceDigest: 'poc', roms: Object.fromEntries(FIVE.map((n) => [n, D(n)])) };

function evidence(over: (name: string) => Partial<ParityEvidence['roms'][string]> = () => ({})): ParityEvidence {
  return {
    schema: 'romlift-bench/parity-evidence@1',
    commit: 'e867dae',
    dirty: false,
    worklist: 'poc-lifo',
    pocSourceDigest: 'poc',
    roms: Object.fromEntries(
      FIVE.map((n) => [
        n,
        {
          digest: D(n),
          expected: D(n),
          rowDiffs: 0,
          lockstep: LOCKSTEP_SETS.map((set) => ({ set, queries: 10, matched: 7, skipped: 3, parityDigest: D(n), divergence: null })),
          ...over(n),
        },
      ]),
    ),
  };
}

test('parityCheck: the M1 evidence of the five passes, tmc is scoped out by the owner (Q1, D61 c) and printed as not applicable', () => {
  const out = parityCheck({ evidence: evidence(), digests: DIGESTS, tuning: SIX, scopedOut: SCOPED_OUT, ancestor: true });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.judged, FIVE);
  assert.equal(out.notApplicable.length, 1);
  assert.match(out.notApplicable[0] ?? '', /^tmc: not applicable, no M1 lockstep run \(the owner's answer to Q1 .*"Keep tmc as 99\.94%\. It's a benchmark row that we can improve later"\)$/);
  assert.deepEqual(Object.keys(SCOPED_OUT), ['tmc'], 'the owner scoped out tmc and nothing else');
});

test('parityCheck: without the scoping, tmc fails; a stale scoping fails', () => {
  assert.deepEqual(parityCheck({ evidence: evidence(), digests: DIGESTS, tuning: SIX, scopedOut: {}, ancestor: true }).problems, ['tmc: no parity evidence and no committed PoC digest']);
  assert.deepEqual(parityCheck({ evidence: evidence(), digests: DIGESTS, tuning: FIVE_ROMS, scopedOut: SCOPED_OUT, ancestor: true }).problems, ['tmc is scoped out but is not a tuning dataset (the scoping is stale)']);
});

test('parityCheck judges every ROM of its scope as strictly as before: digest, rows, every lockstep set, the commit, the PoC source', () => {
  const run = (e: ParityEvidence | undefined, ancestor = true): readonly string[] => parityCheck({ evidence: e, digests: DIGESTS, tuning: SIX, scopedOut: SCOPED_OUT, ancestor }).problems;
  assert.deepEqual(run(undefined), ['bench/results.json holds no parity evidence']);
  assert.deepEqual(run(evidence((n) => (n === 'sa2' ? { rowDiffs: 3 } : {}))), ['sa2: 3 rows differed from the PoC baseline']);
  assert.deepEqual(run(evidence((n) => (n === 'klonoa' ? { digest: 'x' } : {}))), ['klonoa: parity digest x, the PoC\'s is klonoa-digest']);
  const diverged = evidence((n) => (n === 'fe7j' ? { lockstep: LOCKSTEP_SETS.map((set) => ({ set, queries: 10, matched: 7, skipped: 3, parityDigest: D(n), divergence: set === 'all' ? { seq: 4, kind: 'reading', detail: 'd' } : null })) } : {}));
  assert.deepEqual(run(diverged), ['fe7j: lockstep all diverges at seq 4 (reading): d']);
  const short = evidence((n) => (n === 'sa3' ? { lockstep: LOCKSTEP_SETS.filter((set) => set !== 'driver').map((set) => ({ set, queries: 10, matched: 7, skipped: 3, parityDigest: D(n), divergence: null })) } : {}));
  assert.deepEqual(run(short), ['sa3: no lockstep driver']);
  assert.deepEqual(run(evidence(), false), ['the evidence names commit e867dae, which is not an ancestor of HEAD']);
  assert.deepEqual(run({ ...evidence(), worklist: 'epoch' }), ['the parity evidence is romlift-bench/parity-evidence@1 under epoch']);
  const { pokeemerald: _dropped, ...four } = evidence().roms;
  assert.deepEqual(run({ ...evidence(), roms: four }), ['pokeemerald: no parity evidence']);
});

test('parityCheck: the scoping holds only for the ROM and ELF it was decided on (overfitting-correctness-r0-4)', () => {
  for (const other of [{ ...TMC, elfSha256: '0'.repeat(64) }, { ...TMC, sha1: 'c'.repeat(40) }, { name: 'tmc', sha1: TMC.sha1 }]) {
    const out = parityCheck({ evidence: evidence(), digests: DIGESTS, tuning: [...FIVE_ROMS, other], scopedOut: SCOPED_OUT, ancestor: true });
    assert.equal(out.problems.length, 2);
    assert.match(out.problems[0] ?? '', /^tmc: the D61 c scoping was decided on ROM SHA-1 b4bd50e4.*the scoping is stale, a new owner decision is needed$/);
    assert.equal(out.problems[1], 'tmc: no parity evidence and no committed PoC digest');
    assert.deepEqual(out.notApplicable, []);
    assert.deepEqual(out.judged, SIX.map((r) => r.name));
  }
  assert.deepEqual(SCOPED_OUT['tmc']?.rom, TMC_AT_D61);
});
