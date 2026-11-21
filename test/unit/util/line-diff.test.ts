// foundation/util/line-diff.ts (architecture-5, architecture-r1-7, D76 h): the unified diff `update`
// prints, by line, with three lines of context; equal texts give no diff.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { unifiedDiff } from '../../../src/foundation/util/line-diff.ts';

const lines = (n: number, change?: { readonly at: number; readonly text: string }): string =>
  Array.from({ length: n }, (_, i) => (change !== undefined && i === change.at ? change.text : `l${i + 1}`)).join(
    '\n',
  ) + '\n';

test('equal texts give the empty string', () => {
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n', 'x.toml'), '');
  assert.equal(unifiedDiff('', '', 'x.toml'), '');
});

test('one changed line: one hunk with three lines of context each side, labelled a/ and b/', () => {
  assert.equal(
    unifiedDiff(lines(10), lines(10, { at: 4, text: 'five' }), 'romlift.toml'),
    [
      '--- a/romlift.toml',
      '+++ b/romlift.toml',
      '@@ -2,7 +2,7 @@',
      ' l2',
      ' l3',
      ' l4',
      '-l5',
      '+five',
      ' l6',
      ' l7',
      ' l8',
      '',
    ].join('\n'),
  );
});

test('an addition to an empty text, and a deletion of everything', () => {
  assert.equal(unifiedDiff('', 'a\n', 'f'), '--- a/f\n+++ b/f\n@@ -0,0 +1,1 @@\n+a\n');
  assert.equal(unifiedDiff('a\nb\n', '', 'f'), '--- a/f\n+++ b/f\n@@ -1,2 +0,0 @@\n-a\n-b\n');
});

test('changes far apart are two hunks; changes within the context are one', () => {
  const before = lines(20);
  const far = unifiedDiff(before, lines(20, { at: 1, text: 'x' }).replace('l18\n', 'y\n'), 'f');
  assert.equal((far.match(/^@@ /gm) ?? []).length, 2);
  const near = unifiedDiff(before, lines(20, { at: 1, text: 'x' }).replace('l6\n', 'y\n'), 'f');
  assert.equal((near.match(/^@@ /gm) ?? []).length, 1);
});
