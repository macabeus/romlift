import assert from 'node:assert/strict';
import { test } from 'node:test';

import { baselineText, diffResults, formatDiff, moved, objdiffText, summaryLine } from '../../../bench/src/report.ts';
import { results, row } from './fixtures.ts';

test('summaryLine names counts, unlisted rows and the verdicts', () => {
  const line = summaryLine(row({ misses: [{ addr: '0x08000500', name: 'm', size: 4, reason: 'inside-code', listed: false }], deterministic: false, scaffold: { ok: false } }));
  assert.match(line, /^tiny +truth +10 +found +10 +precision 100\.00% +recall 100\.00% +misses 1 \(1 unlisted\) +false 0 \(0 unlisted\) +extents 10\/10 +code end \+0 +NOT DETERMINISTIC +make FAILED$/);
});

test('diffResults lists what moved, newly missed and newly false first', () => {
  const base = results([row()]);
  const fresh = results([
    row({
      tp: 9,
      misses: [{ addr: '0x08000500', name: 'm', size: 4, reason: 'inside-code', listed: false }],
      falseEntries: [{ addr: '0x08000700', origin: 'call', size: 4, listed: false }],
    }),
  ]);
  const [d] = diffResults(fresh, base);
  assert.ok(d !== undefined && moved(d));
  assert.deepEqual(d.newMisses, ['0x08000500 m (inside-code)']);
  assert.deepEqual(d.newFalse, ['0x08000700 via call']);
  const text = formatDiff(d);
  assert.match(text, /^tiny: true positives 10 -> 9/);
  assert.ok(text.indexOf('newly missed') < text.indexOf('newly false'));
  const [same] = diffResults(base, base);
  assert.ok(same !== undefined && !moved(same));
  assert.deepEqual(diffResults(results([row({ name: 'other' })]), base), []);
});

test('baselineText prints the row and where the artifact came from', () => {
  const text = baselineText(results(), 'tiny', 'HEAD');
  assert.match(text ?? '', /^tiny .*\nbaseline: HEAD, commit none, source digest s+, Node 24, rows from poc$/);
  assert.equal(baselineText(results(), 'nope', 'HEAD'), undefined);
});

test('summaryLine says n/a for a row without a scaffold verdict', () => {
  const { scaffold: _scaffold, ...bare } = row();
  assert.match(summaryLine(bare), /make n\/a$/);
});

test('summaryLine adds the readability shares and the objdiff summary of a phase-3 row', () => {
  const readability = { mnemonicShare: 0.99, symbolicBranchShare: 1, symbolicPoolShare: 0.5, floor: null };
  const objdiff = { linked: true, scored: 4, differences: { relocation: 1, 'unnamed-target': 2 }, examples: [] };
  assert.match(summaryLine(row({ readability, objdiff })), /make OK +readability 99\.00%\/100\.00%\/50\.00% +objdiff 4 scored, 1 relocation, 2 unnamed-target$/);
  assert.equal(objdiffText({ ...objdiff, differences: {} }), '4 scored, no difference');
  assert.equal(objdiffText({ linked: false, scored: 0, differences: {}, examples: [] }), 'not linked');
});
