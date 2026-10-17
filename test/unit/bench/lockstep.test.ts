// The lockstep oracle (bench/src/lockstep.ts) on hand-written logs: an answered family short-circuits
// and skips the records nested under it, a computed answer that differs is reported with its seq and
// parents, an epoch or claim mismatch is reported, the side effects of an answered tryTiledHole and
// absorbBlock are matched, a memo hit of the PoC is recalled, and a whole run with every family
// answered reproduces a hand-written log and its parity view.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Reading } from 'romlift/internal';

import { parityDigest, PARITY_SCHEMA, type ParityView } from '../../../bench/src/parity-view.ts';
import {
  ANALYSIS_FAMILIES,
  answeredFamilies,
  failureOfText,
  LockstepDivergence,
  logOracle,
  readingFromLog,
  runLockstep,
  type Divergence,
} from '../../../bench/src/lockstep.ts';
import type { PocQuery, PocReading, ReadingRef } from '../../../bench/src/poc-log.ts';
import { registry, romWith, testProfile } from '../../helpers/analysis.ts';
import { AGBCC } from '../../../src/core/profile/agbcc.ts';

const B = 0x0800_0000;
const A = 0x0800_0200;
const C = 0x0800_0300;
const rom = romWith([]);

function pocReading(entry: number, insns: number, extra: Partial<PocReading> = {}): PocReading {
  const list = Array.from({ length: insns }, (_, i) => [entry + 2 * i, 2] as const);
  const codeEnd = entry + 2 * insns;
  return {
    entry,
    mode: 'thumb',
    insns: list,
    pools: [],
    tables: [],
    calls: [],
    blSites: [],
    deadEnd: [],
    balance: [0],
    returns: 1,
    errors: [],
    veneers: [],
    adrs: [],
    tails: [],
    tailExits: 0,
    codeEnd,
    end: codeEnd,
    ...extra,
  };
}

const ref = (reading: PocReading): ReadingRef => ({ key: `${reading.mode}:${reading.entry}:${reading.end}`, reading });

/** A log built call by call: each record nests in `parent` and carries the current epoch. */
function log(): { readonly records: PocQuery[]; add(method: PocQuery['method'], args: readonly unknown[], result: unknown, parent?: number): number } {
  const records: PocQuery[] = [];
  let epoch = 0;
  return {
    records,
    add(method, args, result, parent) {
      if (method === 'forgetCandidates') epoch++;
      const seq = records.length;
      records.push({ seq, parent: parent ?? null, epoch, method, args, result } as unknown as PocQuery);
      return seq;
    },
  };
}

function divergenceOf(f: () => void): Divergence {
  try {
    f();
  } catch (error) {
    if (error instanceof LockstepDivergence) return error.divergence;
    throw error;
  }
  assert.fail('no divergence');
}

test('bl follows walk; bl alone is refused', () => {
  assert.deepEqual(answeredFamilies(['walk', 'gap']), ['walk', 'bl', 'gap']);
  assert.throws(() => answeredFamilies(['bl']), /bl is answered only with walk/);
});

test('an answered family returns the logged answer and skips the records nested under it', () => {
  const l = log();
  const v = l.add('valid', [A], true);
  const why = l.add('whyInvalid', [A], null, v);
  l.add('settle', [A], { ...ref(pocReading(A, 3)), far: [], noret: [] }, why);
  l.add('settle', [C], { ...ref(pocReading(C, 3)), far: [], noret: [] });
  const oracle = logOracle(l.records, ['valid'], rom);
  assert.equal(oracle.ask({ method: 'valid', entry: A }), true);
  assert.equal(oracle.ask({ method: 'settle', entry: C }), undefined, 'walk is computed');
  oracle.check({ method: 'settle', entry: C }, readingFromLog(rom, pocReading(C, 3), { far: [], noret: [] }));
  assert.equal(oracle.finish(), undefined);
  assert.deepEqual(oracle.counts(), { queries: 4, matched: 2, answered: 1, compared: 1, markers: 0, skipped: 2, recalled: 0 });
});

test('a computed answer that differs is reported with its seq, epoch and parents', () => {
  const l = log();
  l.add('forgetCandidates', [], null);
  const v = l.add('valid', [A], false);
  l.add('whyInvalid', [A], 'not dense: holes inside its extent', v);
  const oracle = logOracle(l.records, ['walk'], rom);
  oracle.marker({ kind: 'forgetCandidates', epoch: 1 });
  assert.equal(oracle.ask({ method: 'valid', entry: A }), undefined);
  assert.equal(oracle.ask({ method: 'whyInvalid', entry: A }), undefined);
  const d = divergenceOf(() => oracle.check({ method: 'whyInvalid', entry: A }, null));
  assert.equal(d.kind, 'answer');
  assert.equal(d.seq, 2);
  assert.equal(d.epoch, 1);
  assert.equal(d.method, 'whyInvalid');
  assert.deepEqual(d.args, [A]);
  assert.deepEqual([d.ours, d.poc], [null, 'valid.dense'], 'whyInvalid compares by the validity rule its text maps to');
  assert.deepEqual(d.path, [{ seq: 1, method: 'valid', args: [A] }]);
});

