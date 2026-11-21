// seed -> accept -> queue callees, the ascending worklist, claims,
// and the end-to-end run of analyze's driver on a fake registry.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { runAnalysis } from '../../../../src/core/analysis/driver/run.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { AnalysisOptions, AnalysisTuning } from '../../../../src/core/analysis/types.ts';
import type { TrailEvent } from '../../../../src/core/provenance/trail.ts';
import { canonicalJson } from '../../../../src/foundation/formats/canonical-json.ts';
import type { JsonValue } from '../../../../src/foundation/formats/types.ts';
import { BASE, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { armAt } from '../../../helpers/arm.ts';
import { calls, extent, romEntry } from './fakes.ts';

const INIT = 0x0800_00c0;
const OPTIONS: AnalysisOptions = { mode: 'discover', seeds: [], overrides: [], trail: 'full' };

function setup() {
  const rom = romWith(
    [
      { at: INIT, bytes: armAt(INIT)`bl _08000100; bl _08000140; bx lr` },
      { at: 0x0800_0100, bytes: armAt(0x0800_0100)`bx lr` },
      { at: 0x0800_0140, bytes: armAt(0x0800_0140)`bx lr` },
    ],
    { entry: INIT },
  );
  const profile = testProfile({ seed: ['seed.rom-entry'], queue: ['seed.call'], claim: ['claim.adjacent-pools'] });
  const reg = registry(romEntry, calls, extent);
  return { rom, profile, reg };
}

function run(tuning: Partial<AnalysisTuning> = {}): { result: ReturnType<typeof runAnalysis>; events: TrailEvent[] } {
  const { rom, profile, reg } = setup();
  const events: TrailEvent[] = [];
  const result = runAnalysis(rom, profile, OPTIONS, tuningFor(profile, reg, tuning), reg, {
    event: (e) => events.push(e),
  });
  return { result, events };
}

const hex = (a: number): string => `0x${a.toString(16)}`;

test('the seeds are accepted, then everything their readings call, least address first', () => {
  const { result, events } = run();
  assert.deepEqual(
    result.functions.map((f) => [hex(f.entry), f.mode, f.origin]),
    [
      ['0x8000000', 'arm', 'rom-entry'],
      ['0x80000c0', 'arm', 'rom-entry'],
      ['0x8000100', 'arm', 'call'],
      ['0x8000140', 'arm', 'call'],
    ],
  );
  const accepted = events.filter((e) => e.kind === 'accept').map((e) => hex(e.at));
  assert.deepEqual(
    accepted,
    ['0x8000000', '0x8000100', '0x8000140', '0x80000c0'],
    'the entry branch walks into init: its callees pop by the ascending key',
  );
  assert.equal(result.functions[0]?.accepted.rule, 'seed.rom-entry');
  assert.equal(result.mode, 'discover');
});

test('claims: instruction bytes are code, runs split at extents with the innermost owner', () => {
  const { result } = run();
  const code = result.claims
    .filter((c) => c.kind === Claim.code)
    .map((c) => [hex(c.span.start), hex(c.span.end), c.owner === undefined ? '-' : hex(c.owner)]);
  assert.deepEqual(code, [
    ['0x8000000', '0x8000004', '0x8000000'],
    ['0x80000c0', '0x80000cc', '0x80000c0'],
    ['0x8000100', '0x8000104', '0x8000100'],
    ['0x8000140', '0x8000144', '0x8000140'],
  ]);
  assert.equal(result.codeEnd, 0x0800_0144);
  const init = result.functions.find((f) => f.entry === INIT);
  assert.deepEqual(
    init?.calls.map((c) => hex(c.target)),
    ['0x8000100', '0x8000140'],
  );
  assert.deepEqual(init?.code, [{ start: INIT, end: INIT + 12 }]);
});

test('a disabled rule is skipped', () => {
  const { result } = run({ disabled: ['seed.call'] });
  assert.deepEqual(
    result.functions.map((f) => hex(f.entry)),
    ['0x8000000', '0x80000c0'],
  );
});

test('the run is deterministic and its outputs sorted', () => {
  const digest = (): string => {
    const h = createHash('sha256');
    for (const chunk of canonicalJson(JSON.parse(JSON.stringify(run().result)) as JsonValue)) h.update(chunk);
    return h.digest('hex');
  };
  assert.equal(digest(), digest());
  const { result } = run();
  const entries = result.functions.map((f) => f.entry);
  assert.deepEqual(
    entries,
    [...entries].sort((a, b) => a - b),
  );
  const starts = result.claims.map((c) => c.span.start);
  assert.deepEqual(
    starts,
    [...starts].sort((a, b) => a - b),
  );
  assert.equal(result.schema, 'romlift/analysis@1');
  assert.equal(result.profile, 'test');
  assert.deepEqual(result.rom, { sha1: 'test', end: BASE + 0x400 });
});
