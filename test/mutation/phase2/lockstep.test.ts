// Fault injection into the lockstep reporter (g2.checks-fail, architecture §4.5, §10, D48): a hand-written
// romlift-bench/poc-queries@1 log (queries.ndjson and readings.ndjson in a temporary directory, read back
// with openPocLog) records a run of the PoC in which two harvest candidates are both valid. The driver
// runs in lockstep with every family answered from the log except validity, which a fake rule computes.
// A correct fake rule follows the whole log; a fake rule that deliberately rejects the second candidate
// makes the reporter name the first divergent query: its seq, method, args, both answers, epoch and the
// path of its parents.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { profileById, type CompilerProfile, type RuleId } from 'romlift';
import type { RuleRegistry, ValidityRule } from 'romlift/internal';

import { ANALYSIS_FAMILIES, LockstepDivergence, runLockstep, type LockstepResult } from '../../../bench/src/lockstep.ts';
import { openPocLog, QUERIES_SCHEMA, READINGS_FILE, readingKey, type PocQuery } from '../../../bench/src/poc-log.ts';
import { fakeRule, registry, romWith } from '../../helpers/analysis.ts';
import { withTempDir } from '../../unit/bench/fixtures.ts';

const B = 0x0800_0000;
/** The two harvest candidates, both free Thumb addresses past the cartridge entry's ARM code. */
const D = 0x0800_0180;
const C = 0x0800_0200;
const FAKE: RuleId = 'valid.fake-rule';

// ---------------------------------------------------------------------------------------------------
// The hand-written log, as export-poc --mode queries writes it.

/** A stored reading (insnRuns, not insns) with every list empty. */
function storedReading(entry: number, mode: 'arm' | 'thumb', len: 2 | 4, count: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const end = entry + len * count;
  return {
    entry,
    mode,
    insnRuns: [[entry, len, count]],
    pools: [],
    tables: [],
    calls: [],
    blSites: [],
    deadEnd: [],
    balance: [],
    returns: 1,
    errors: [],
    veneers: [],
    adrs: [],
    tails: [],
    tailExits: 0,
    codeEnd: end,
    end,
    ...extra,
  };
}

const ENTRY_READING = storedReading(B, 'arm', 4, 0x30);
const D_READING = storedReading(D, 'thumb', 2, 3, { balance: [0] });
const C_READING = storedReading(C, 'thumb', 2, 3, { balance: [0] });
const key = readingKey;

type Line = Readonly<{ seq: number; parent: number | null; epoch: number; method: string; args: readonly unknown[]; result: unknown }>;

/** One run of the PoC: the cartridge entry, then the patient pass harvesting D and C (valid, settled, not acceptable), then the impatient pass with nothing. */
function pocRun(): readonly Line[] {
  const at = (seq: number, epoch: number, method: string, args: readonly unknown[], result: unknown, parent: number | null = null): Line => ({ seq, parent, epoch, method, args, result });
  const settled = (stored: Record<string, unknown>): unknown => ({ reading: key(stored), far: [], noret: [] });
  return [
    at(0, 0, 'analyzeArm', [B], { reading: key(ENTRY_READING) }),
    at(1, 0, 'claim', [B], { entry: B, mode: 'arm', origin: 'rom entry', absorbed: false }),
    at(2, 1, 'forgetCandidates', [], null),
    at(3, 1, 'pointerCandidates', [], { pool: [D, C], data: [] }),
    at(4, 1, 'valid', [D], true),
    at(5, 1, 'whyInvalid', [D], null, 4),
    at(6, 1, 'settle', [D], settled(D_READING)),
    at(7, 1, 'acceptable', [D, 'pool pointer'], false),
    at(8, 1, 'valid', [C], true),
    at(9, 1, 'whyInvalid', [C], null, 8),
    at(10, 1, 'settle', [C], settled(C_READING)),
    at(11, 1, 'acceptable', [C, 'pool pointer'], false),
    at(12, 2, 'forgetCandidates', [], null),
    at(13, 3, 'forgetCandidates', [], null),
    at(14, 3, 'pointerCandidates', [], { pool: [], data: [] }),
    at(15, 4, 'forgetCandidates', [], null),
  ];
}

