// planEdits (architecture §6.4 step 3, D17; rename's writes, phase 6, D92): the reconciled policy of planWrites alone.
// An edit over its base sha1 is an `edit` op, a stale or vanished file E_STALE_EDIT, an edit the journal shows done a
// `keep`; no generated path is deleted or warned about, and the manifest is the one given, unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { applyTextEdits, planEdits, planHasErrors, UNKNOWN_ROMLIFT_VERSION } from '../../../src/core/write-plan/plan-writes.ts';
import type { EditPlanInputs } from '../../../src/core/write-plan/plan-writes.ts';
import type { DiskFileState, Manifest } from '../../../src/core/write-plan/types.ts';

/** A deterministic stand-in for SHA-1. */
function fakeHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(40, '0');
}

type Reconciled = Extract<FileEntry, { readonly ownership: 'reconciled' }>;

const TEXT = 'void Old(void);\n';
const EDIT: Reconciled = { ownership: 'reconciled', path: 'src/main.c', baseSha1: fakeHash(TEXT), edits: [{ start: 5, end: 8, text: 'New', reason: 'rename-identifier' }] };
const MANIFEST: Manifest = { schema: 1, romlift: '1.2.3', files: { 'asm/nonmatchings/main/Old.s': { sha1: fakeHash('x'), writer: 'function' } } };

function inputs(partial: Partial<EditPlanInputs> = {}): EditPlanInputs {
  const disk = new Map<string, DiskFileState>([
    ['src/main.c', { kind: 'present', sha1: fakeHash(TEXT) }],
    ['asm/nonmatchings/main/Old.s', { kind: 'present', sha1: fakeHash('x') }],
    ['asm/stray.s', { kind: 'present', sha1: fakeHash('y') }],
  ]);
  return { entries: [EDIT], manifest: MANIFEST, disk, reconciledTexts: new Map([['src/main.c', TEXT]]), hash: fakeHash, ...partial };
}

test('an edit over its base: one edit op with the result text; nothing deleted or warned; the manifest unchanged', () => {
  const plan = planEdits(inputs());
  assert.deepEqual(plan.diagnostics, []);
  const result = applyTextEdits(TEXT, EDIT.edits);
  assert.deepEqual(plan.ops, [{ op: 'edit', path: 'src/main.c', baseSha1: fakeHash(TEXT), resultSha1: fakeHash(result), text: 'void New(void);\n' }]);
  assert.equal(plan.manifest, MANIFEST, 'the manifest on disk, as it is');
});

test('a file changed or gone since the plan read it is E_STALE_EDIT, and the plan must not be applied', () => {
  const changed = planEdits(inputs({ disk: new Map([['src/main.c', { kind: 'present', sha1: fakeHash('other') }]]) }));
  assert.ok(planHasErrors(changed));
  assert.deepEqual(changed.diagnostics.map((d) => [d.code, d.path]), [['E_STALE_EDIT', 'src/main.c']]);
  const gone = planEdits(inputs({ disk: new Map([['src/main.c', { kind: 'absent' }]]) }));
  assert.deepEqual(gone.diagnostics.map((d) => d.code), ['E_STALE_EDIT']);
  const unread = planEdits(inputs({ reconciledTexts: new Map([['src/main.c', 'not the base']]) }));
  assert.deepEqual(unread.diagnostics.map((d) => d.code), ['E_STALE_EDIT']);
});

test('an edit the journal shows done is a keep; edits that change nothing are a keep', () => {
  const result = applyTextEdits(TEXT, EDIT.edits);
  const done = planEdits(inputs({ disk: new Map([['src/main.c', { kind: 'present', sha1: fakeHash(result) }]]), journal: { schema: 1, ops: [{ op: 'edit', path: 'src/main.c', baseSha1: fakeHash(TEXT), resultSha1: fakeHash(result) }] } }));
  assert.deepEqual(done.ops, [{ op: 'keep', path: 'src/main.c', sha1: fakeHash(result) }]);
  const same = planEdits(inputs({ entries: [{ ...EDIT, edits: [{ start: 5, end: 8, text: 'Old', reason: 'rename-identifier' }] }] }));
  assert.deepEqual(same.ops, [{ op: 'keep', path: 'src/main.c', sha1: fakeHash(TEXT) }]);
});

test('without a manifest the plan carries an empty one stamped with the given version', () => {
  assert.deepEqual(planEdits(inputs({ manifest: null, romlift: '9.9.9' })).manifest, { schema: 1, romlift: '9.9.9', files: {} });
  assert.deepEqual(planEdits(inputs({ manifest: null })).manifest, { schema: 1, romlift: UNKNOWN_ROMLIFT_VERSION, files: {} });
});

test('the invariants of planWrites: a path twice, a path missing from the snapshot', () => {
  assert.throws(() => planEdits(inputs({ entries: [EDIT, EDIT] })), /twice/);
  assert.throws(() => planEdits(inputs({ disk: new Map() })), /no entry for the tree path/);
});
