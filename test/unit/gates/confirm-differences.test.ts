// viewDifferences and judgeDifferences, what g2.confirm-equals-discover decides with (test/gates/confirm-differences.ts, D61 e).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { judgeDifferences, KNOWN_DIFFERENCES, viewDifferences, type ParityView, type ViewFunction } from '../../gates/confirm-differences.ts';

const fn = (entry: number, end: number, far: ViewFunction['far'] = []): ViewFunction => ({ entry, mode: 'thumb', extent: { start: entry, end }, far });

const SIX = KNOWN_DIFFERENCES['tmc']?.functions ?? [];

/** Both views with the six known tmc functions differing in extent (confirm cuts them), plus `extra` functions equal in both. */
function views(over: { readonly confirmExtra?: readonly ViewFunction[]; readonly claimOutside?: boolean } = {}): { discover: ParityView; confirm: ParityView } {
  const discover: ParityView = {
    functions: [fn(0x0800_1000, 0x0800_1010), ...SIX.map((e) => fn(e, e + 0x40))],
    claims: [{ span: { start: 0x0800_1000, end: 0x0800_1010 }, kind: 1, owner: 0x0800_1000 }, ...SIX.map((e) => ({ span: { start: e, end: e + 0x40 }, kind: 1, owner: e }))],
  };
  const confirm: ParityView = {
    functions: [fn(0x0800_1000, over.claimOutside === true ? 0x0800_1010 : 0x0800_1010), ...SIX.map((e) => fn(e, e + 0x10)), ...(over.confirmExtra ?? [])],
    claims: [
      { span: { start: 0x0800_1000, end: over.claimOutside === true ? 0x0800_100c : 0x0800_1010 }, kind: 1, owner: 0x0800_1000 },
      ...SIX.flatMap((e) => [{ span: { start: e, end: e + 0x10 }, kind: 1, owner: e }, { span: { start: e + 0x10, end: e + 0x40 }, kind: 1 }]),
    ],
  };
  return { discover, confirm };
}

test('the known limitation is exactly the six functions Q3 named, on tmc only', () => {
  assert.deepEqual(Object.keys(KNOWN_DIFFERENCES), ['tmc']);
  assert.deepEqual(SIX.map((a) => a.toString(16)), ['8004274', '80042b8', '80042ba', '80043ac', '8008790', '80b1a8c']);
});

test('equal views have no difference; any difference fails a ROM without a known limitation', () => {
  const v = views();
  assert.deepEqual(viewDifferences(v.discover, v.discover), { functions: [], claims: [] });
  assert.deepEqual(judgeDifferences('sa2', viewDifferences(v.discover, v.discover), { discover: v.discover, confirm: v.discover }), { problems: [] });
  const d = viewDifferences(v.discover, v.confirm);
  assert.deepEqual(d.functions, [...SIX]);
  const sa2 = judgeDifferences('sa2', d, v);
  assert.equal(sa2.problems.length, 1);
  assert.match(sa2.problems[0] ?? '', /^sa2: function 0x08004274: discover /);
  // A far verdict alone is a difference too.
  const far = viewDifferences({ functions: [fn(0x0800_1000, 0x0800_1010)], claims: [] }, { functions: [fn(0x0800_1000, 0x0800_1010, [{ site: 1, target: 2 }])], claims: [] });
  assert.deepEqual(far.functions, [0x0800_1000]);
});

test('tmc passes with exactly its six functions and their claims, and prints them', () => {
  const v = views();
  const j = judgeDifferences('tmc', viewDifferences(v.discover, v.confirm), v);
  assert.deepEqual(j.problems, []);
  assert.match(j.note ?? '', /^tmc: 6 known functions differ \(0x08004274, 0x080042B8, 0x080042BA, 0x080043AC, 0x08008790, 0x080B1A8C\) with \d+ claim runs inside their extents: known phase-2 limitation .*Build resettle, else accept.*D61 e$/);
});

test('tmc fails on a seventh function, a claim outside the six, or a known difference gone', () => {
  const seventh = views({ confirmExtra: [fn(0x080b_255c, 0x080b_280c)] });
  const a = judgeDifferences('tmc', viewDifferences(seventh.discover, seventh.confirm), seventh);
  assert.equal(a.problems.length, 1);
  assert.match(a.problems[0] ?? '', /^tmc: functions differ beyond the known limitation \(D61 e, 6 functions\): 0x080B255C \(not covered: .*owner question Q6/);
  const outside = views({ claimOutside: true });
  const b = judgeDifferences('tmc', viewDifferences(outside.discover, outside.confirm), outside);
  assert.ok(b.problems.some((p) => /^tmc: claim runs differ outside the known functions' extents: 0x08001000\.\.0x0800100C/.test(p)));
  const v = views();
  const fewer = { discover: v.discover, confirm: { ...v.confirm, functions: v.confirm.functions.map((f) => (f.entry === SIX[0] ? fn(f.entry, f.entry + 0x40) : f)) } };
  const c = judgeDifferences('tmc', viewDifferences(fewer.discover, fewer.confirm), fewer);
  assert.ok(c.problems.some((p) => p === 'tmc: known differences no longer differ, the record is stale (D61 e): 0x08004274'));
});
