// The PoC-parity evidence of results.json (bench/src/parity-evidence.ts): the family sets the lockstep
// proves, what the evidence fails on, and its strict reader.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  answeredBy,
  EVIDENCE_FAMILIES,
  evidenceProblems,
  LOCKSTEP_SETS,
  PARITY_EVIDENCE_SCHEMA,
  parseParityEvidence,
  type LockstepSummary,
  type ParityEvidence,
} from '../../../bench/src/parity-evidence.ts';

const DIGEST = 'a'.repeat(64);
const SOURCE = 'f'.repeat(64);

function summary(set: string, real: LockstepSummary['real'], over: Partial<LockstepSummary> = {}): LockstepSummary {
  return { set, real, queries: 10, matched: 8, answered: 3, compared: 5, markers: 2, skipped: 2, recalled: 0, parityDigest: DIGEST, divergence: null, ...over };
}

function evidence(over: Partial<ParityEvidence['roms'][string]> = {}): ParityEvidence {
  return {
    schema: PARITY_EVIDENCE_SCHEMA,
    commit: null,
    dirty: true,
    worklist: 'poc-lifo',
    pocSourceDigest: SOURCE,
    roms: { klonoa: { digest: DIGEST, expected: DIGEST, rowDiffs: 0, lockstep: LOCKSTEP_SETS.map((s) => summary(s.name, s.real)), ...over } },
  };
}

const DIGESTS = { pocSourceDigest: SOURCE, roms: { klonoa: DIGEST } };

test('the lockstep sets: the driver alone, the three wave-1 family groups, then every family; answeredBy is the complement', () => {
  assert.deepEqual(LOCKSTEP_SETS.map((s) => s.name), ['driver', 'walk+bl+claim', 'seed+valid+accept', 'gap+region', 'all']);
  assert.deepEqual(answeredBy([]), [...EVIDENCE_FAMILIES]);
  assert.deepEqual(answeredBy(['walk', 'bl', 'claim']), ['seed', 'valid', 'accept', 'gap', 'region']);
  assert.deepEqual(answeredBy(EVIDENCE_FAMILIES), []);
  // Every family is computed by exactly one of the three component sets.
  const groups = LOCKSTEP_SETS.slice(1, 4).flatMap((s) => s.real);
  assert.deepEqual([...groups].sort(), [...EVIDENCE_FAMILIES].sort());
});

test('evidence that proves parity has no problem', () => {
  assert.deepEqual(evidenceProblems(evidence(), DIGESTS), []);
});

test('evidence fails on a digest, a row diff, a divergence, a missing set, a short count, a missing ROM and another PoC', () => {
  assert.match(evidenceProblems(evidence({ digest: 'b'.repeat(64) }), DIGESTS).join(), /klonoa: parity digest b+, the PoC's is a+/);
  assert.match(evidenceProblems(evidence({ rowDiffs: 2 }), DIGESTS).join(), /2 rows differ from the PoC baseline/);
  const sets = LOCKSTEP_SETS.map((s) => summary(s.name, s.real));
  const diverged = sets.map((s, i) => (i === 2 ? { ...s, parityDigest: null, divergence: { seq: 7, kind: 'answer', epoch: 3, method: 'whyInvalid', detail: 'ours x, the PoC y' } } : s));
  assert.match(evidenceProblems(evidence({ lockstep: diverged }), DIGESTS).join(), /lockstep seed\+valid\+accept diverges at seq 7 \(answer\): ours x, the PoC y/);
  assert.match(evidenceProblems(evidence({ lockstep: sets.slice(1) }), DIGESTS).join(), /no lockstep summary for driver/);
  const short = sets.map((s) => ({ ...s, skipped: 1 }));
  assert.match(evidenceProblems(evidence({ lockstep: short }), DIGESTS).join(), /matched 8 and skipped 1 of 10 records/);
  assert.match(evidenceProblems(evidence(), { ...DIGESTS, roms: { klonoa: DIGEST, sa2: DIGEST } }).join(), /sa2: no parity evidence/);
  assert.match(evidenceProblems(evidence(), { ...DIGESTS, pocSourceDigest: 'e'.repeat(64) }).join(), /pins PoC source f+, poc-digests.json e+/);
});

test('parseParityEvidence reads back what it is given and refuses a malformed member', () => {
  const e = evidence();
  assert.deepEqual(parseParityEvidence(JSON.parse(JSON.stringify(e)) as unknown, 'p'), e);
  assert.throws(() => parseParityEvidence({ ...e, schema: 'x' }, 'p'), /p\.schema: must be romlift-bench\/parity-evidence@1/);
  assert.throws(() => parseParityEvidence({ ...e, worklist: 'ascending' }, 'p'), /p\.worklist: must be 'poc-lifo'/);
  const bad = { ...e, roms: { klonoa: { ...e.roms['klonoa'], lockstep: [{ ...summary('all', ['walk']), real: ['nope'] }] } } };
  assert.throws(() => parseParityEvidence(bad, 'p'), /p\.roms\.klonoa\.lockstep\[0\]\.real: must be a list of analysis families/);
  assert.throws(() => parseParityEvidence({ ...e, roms: { klonoa: { ...e.roms['klonoa'], rowDiffs: -1 } } }, 'p'), /rowDiffs: must be a count/);
});
