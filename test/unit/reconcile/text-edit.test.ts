// applyTextEdits (architecture §3.4, §6.6): non-overlapping edits by UTF-16 offset, insertions at one offset in their
// given order; an edit outside the text or overlapping another is the planner's bug (RomliftInvariantError). The
// reconciler's TextEdit is the one FileEntry carries (core/emit/tree.ts): each is assignable to the other.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TextEdit as EmitTextEdit } from '../../../src/core/emit/tree.ts';
import { applyTextEdits } from '../../../src/core/reconcile/text-edit.ts';
import type { TextEdit } from '../../../src/core/reconcile/text-edit.ts';
import { RomliftInvariantError } from '../../../src/foundation/diagnostics/diagnostic.ts';

test('edits apply by offset in any given order; insertions at one offset keep their order', () => {
  const edits: TextEdit[] = [
    { start: 11, end: 11, text: '!', reason: 'add-stub' },
    { start: 0, end: 5, text: 'HELLO', reason: 'add-stub' },
    { start: 6, end: 6, text: '2', reason: 'add-stub' },
    { start: 6, end: 6, text: '3', reason: 'add-stub' },
  ];
  assert.equal(applyTextEdits('hello world', edits), 'HELLO 23world!');
  assert.equal(applyTextEdits('abc', []), 'abc');
  assert.equal(applyTextEdits('', [{ start: 0, end: 0, text: 'x', reason: 'add-stub' }]), 'x');
  assert.equal(applyTextEdits('a\u{1F600}b', [{ start: 3, end: 4, text: 'B', reason: 'add-stub' }]), 'a\u{1F600}B', 'UTF-16 offsets');
});

test('an edit outside the text, reversed or overlapping another throws RomliftInvariantError', () => {
  assert.throws(() => applyTextEdits('abc', [{ start: 2, end: 4, text: '', reason: 'remove-stub' }]), RomliftInvariantError);
  assert.throws(() => applyTextEdits('abc', [{ start: 2, end: 1, text: '', reason: 'remove-stub' }]), RomliftInvariantError);
  assert.throws(() => applyTextEdits('abc', [{ start: -1, end: 0, text: '', reason: 'remove-stub' }]), RomliftInvariantError);
  assert.throws(() => applyTextEdits('abc', [{ start: 0.5, end: 1, text: '', reason: 'remove-stub' }]), RomliftInvariantError);
  assert.throws(() => applyTextEdits('abc', [{ start: 0, end: 2, text: '', reason: 'remove-stub' }, { start: 1, end: 3, text: '', reason: 'remove-stub' }]), RomliftInvariantError);
});

test('the reconciler\'s TextEdit and core/emit/tree.ts\'s are one shape', () => {
  const edit: TextEdit = { start: 0, end: 0, text: 'x', reason: 'add-header' };
  const carried: EmitTextEdit = edit;
  const back: TextEdit = carried;
  assert.deepEqual(back, edit);
});
