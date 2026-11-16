// viewDifferences and judgeDifferences, what g2.confirm-equals-discover decides with (test/gates/confirm-differences.ts,
// D114): any function or claim run that differs between the two views fails the ROM, whichever ROM it is.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { judgeDifferences, viewDifferences, type ParityView, type ViewFunction } from '../../gates/confirm-differences.ts';

const fn = (entry: number, end: number, far: ViewFunction['far'] = []): ViewFunction => ({ entry, mode: 'thumb', extent: { start: entry, end }, far });

const BASE: ParityView = {
  functions: [fn(0x0800_1000, 0x0800_1010), fn(0x0800_1010, 0x0800_1040)],
  claims: [
    { span: { start: 0x0800_1000, end: 0x0800_1010 }, kind: 1, owner: 0x0800_1000 },
    { span: { start: 0x0800_1010, end: 0x0800_1040 }, kind: 1, owner: 0x0800_1010 },
  ],
};

test('equal views have no difference and pass', () => {
  assert.deepEqual(viewDifferences(BASE, BASE), { functions: [], claims: [] });
  assert.deepEqual(judgeDifferences('tmc', viewDifferences(BASE, BASE)), { problems: [] });
});

test('an extent, a mode, a far verdict or a missing function is a difference, and fails any ROM with its counts', () => {
  const cases: ParityView[] = [
    { ...BASE, functions: [fn(0x0800_1000, 0x0800_1008), BASE.functions[1] as ViewFunction] },
    { ...BASE, functions: [{ ...(BASE.functions[0] as ViewFunction), mode: 'arm' }, BASE.functions[1] as ViewFunction] },
    { ...BASE, functions: [fn(0x0800_1000, 0x0800_1010, [{ site: 0x0800_1004, target: 0x0800_1100 }]), BASE.functions[1] as ViewFunction] },
    { ...BASE, functions: [BASE.functions[1] as ViewFunction] },
  ];
  for (const confirm of cases) {
    const d = viewDifferences(BASE, confirm);
    assert.equal(d.functions.length, 1);
    for (const name of ['tmc', 'sa2']) {
      const { problems } = judgeDifferences(name, d);
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? '', new RegExp(`^${name}: 1 functions and 0 claim runs differ: function 0x08001000: discover `));
    }
  }
});

test('a claim run that differs in kind or owner, or exists in one view only, fails too', () => {
  const owner = viewDifferences(BASE, { ...BASE, claims: [BASE.claims[0] as ParityView['claims'][number], { span: { start: 0x0800_1010, end: 0x0800_1040 }, kind: 1 }] });
  const extra = viewDifferences(BASE, { ...BASE, claims: [...BASE.claims, { span: { start: 0x0800_1040, end: 0x0800_1044 }, kind: 2, owner: 0x0800_1010 }] });
  for (const d of [owner, extra]) {
    assert.deepEqual([d.functions.length, d.claims.length], [0, 1]);
    assert.match(judgeDifferences('tmc', d).problems[0] ?? '', /^tmc: 0 functions and 1 claim runs differ: claim /);
  }
});
