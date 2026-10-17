import assert from 'node:assert/strict';
import { test } from 'node:test';

import pointerTableRun from '../../../../src/core/analysis/rules/accept/pointer-table-run.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { AnalysisView, Candidate } from '../../../../src/core/analysis/types.ts';
import type { CompilerProfile } from '../../../../src/core/profile/types.ts';
import type { RuleId } from '../../../../src/core/provenance/rule-id.ts';
import type { Addr } from '../../../../src/foundation/rom/span.ts';
import { readingOf, romWith, testProfile, viewWith, words } from '../../../helpers/analysis.ts';

const TABLE = 0x0800_0300;
const [A, B, C, X] = [0x0800_0400, 0x0800_0410, 0x0800_0420, 0x0800_0430] as const;
const E = 0x0800_0440;

interface Setup {
  readonly table: readonly Addr[];
  readonly functions?: readonly Addr[];
  readonly valid?: readonly Addr[];
  readonly codeAt?: Addr;
  readonly profile?: CompilerProfile;
  readonly proposedBy?: RuleId;
}

/** The verdict for E named from `table` (Thumb pointers from TABLE), and the entries asked of the validity service. */
function run(s: Setup): { held: ReturnType<typeof pointerTableRun.holds>; asked: Addr[] } {
  const rom = romWith([{ at: TABLE, bytes: words(...s.table.map((t) => t + 1)) }], { size: 0x800 });
  const asked: Addr[] = [];
  const base = viewWith({
    rom,
    functions: s.functions ?? [],
    claims: s.codeAt === undefined ? [] : [{ span: { start: s.codeAt, end: s.codeAt + 4 }, kind: Claim.code }],
    ...(s.profile === undefined ? {} : { profile: s.profile }),
  });
  const v: AnalysisView = { ...base, valid: (a) => (asked.push(a), (s.valid ?? []).includes(a)) };
  const c: Candidate = { entry: E, mode: 'thumb', proposedBy: s.proposedBy ?? 'seed.data-pointer', cites: [E] };
  return { held: pointerTableRun.holds(c, readingOf(rom, { entry: E }), v), asked };
}

test('a data pointer in a run of three pointers to code holds; the run grows below, then above, and stops when long enough', () => {
  const { held, asked } = run({ table: [A, E, B, C], functions: [B], valid: [A, C] });
  assert.deepEqual(held, { rule: 'accept.pointer-table-run', round: 0, cites: [E, TABLE + 4], note: 'in a pointer table' });
  assert.deepEqual(asked, [A], 'B is a function, so valid() is never asked for it; C is never reached');
});

test('the boundary at pointerTableRun: a run of two does not hold under agbcc, and holds when the profile asks for two', () => {
  assert.equal(run({ table: [X, E, B], functions: [B] }).held, undefined);
  assert.notEqual(run({ table: [X, E, B], functions: [B], profile: { ...testProfile(), pointerTableRun: 2 } }).held, undefined);
});

test('a referring word claimed as code, or a candidate proposed by another rule, does not hold', () => {
  assert.equal(run({ table: [A, E, B], functions: [A, B], codeAt: TABLE + 4 }).held, undefined);
  assert.equal(run({ table: [A, E, B], functions: [A, B], proposedBy: 'seed.pool-pointer' }).held, undefined);
  assert.equal(pointerTableRun.reason, 'unanchored');
});