test('a differing reading names the fields that differ', () => {
  const l = log();
  l.add('analyzeArm', [B], ref({ ...pocReading(B, 2), mode: 'arm' }));
  const oracle = logOracle(l.records, [], rom);
  oracle.ask({ method: 'analyzeArm', entry: B });
  const ours: Reading = readingFromLog(rom, { ...pocReading(B, 3), mode: 'arm' });
  const d = divergenceOf(() => oracle.check({ method: 'analyzeArm', entry: B }, ours));
  assert.equal(d.kind, 'answer');
  assert.match(d.detail, /codeEnd, end, insns/);
});

test('an epoch boundary, a claim or a query the PoC did not make is a divergence', () => {
  const l = log();
  l.add('forgetCandidates', [], null);
  assert.equal(divergenceOf(() => logOracle(l.records, [], rom).marker({ kind: 'forgetCandidates', epoch: 2 })).kind, 'marker');
  assert.equal(divergenceOf(() => logOracle(l.records, [], rom).marker({ kind: 'claim', entry: A, mode: 'thumb' })).kind, 'marker');
  const q = divergenceOf(() => logOracle(l.records, [], rom).ask({ method: 'valid', entry: A }));
  assert.equal(q.kind, 'query');
  assert.deepEqual(q.ours, { method: 'valid', args: [A] });
  const c = log();
  c.add('claim', [A], { entry: A, mode: 'thumb', origin: 'call', absorbed: false });
  const claims = logOracle(c.records, [], rom);
  claims.marker({ kind: 'claim', entry: A, mode: 'thumb' });
  assert.equal(divergenceOf(() => claims.ask({ method: 'valid', entry: A })).kind, 'unlogged');
});

test('a call the PoC made inside a computed query, or after our run, is reported as unasked', () => {
  const l = log();
  const v = l.add('valid', [A], true);
  l.add('whyInvalid', [A], null, v);
  const oracle = logOracle(l.records, [], rom);
  oracle.ask({ method: 'valid', entry: A });
  assert.equal(divergenceOf(() => oracle.check({ method: 'valid', entry: A }, true)).kind, 'unasked');
  const late = logOracle(l.records, ['valid'], rom);
  assert.equal(late.finish()?.kind, 'unasked');
});

test('couldBeCode is never asked: its record is passed over and its nested settle matched', () => {
  const l = log();
  const why = l.add('whyInvalid', [A], null);
  const could = l.add('couldBeCode', [C], true, why);
  l.add('settle', [C], { ...ref(pocReading(C, 3)), far: [], noret: [] }, could);
  const oracle = logOracle(l.records, ['walk'], rom);
  oracle.ask({ method: 'whyInvalid', entry: A });
  const r = oracle.ask({ method: 'settle', entry: C });
  assert.equal(r?.entry, C, 'answered: walk');
  oracle.check({ method: 'whyInvalid', entry: A }, null);
  assert.equal(oracle.finish(), undefined);
});

test('an answered tryTiledHole skips its holeHead and keeps its acceptance; a null absorbBlock skips everything', () => {
  const l = log();
  const t = l.add('tryTiledHole', [A, 0x400], ref(pocReading(A, 4)));
  const h = l.add('holeHead', [A, 0x400], ref(pocReading(A, 4)), t);
  l.add('whyInvalid', [A], 'not dense: holes inside its extent', h);
  l.add('settle', [A], { ...ref(pocReading(A, 4)), far: [], noret: [] }, t);
  l.add('claim', [A], { entry: A, mode: 'thumb', origin: 'tiled hole', absorbed: false }, t);
  const ab = l.add('absorbBlock', [0x300, 0x2f0, 0x400], null);
  l.add('settle', [C], { ...ref(pocReading(C, 3)), far: [], noret: [] }, ab);
  const oracle = logOracle(l.records, ['gap', 'walk'], rom);
  assert.equal(oracle.ask({ method: 'tryTiledHole', entry: A, hi: 0x400 })?.entry, A);
  assert.equal(oracle.ask({ method: 'settle', entry: A })?.end, A + 8, 'the acceptance is matched');
  oracle.marker({ kind: 'claim', entry: A, mode: 'thumb' });
  assert.equal(oracle.ask({ method: 'absorbBlock', p: 0x300, start: 0x2f0, end: 0x400 }), null);
  assert.equal(oracle.finish(), undefined);
  assert.equal(oracle.counts().skipped, 3);
});

