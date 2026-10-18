// viewDifferences and judgeDifferences, what g2.confirm-equals-discover decides with (test/gates/confirm-differences.ts, D61 e).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  judgeDifferences,
  KNOWN_DIFFERENCES,
  staleRecords,
  viewDifferences,
  type KnownDifferences,
  type ParityView,
  type ViewClaim,
  type ViewFunction,
} from '../../gates/confirm-differences.ts';
import { TMC_AT_D61 } from '../../gates/dataset-binding.ts';

const fn = (entry: number, end: number, far: ViewFunction['far'] = []): ViewFunction => ({ entry, mode: 'thumb', extent: { start: entry, end }, far });

const TMC: KnownDifferences = KNOWN_DIFFERENCES['tmc'] ?? assert.fail('no tmc record');
const EIGHT = TMC.functions;
const OTHER = { sha1: 'a'.repeat(40), elfSha256: 'b'.repeat(64) };

/**
 * Views whose differences are exactly tmc's recorded ones (each known function's discover and confirm
 * records, the known claim run), plus a function and a claim run equal in both. `edit` changes the confirm view.
 */
function views(edit: (confirm: { functions: ViewFunction[]; claims: ViewClaim[] }) => void = () => {}): { discover: ParityView; confirm: ParityView } {
  const same = fn(0x0800_1000, 0x0800_1010);
  const sameClaim: ViewClaim = { span: { start: 0x0800_1000, end: 0x0800_1010 }, kind: 1, owner: 0x0800_1000 };
  const discover: ParityView = {
    functions: [same, ...EIGHT.flatMap((f) => (f.discover === null ? [] : [f.discover]))],
    claims: [sameClaim, ...TMC.claims.flatMap((c) => (c.discover === null ? [] : [c.discover]))],
  };
  const confirm = {
    functions: [same, ...EIGHT.flatMap((f) => (f.confirm === null ? [] : [f.confirm]))],
    claims: [sameClaim, ...TMC.claims.flatMap((c) => (c.confirm === null ? [] : [c.confirm]))],
  };
  edit(confirm);
  return { discover, confirm };
}

function judge(v: { readonly discover: ParityView; readonly confirm: ParityView }): ReturnType<typeof judgeDifferences> {
  return judgeDifferences('tmc', TMC_AT_D61, viewDifferences(v.discover, v.confirm));
}

const FIRST = EIGHT[0] ?? assert.fail('no first known function');
const SECOND = EIGHT[1] ?? assert.fail('no second known function');

test('the known limitation is exactly the six functions Q3 named, the two Q6 added and four claim runs, on tmc only, pinned by content', () => {
  assert.deepEqual(Object.keys(KNOWN_DIFFERENCES), ['tmc']);
  assert.deepEqual(EIGHT.map((f) => f.entry.toString(16)), ['8004274', '80042b8', '80042ba', '80043ac', '8008790', '80b1a8c', '80b255c', '80b2874']);
  for (const f of EIGHT) assert.ok(f.discover !== null && f.confirm !== null, `${f.entry.toString(16)} is in both views`);
  assert.deepEqual(TMC.claims.map((c) => [c.span.start.toString(16), c.span.end.toString(16)]), [
    ['80087d2', '8008886'],
    ['80b2874', '80b289c'],
    ['80b2874', '80b299c'],
    ['80b289c', '80b299c'],
  ]);
  assert.deepEqual(TMC.rom, TMC_AT_D61);
});

test('equal views have no difference; any difference fails a ROM without a known limitation, with its counts', () => {
  const v = views();
  assert.deepEqual(viewDifferences(v.discover, v.discover), { functions: [], claims: [] });
  assert.deepEqual(judgeDifferences('sa2', OTHER, viewDifferences(v.discover, v.discover)), { problems: [] });
  const d = viewDifferences(v.discover, v.confirm);
  assert.deepEqual(d.functions.map((f) => f.entry), EIGHT.map((f) => f.entry));
  const sa2 = judgeDifferences('sa2', OTHER, d);
  assert.equal(sa2.problems.length, 1);
  assert.match(sa2.problems[0] ?? '', /^sa2: 8 functions and 4 claim runs differ: function 0x08004274: discover 0x08004274 thumb 0x08004274\.\.0x08004356, confirm 0x08004274 thumb 0x08004274\.\.0x080042AC; .*; …$/);
  assert.equal(sa2.note, undefined);
  // A far verdict alone is a difference too.
  const far = viewDifferences({ functions: [fn(0x0800_1000, 0x0800_1010)], claims: [] }, { functions: [fn(0x0800_1000, 0x0800_1010, [{ site: 1, target: 2 }])], claims: [] });
  assert.deepEqual(far.functions.map((f) => f.entry), [0x0800_1000]);
});

