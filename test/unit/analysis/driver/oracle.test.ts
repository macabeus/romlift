// The oracle protocol: an answered family short-circuits (its answer is used as is), a computed family
// is checked, and the markers come at every claim and epoch.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answers, consult, ORACLE_FAMILY } from '../../../../src/core/analysis/oracle.ts';
import { runAnalysis } from '../../../../src/core/analysis/driver/run.ts';
import { readingOf, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { extent, listed } from './fakes.ts';
import { recorder } from './recorder.ts';

const A = 0x0800_0200;

test('consult: no oracle computes; an answer short-circuits; otherwise the oracle checks what was computed', () => {
  let computed = 0;
  const compute = (): boolean => ((computed += 1), true);
  assert.equal(consult(undefined, { method: 'valid', entry: A }, compute), true);
  const answering = recorder(['valid'], { valid: () => false });
  assert.equal(consult(answering, { method: 'valid', entry: A }, compute), false);
  assert.equal(computed, 1, 'not computed when answered');
  assert.deepEqual(answering.checked, []);
  const checking = recorder([]);
  assert.equal(consult(checking, { method: 'valid', entry: A }, compute), true);
  assert.deepEqual(checking.checked, ['valid']);
});

test('the method families; bl verdicts live inside settle, so the walk family answers them', () => {
  assert.equal(ORACLE_FAMILY.settle, 'walk');
  assert.equal(ORACLE_FAMILY.analyzeArm, 'walk');
  assert.equal(ORACLE_FAMILY.couldBeCode, 'valid');
  assert.equal(ORACLE_FAMILY.inPointerTable, 'accept');
  assert.equal(ORACLE_FAMILY.pointerCandidates, 'seed');
  assert.equal(ORACLE_FAMILY.absorbBlock, 'gap');
  assert.equal(answers(recorder(['walk']), 'bl'), true);
  assert.equal(answers(recorder(['walk']), 'valid'), false);
  assert.equal(answers(undefined, 'walk'), false);
});

test('an answered walk family serves the logged reading; the walk rules need no implementation', () => {
  const rom = romWith([{ at: A, bytes: thumbAt(A)`bx lr` }]);
  const logged = readingOf(rom, { entry: A, insns: [{ addr: A, len: 2 }, { addr: A + 2, len: 2 }], end: A + 4 });
  const oracle = recorder(['walk'], { settle: (q) => (q.entry === A ? logged : undefined) });
  const profile = testProfile({ seed: ['seed.listed'], walk: ['walk.pc-load-is-pool'], claim: ['claim.adjacent-pools'] });
  const reg = registry(listed, extent);
  const result = runAnalysis(rom, profile, { mode: 'discover', seeds: [{ entry: A, mode: 'thumb', rule: 'seed.listed' }], overrides: [], trail: 'off' }, tuningFor(profile, reg, { oracle, disabled: [] }), reg);
  assert.deepEqual(result.functions[0]?.code, [{ start: A, end: A + 4 }], 'the logged reading, not a walk of the ROM');
  assert.ok(oracle.log.includes('#claim'));
  assert.ok(oracle.log.filter((m) => m === '#forgetCandidates').length >= 2, 'an epoch at every grow round and fillGaps call');
});