test('a computed valid or settle the PoC answered from its memo of a skipped call is recalled from the log', () => {
  const l = log();
  const acc = l.add('acceptable', [A, 'data pointer'], false);
  const ipt = l.add('inPointerTable', [A], false, acc);
  const v = l.add('valid', [C], true, ipt);
  const why = l.add('whyInvalid', [C], null, v);
  l.add('settle', [C], { ...ref(pocReading(C, 3)), far: [], noret: [] }, why);
  l.add('valid', [C], true);
  l.add('settle', [C], { ...ref(pocReading(C, 3)), far: [], noret: [] });
  l.add('forgetCandidates', [], null);
  l.add('valid', [C], true);
  const oracle = logOracle(l.records, ['accept'], rom);
  assert.equal(oracle.ask({ method: 'acceptable', entry: A, why: 'data pointer' }), false);
  assert.equal(oracle.ask({ method: 'valid', entry: C }), true, 'recalled: ours never computed it');
  assert.equal(oracle.ask({ method: 'settle', entry: C })?.entry, C, 'recalled too');
  assert.equal(oracle.counts().recalled, 2);
  oracle.marker({ kind: 'forgetCandidates', epoch: 1 });
  assert.equal(oracle.ask({ method: 'valid', entry: C }), undefined, 'a new epoch forgets the memo: computed');
  oracle.check({ method: 'valid', entry: C }, true);
  assert.equal(oracle.finish(), undefined);
});

test('readings from the log carry the settle verdicts; whyInvalid texts map to validity rules', () => {
  const r = readingFromLog(rom, pocReading(A, 3, { errors: [['not_code', A + 6]], deadEnd: [A + 2] }), { far: [A], noret: [A + 2] });
  assert.deepEqual(r.errors, [{ reason: 'not-code', at: A + 6 }]);
  assert.deepEqual(r.blVerdicts.map((v) => [v.site, v.verdict]), [[A, 'far'], [A + 2, 'noreturn']]);
  assert.deepEqual([r.far, r.noret], [[A], [A + 2]]);
  assert.equal(failureOfText('calls 8000301, which is not code').rule, 'valid.calls-code');
  assert.equal(failureOfText('calls 8000301, which is not code').intrinsic, false);
  assert.equal(failureOfText('decode error not_code at 8000206').reason, 'decode-error');
  assert.throws(() => failureOfText('something else'), /maps to no validity rule/);
});

test('a whole run with every family answered reproduces a hand-written log and its parity view', () => {
  // The cartridge entry (ARM, 0xC0 bytes of code), then nothing else: the passes find no candidate.
  const entry = { ...pocReading(B, 0), mode: 'arm' as const, insns: Array.from({ length: 0x30 }, (_, i) => [B + 4 * i, 4] as const), codeEnd: B + 0xc0, end: B + 0xc0, balance: [], returns: 1 };
  const l = log();
  l.add('analyzeArm', [B], ref(entry));
  l.add('claim', [B], { entry: B, mode: 'arm', origin: 'rom entry', absorbed: false });
  for (const _pass of ['patient', 'impatient']) {
    l.add('forgetCandidates', [], null);
    l.add('pointerCandidates', [], { pool: [], data: [] });
    l.add('forgetCandidates', [], null);
  }
  const result = runLockstep(rom, l.records, ANALYSIS_FAMILIES, AGBCC);
  assert.equal(result.divergence, undefined, JSON.stringify(result.divergence));
  assert.deepEqual([result.queries, result.matched, result.answered, result.markers], [8, 8, 3, 5]);
  const view: ParityView = {
    schema: PARITY_SCHEMA,
    functions: [{ entry: B, mode: 'arm', end: B + 0xc0, codeEnd: B + 0xc0, code: [[B, B + 0xc0]], pools: [], tables: [], far: [], noreturn: [], origin: 'rom-entry' }],
    claims: [[B, B + 0xc0, 1]],
    startup: { end: B + 0xc0, entries: [B] },
    codeEnd: B + 0xc0,
  };
  assert.equal(result.parityDigest, parityDigest(view));
});

test('a computed family without rules is refused before the run', () => {
  assert.throws(() => runLockstep(rom, [], ['seed'], testProfile({ walk: ['walk.pc-load-is-pool'] }), registry()), /the computed families lack rules: walk.pc-load-is-pool/);
});