test('tmc passes with exactly its recorded differences, and prints them', () => {
  const j = judge(views());
  assert.deepEqual(j.problems, []);
  assert.match(
    j.note ?? '',
    /^tmc: 8 of 8 known functions differ as recorded \(0x08004274, 0x080042B8, 0x080042BA, 0x080043AC, 0x08008790, 0x080B1A8C, 0x080B255C, 0x080B2874\), 4 of 4 known claim runs \(0x080087D2\.\.0x08008886, 0x080B2874\.\.0x080B289C, 0x080B2874\.\.0x080B299C, 0x080B289C\.\.0x080B299C\): known phase-2 limitation .*Build resettle, else accept.*Yes, cover all 8.*D61 e$/,
  );
});

test('tmc fails when a known function changes its extent, mode or far verdicts, or vanishes from confirm', () => {
  const e = FIRST.entry;
  const extent = judge(views((c) => (c.functions = c.functions.map((f) => (f.entry === e ? fn(e, e + 4) : f)))));
  assert.deepEqual(extent.problems, [
    'tmc: 1 known differences changed (D61 e): function 0x08004274: discover 0x08004274 thumb 0x08004274..0x08004356, confirm 0x08004274 thumb 0x08004274..0x08004278 (recorded: function 0x08004274: discover 0x08004274 thumb 0x08004274..0x08004356, confirm 0x08004274 thumb 0x08004274..0x080042AC)',
  ]);
  const mode = judge(views((c) => (c.functions = c.functions.map((f) => (f.entry === e ? { ...f, mode: 'arm' } : f)))));
  assert.equal(mode.problems.length, 1);
  assert.match(mode.problems[0] ?? '', /^tmc: 1 known differences changed \(D61 e\): function 0x08004274: discover .*, confirm 0x08004274 arm /);
  const far = judge(views((c) => (c.functions = c.functions.map((f) => (f.entry === e ? { ...f, far: [{ site: e + 2, target: 0x0800_0100 }] } : f)))));
  assert.equal(far.problems.length, 1);
  assert.match(far.problems[0] ?? '', /changed .* far 0x08004276->0x08000100 \(recorded: /);
  const vanished = judge(views((c) => (c.functions = c.functions.filter((f) => f.entry !== SECOND.entry))));
  assert.equal(vanished.problems.length, 1);
  assert.match(vanished.problems[0] ?? '', /^tmc: 1 known differences changed \(D61 e\): function 0x080042B8: discover 0x080042B8 thumb .*, confirm none \(recorded: /);
});

test('tmc fails on a ninth differing function, wherever it lies, and still prints the eight', () => {
  // A ninth function in the class of Q6 (an ARM entry between the two Q6 added), and one elsewhere.
  const ninth = judge(views((c) => c.functions.push({ ...fn(0x080b_2700, 0x080b_2710), mode: 'arm' })));
  assert.deepEqual(ninth.problems, ['tmc: 1 functions differ, not covered by D61 e: function 0x080B2700: discover none, confirm 0x080B2700 arm 0x080B2700..0x080B2710']);
  assert.match(ninth.note ?? '', /^tmc: 8 of 8 known functions differ as recorded/);
  const other = judge(views((c) => c.functions.push(fn(0x0800_2000, 0x0800_2010))));
  assert.deepEqual(other.problems, ['tmc: 1 functions differ, not covered by D61 e: function 0x08002000: discover none, confirm 0x08002000 thumb 0x08002000..0x08002010']);
  // Six uncovered functions: the count and the first four, never one line each (code-quality-r1-5).
  const six = judge(views((c) => c.functions.push(...[0, 1, 2, 3, 4, 5].map((i) => fn(0x0800_2000 + 0x20 * i, 0x0800_2010 + 0x20 * i)))));
  assert.equal(six.problems.length, 1);
  assert.match(six.problems[0] ?? '', /^tmc: 6 functions differ, not covered by D61 e: function 0x08002000: .*; function 0x08002060: discover none, confirm 0x08002060 thumb 0x08002060\.\.0x08002070; …$/);
  assert.equal((six.problems[0] ?? '').split('; function ').length, 4);
});

test('tmc fails on a claim run beyond the recorded one, even inside a known extent, or on the recorded one changed', () => {
  const inside = judge(views((c) => c.claims.push({ span: { start: 0x0800_4280, end: 0x0800_4290 }, kind: 1 })));
  assert.deepEqual(inside.problems, ['tmc: 1 claim runs differ, not covered by D61 e: claim 0x08004280..0x08004290: discover none, confirm 0x08004280..0x08004290 kind 1 owner none']);
  const kind = judge(views((c) => (c.claims = c.claims.map((x) => (x.span.start === 0x0800_87d2 ? { ...x, kind: 2 } : x)))));
  assert.equal(kind.problems.length, 1);
  assert.match(kind.problems[0] ?? '', /^tmc: 1 known claim differences changed \(D61 e\): claim 0x080087D2\.\.0x08008886: discover .*, confirm 0x080087D2\.\.0x08008886 kind 2 owner none \(recorded: /);
  const same = judge(views((c) => (c.claims = c.claims.map((x) => (x.span.start === 0x0800_87d2 ? { ...x, owner: 0x0800_8790 } : x)))));
  assert.deepEqual(same.problems, ['tmc: known claim differences no longer differ, the record is stale (D61 e): 0x080087D2..0x08008886']);
});

test('a known difference gone is a stale record: one of the six, or all of them (equal views)', () => {
  const discover = FIRST.discover ?? assert.fail('no discover record');
  const one = judge(views((c) => (c.functions = c.functions.map((f) => (f.entry === FIRST.entry ? discover : f)))));
  assert.deepEqual(one.problems, ['tmc: known differences no longer differ, the record is stale (D61 e): 0x08004274']);
  const v = views();
  const all = judgeDifferences('tmc', TMC_AT_D61, viewDifferences(v.discover, v.discover));
  assert.deepEqual(all.problems, [
    'tmc: known differences no longer differ, the record is stale (D61 e): 0x08004274, 0x080042B8, 0x080042BA, 0x080043AC, 0x08008790, 0x080B1A8C, 0x080B255C, 0x080B2874',
    'tmc: known claim differences no longer differ, the record is stale (D61 e): 0x080087D2..0x08008886, 0x080B2874..0x080B289C, 0x080B2874..0x080B299C, 0x080B289C..0x080B299C',
  ]);
  assert.match(all.note ?? '', /^tmc: 0 of 8 known functions differ as recorded/);
});

test('the record holds only for the dataset it was decided on, and only while that dataset is a tuning ROM', () => {
  const v = views();
  const rebuilt = judgeDifferences('tmc', { ...TMC_AT_D61, elfSha256: '0'.repeat(64) }, viewDifferences(v.discover, v.confirm));
  assert.equal(rebuilt.problems.length, 2);
  assert.match(rebuilt.problems[0] ?? '', /^tmc: the D61 e scoping was decided on ROM SHA-1 b4bd50e4.* the scoping is stale, a new owner decision is needed$/);
  assert.match(rebuilt.problems[1] ?? '', /^tmc: 8 functions and 4 claim runs differ: /);
  assert.equal(rebuilt.note, undefined);
  const otherRegion = judgeDifferences('tmc', { sha1: 'c'.repeat(40), elfSha256: TMC_AT_D61.elfSha256 }, viewDifferences(v.discover, v.discover));
  assert.equal(otherRegion.problems.length, 1);
  assert.deepEqual(staleRecords(['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3', 'tmc']), []);
  assert.deepEqual(staleRecords(['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3']), ['tmc: a known limitation (D61 e) is recorded but tmc is not a tuning dataset, the record is stale']);
});