/** Writes the log beside its readings in `dir` and reads it back through the frozen reader. */
async function writeAndRead(dir: string): Promise<readonly PocQuery[]> {
  const header = { schema: QUERIES_SCHEMA, rom: 'hand', sha1: 'f'.repeat(40), pocSourceDigest: 'p'.repeat(64), readings: READINGS_FILE };
  const queries = join(dir, 'queries.ndjson');
  await writeFile(queries, [header, ...pocRun()].map((v) => `${JSON.stringify(v)}\n`).join(''));
  const readings = [ENTRY_READING, D_READING, C_READING].map((r) => `${JSON.stringify({ key: key(r), reading: r })}\n`);
  await writeFile(join(dir, READINGS_FILE), readings.join(''));
  assert.match(await readFile(queries, 'utf8'), /^\{"schema":"romlift-bench\/poc-queries@1"/);
  const log = await openPocLog(queries);
  const records: PocQuery[] = [];
  for await (const q of log.queries) records.push(q);
  return records;
}

// ---------------------------------------------------------------------------------------------------
// The fake validity rule, and agbcc with it as the whole validity slot.

function validity(rejects: ReadonlySet<number>): RuleRegistry {
  const contract: ValidityRule = {
    kind: 'valid',
    reason: 'not-dense',
    intrinsic: false,
    check: () => undefined,
    checkEntry: (entry) => (rejects.has(entry) ? 'deliberately wrong: the fake rule rejects this entry' : undefined),
  };
  return registry(fakeRule(FAKE, contract));
}

function profile(): CompilerProfile {
  const agbcc = profileById('agbcc');
  assert.ok(agbcc !== undefined);
  return { ...agbcc, pipeline: { ...agbcc.pipeline, validity: [FAKE] } };
}

const ANSWERED = ANALYSIS_FAMILIES.filter((f) => f !== 'valid');

async function lockstepWith(rejects: ReadonlySet<number>): Promise<LockstepResult> {
  return withTempDir('romlift-mut-lockstep-', async (dir) => runLockstep(romWith([]), await writeAndRead(dir), ANSWERED, profile(), validity(rejects)));
}

test('a correct fake rule follows the whole hand-written log', async () => {
  const result = await lockstepWith(new Set());
  assert.equal(result.divergence, undefined, JSON.stringify(result.divergence));
  assert.deepEqual(result.families, ANSWERED);
  assert.equal(result.queries, 16);
  assert.equal(result.matched, 16);
  assert.equal(result.compared, 4, 'valid and whyInvalid of D and C are computed and compared');
  assert.ok(result.parityDigest !== undefined);
});

test('a deliberately wrong answer is reported at the first divergent query, with both answers, its epoch and its parents', async () => {
  const result = await lockstepWith(new Set([C]));
  const d = result.divergence;
  assert.ok(d !== undefined, 'the wrong answer must diverge');
  assert.equal(d.kind, 'answer');
  assert.equal(d.seq, 9, 'whyInvalid(C), not the earlier whyInvalid(D) the fake rule answers rightly');
  assert.equal(d.method, 'whyInvalid');
  assert.deepEqual(d.args, [C]);
  assert.equal(d.ours, FAKE, 'ours: the fake rule rejects C');
  assert.equal(d.poc, null, 'the PoC: no failure');
  assert.equal(d.epoch, 1);
  assert.deepEqual(d.path, [{ seq: 8, method: 'valid', args: [C] }]);
  assert.match(d.detail, new RegExp(`^whyInvalid\\(${C}\\) answers differ`));
  assert.equal(new LockstepDivergence(d).message, `lockstep diverges at seq 9 (answer): ${d.detail}`);
  // The run stopped there: no parity digest, and nothing after seq 9 was matched.
  assert.equal(result.parityDigest, undefined);
  assert.equal(result.matched, 10);
});

test('the first divergence wins: rejecting both candidates names D, the earlier one', async () => {
  const d = (await lockstepWith(new Set([D, C]))).divergence;
  assert.ok(d !== undefined);
  assert.deepEqual([d.kind, d.seq, d.method, d.args, d.ours, d.poc, d.epoch], ['answer', 5, 'whyInvalid', [D], FAKE, null, 1]);
  assert.deepEqual(d.path, [{ seq: 4, method: 'valid', args: [D] }]);
});
