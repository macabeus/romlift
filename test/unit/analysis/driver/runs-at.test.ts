// A runs_at override end to end through the driver (architecture §3.3, §6.7, D46, D91), on the RAM-copy fixture
// (IwramDouble, ARM, loaded at 0x0800012C, run at 0x03000000; expect.json's `ramCopy`): discover and confirm both take
// the range's start from the override's seed, every function inside the range carries its run address in `runAt` (its
// entry stays the load address), no function outside does, and the result's codec keeps it. Without the override the
// result is the one every golden was measured on (no runAt, the code end before the copied bytes).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { decodeAnalysis, encodeAnalysis } from '../../../../src/core/analysis/codec.ts';
import { analyze } from '../../../../src/core/analysis/driver/run.ts';
import type { AnalysisOptions, AnalysisResult, OverrideFact } from '../../../../src/core/analysis/types.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../../helpers/fixtures.ts';

const fixture = listSyntheticFixtures().find((f) => f.name === 'code-copied-to-ram') ?? assert.fail('code-copied-to-ram');
const ROM = readFixtureRom(fixture);
const ramCopy = (JSON.parse(readFileSync(fixture.expect, 'utf8')) as { readonly ramCopy: { readonly start: string; readonly size: string; readonly runAt: string; readonly mode: 'arm' } }).ramCopy;
const START = Number(ramCopy.start);
const RUN = Number(ramCopy.runAt);
const OVERRIDE: OverrideFact = { span: { start: START, end: START + Number(ramCopy.size) }, kind: 'code', mode: ramCopy.mode, runsAt: RUN };

function run(options: Partial<AnalysisOptions>): AnalysisResult {
  return analyze(ROM, AGBCC, { mode: 'discover', seeds: [], overrides: [], trail: 'off', ...options });
}

test('the fixture expects the range the ELF gives IwramDouble: loaded at 0x0800012C, 12 bytes, run at 0x03000000', () => {
  assert.deepEqual([START, OVERRIDE.span.end, RUN], [0x0800_012c, 0x0800_0138, 0x0300_0000]);
  assert.equal(ROM.end, OVERRIDE.span.end, 'the copied bytes end the ROM');
});

test('discover: the range start is a function at its load address, run at 0x03000000; nothing else runs elsewhere', () => {
  const plain = run({});
  const mapped = run({ overrides: [OVERRIDE] });
  const ram = mapped.functions.find((f) => f.entry === START);
  assert.ok(ram !== undefined);
  assert.deepEqual([ram.mode, ram.runAt, ram.extent, ram.origin], ['arm', RUN, OVERRIDE.span, 'override']);
  assert.deepEqual(mapped.functions.filter((f) => f.runAt !== undefined).map((f) => f.entry), [START]);
  assert.deepEqual(
    mapped.functions.filter((f) => f.entry !== START),
    plain.functions,
    'the functions outside the range are the identity run’s',
  );
  assert.ok(plain.functions.every((f) => f.runAt === undefined));
  assert.equal(plain.codeEnd, 0x0800_012a);
  assert.equal(mapped.codeEnd, OVERRIDE.span.end);
  const decoded = decodeAnalysis([...encodeAnalysis(mapped)].join(''));
  assert.ok(decoded.ok);
  assert.equal(decoded.result.functions.find((f) => f.entry === START)?.runAt, RUN, 'the codec keeps runAt');
});

test('confirm: a listed entry inside the range carries its run address too', () => {
  const plain = run({});
  const seeds = [...plain.functions.map((f) => ({ entry: f.entry, mode: f.mode, rule: 'seed.listed' as const })), { entry: START, mode: 'arm' as const, rule: 'seed.listed' as const }];
  const r = run({ mode: 'confirm', seeds, overrides: [OVERRIDE] });
  assert.equal(r.mode, 'confirm');
  assert.equal(r.functions.find((f) => f.entry === START)?.runAt, RUN);
  assert.deepEqual(r.mode === 'confirm' ? r.unlisted : [], []);
});
