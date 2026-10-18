// planWrites (architecture §6.4 step 3, D17, D62 d): every ownership policy and every branch, pure, with a
// fake hash, so no test needs a file system.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RomliftInvariantError } from '../../../src/foundation/diagnostics/diagnostic.ts';
import type { FileEntry, TextEdit } from '../../../src/core/emit/tree.ts';
import type { Journal } from '../../../src/core/write-plan/journal.ts';
import { applyTextEdits, planHasErrors, planWrites, UNKNOWN_ROMLIFT_VERSION } from '../../../src/core/write-plan/plan-writes.ts';
import type { Manifest, WritePlan, WritePlanInputs } from '../../../src/core/write-plan/types.ts';

/** A deterministic 40-hex-digit stand-in for SHA-1: five FNV-1a lanes with different seeds. */
function fakeHash(text: string): string {
  let out = '';
  for (let lane = 0; lane < 5; lane++) {
    let h = (0x811c9dc5 ^ (lane * 0x9e3779b9)) >>> 0;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

function gen(path: string, text: string): FileEntry {
  return { ownership: 'generated', path, text, writer: 'function' };
}

function manifestOf(files: Readonly<Record<string, string>>, romlift = '1.0.0'): Manifest {
  const out: Record<string, { sha1: string; writer: 'function' }> = {};
  for (const [path, text] of Object.entries(files)) out[path] = { sha1: fakeHash(text), writer: 'function' };
  return { schema: 1, romlift, files: out };
}

/** A disk snapshot from texts ('absent' marks a path the snapshot names with no file). */
function diskOf(files: Readonly<Record<string, string | null>>): ReadonlyMap<string, string> {
  return new Map(Object.entries(files).map(([path, text]) => [path, text === null ? 'absent' : fakeHash(text)]));
}

function plan(partial: Partial<WritePlanInputs> & Pick<WritePlanInputs, 'entries'>): WritePlan {
  return planWrites({ manifest: null, disk: new Map(), reconciledTexts: new Map(), hash: fakeHash, retained: [], ...partial });
}

function codes(p: WritePlan): readonly string[] {
  return p.diagnostics.map((d) => `${d.code} ${d.path ?? ''}`);
}

test('generated: absent is written, the same sha1 is kept, both enter the manifest', () => {
  const p = plan({
    entries: [gen('asm/a.s', 'A'), gen('asm/b.s', 'B')],
    disk: diskOf({ 'asm/a.s': null, 'asm/b.s': 'B' }),
  });
  assert.deepEqual(p.ops, [
    { op: 'write', path: 'asm/a.s', text: 'A', sha1: fakeHash('A'), writer: 'function' },
    { op: 'keep', path: 'asm/b.s', sha1: fakeHash('B') },
  ]);
  assert.deepEqual(p.manifest.files, {
    'asm/a.s': { sha1: fakeHash('A'), writer: 'function' },
    'asm/b.s': { sha1: fakeHash('B'), writer: 'function' },
  });
  assert.deepEqual(p.diagnostics, []);
  assert.equal(planHasErrors(p), false);
});

test('generated: different content is overwritten when the manifest lists it', () => {
  const p = plan({
    entries: [gen('tools/gen.s', 'new')],
    manifest: manifestOf({ 'tools/gen.s': 'old' }),
    disk: diskOf({ 'tools/gen.s': 'edited' }),
  });
  assert.deepEqual(p.ops.map((o) => o.op), ['write']);
  assert.deepEqual(p.diagnostics, []);
});

test('generated: an unlisted file with other content is overwritten under every generated root', () => {
  const roots = ['asm/x.s', 'data/x.s', 'expected/x.s', 'ldscript.txt', 'symbols.ld', 'modules.mk', 'objdiff.json'];
  const p = plan({ entries: roots.map((path) => gen(path, 'new')), disk: diskOf(Object.fromEntries(roots.map((r) => [r, 'foreign']))) });
  assert.deepEqual(p.ops.map((o) => o.op), roots.map(() => 'write'));
  assert.deepEqual(p.diagnostics, []);
});

test('generated: an unlisted file with other content outside the roots is E_PATH_NOT_OWNED and gets no op', () => {
  const p = plan({
    entries: [gen('asm/a.s', 'A'), gen('src/notes.s', 'mine?'), gen('asmx/b.s', 'B'), gen('ldscript.txt.bak', 'C')],
    disk: diskOf({ 'asm/a.s': null, 'src/notes.s': 'user text', 'asmx/b.s': 'x', 'ldscript.txt.bak': 'y' }),
  });
  assert.deepEqual(p.ops.map((o) => o.path), ['asm/a.s']);
  assert.deepEqual(codes(p), ['E_PATH_NOT_OWNED asmx/b.s', 'E_PATH_NOT_OWNED ldscript.txt.bak', 'E_PATH_NOT_OWNED src/notes.s']);
  assert.ok(p.diagnostics.every((d) => d.severity === 'error'));
  assert.deepEqual(Object.keys(p.manifest.files), ['asm/a.s']);
  assert.equal(planHasErrors(p), true);
});

test('generated: an unlisted file outside the roots with the same content is kept and adopted', () => {
  const p = plan({ entries: [gen('tools/gen.s', 'same')], disk: diskOf({ 'tools/gen.s': 'same' }) });
  assert.deepEqual(p.ops, [{ op: 'keep', path: 'tools/gen.s', sha1: fakeHash('same') }]);
  assert.deepEqual(Object.keys(p.manifest.files), ['tools/gen.s']);
});

test('a manifest path the tree no longer has is deleted when it is on disk, and leaves the manifest', () => {
  const p = plan({
    entries: [gen('asm/keep.s', 'K')],
    manifest: manifestOf({ 'asm/keep.s': 'K', 'asm/gone.s': 'G', 'asm/already.s': 'X', 'symbols.ld': 'S' }),
    disk: diskOf({ 'asm/keep.s': 'K', 'asm/gone.s': 'edited by hand', 'asm/already.s': null }),
  });
  // symbols.ld is in the manifest but not in the snapshot: deleted (a delete of a missing file is a no-op)
  assert.deepEqual(p.ops, [
    { op: 'delete', path: 'asm/gone.s' },
    { op: 'keep', path: 'asm/keep.s', sha1: fakeHash('K') },
    { op: 'delete', path: 'symbols.ld' },
  ]);
  assert.deepEqual(Object.keys(p.manifest.files), ['asm/keep.s']);
});

test('without a manifest nothing is deleted, and an unknown file under a generated root is W_UNOWNED_FILE', () => {
  const p = plan({
    entries: [gen('asm/a.s', 'A')],
    disk: diskOf({ 'asm/a.s': 'A', 'asm/stale.s': 'old', 'data/x.s': 'old', 'src/main.c': 'user', 'asm/missing.s': null }),
  });
  assert.deepEqual(p.ops.map((o) => o.op), ['keep']);
  assert.deepEqual(codes(p), ['W_UNOWNED_FILE asm/stale.s', 'W_UNOWNED_FILE data/x.s']);
  assert.ok(p.diagnostics.every((d) => d.severity === 'warning'));
  assert.equal(planHasErrors(p), false);
  assert.match(p.diagnostics[0]?.message ?? '', /no manifest/);
});

test('with a manifest an unlisted file under a generated root is left in place with W_UNOWNED_FILE', () => {
  const p = plan({
    entries: [gen('asm/a.s', 'A')],
    manifest: manifestOf({ 'asm/a.s': 'A' }),
    disk: diskOf({ 'asm/a.s': 'A', 'asm/foreign.s': 'f' }),
  });
  assert.deepEqual(p.ops.map((o) => o.op), ['keep']);
  assert.deepEqual(codes(p), ['W_UNOWNED_FILE asm/foreign.s']);
});

test('retained prefixes are never written, never deleted, never warned about, and leave the manifest', () => {
  const retained = ['asm/m4a.s', 'asm/nonmatchings/m4a/'];
  const p = plan({
    entries: [gen('asm/m4a.s', 'new'), gen('asm/nonmatchings/m4a/F.s', 'new'), gen('asm/main.s', 'M')],
    manifest: manifestOf({ 'asm/m4a.s': 'old', 'asm/nonmatchings/m4a/Gone.s': 'g', 'asm/main.s': 'M' }),
    disk: diskOf({ 'asm/m4a.s': 'user', 'asm/nonmatchings/m4a/F.s': null, 'asm/nonmatchings/m4a/Gone.s': 'g', 'asm/nonmatchings/m4a/Own.s': 'o', 'asm/main.s': 'M' }),
    retained,
  });
  assert.deepEqual(p.ops, [{ op: 'keep', path: 'asm/main.s', sha1: fakeHash('M') }]);
  assert.deepEqual(Object.keys(p.manifest.files), ['asm/main.s']);
  assert.deepEqual(p.diagnostics, []);
  // a file prefix matches the path exactly, not as a string prefix
  const q = plan({ entries: [gen('asm/m4a.s.bak', 'x')], disk: diskOf({ 'asm/m4a.s.bak': null }), retained });
  assert.deepEqual(q.ops.map((o) => o.op), ['write']);
});

test('scaffold: written only when absent, kept otherwise, never in the manifest', () => {
  const p = plan({
    entries: [
      { ownership: 'scaffold', path: 'Makefile', text: 'all:\n', writer: 'scaffold' },
      { ownership: 'scaffold', path: 'src/main.c', text: '#include "global.h"\n', writer: 'c-stub' },
    ],
    disk: diskOf({ Makefile: 'my own makefile', 'src/main.c': null }),
  });
  assert.deepEqual(p.ops, [
    { op: 'keep', path: 'Makefile', sha1: fakeHash('my own makefile') },
    { op: 'write', path: 'src/main.c', text: '#include "global.h"\n', sha1: fakeHash('#include "global.h"\n'), writer: 'c-stub' },
  ]);
  assert.deepEqual(p.manifest.files, {});
});

const BASE = 'int a;\nINCLUDE_ASM("asm/nonmatchings/main", F);\n';

function reconciled(path: string, baseText: string, edits: readonly TextEdit[]): FileEntry {
  return { ownership: 'reconciled', path, baseSha1: fakeHash(baseText), edits };
}

test('reconciled: edited while the file still has its base sha1, with the result sha1 from the hash', () => {
  const edit: TextEdit = { start: 0, end: 6, text: 'int b;', reason: 'rename' };
  const p = plan({
    entries: [reconciled('src/main.c', BASE, [edit])],
    disk: diskOf({ 'src/main.c': BASE }),
    reconciledTexts: new Map([['src/main.c', BASE]]),
  });
  const result = `int b;${BASE.slice(6)}`;
  assert.deepEqual(p.ops, [{ op: 'edit', path: 'src/main.c', baseSha1: fakeHash(BASE), resultSha1: fakeHash(result), text: result }]);
  assert.deepEqual(p.manifest.files, {});
  assert.deepEqual(p.diagnostics, []);
});

test('reconciled: E_STALE_EDIT when the file changed, is absent, or its text is not the base', () => {
  const edit: TextEdit = { start: 0, end: 0, text: '// x\n', reason: 'add-stub' };
  const changed = plan({
    entries: [reconciled('src/main.c', BASE, [edit])],
    disk: diskOf({ 'src/main.c': `${BASE}// user\n` }),
    reconciledTexts: new Map([['src/main.c', `${BASE}// user\n`]]),
  });
  assert.deepEqual(changed.ops, []);
  assert.deepEqual(codes(changed), ['E_STALE_EDIT src/main.c']);
  assert.equal(planHasErrors(changed), true);
  const absent = plan({ entries: [reconciled('src/main.c', BASE, [edit])], disk: diskOf({ 'src/main.c': null }) });
  assert.deepEqual(codes(absent), ['E_STALE_EDIT src/main.c']);
  const noText = plan({ entries: [reconciled('src/main.c', BASE, [edit])], disk: diskOf({ 'src/main.c': BASE }) });
  assert.deepEqual(codes(noText), ['E_STALE_EDIT src/main.c']);
  const wrongText = plan({
    entries: [reconciled('src/main.c', BASE, [edit])],
    disk: diskOf({ 'src/main.c': BASE }),
    reconciledTexts: new Map([['src/main.c', 'other']]),
  });
  assert.deepEqual(codes(wrongText), ['E_STALE_EDIT src/main.c']);
});

test('reconciled: edits that change nothing are a keep', () => {
  const p = plan({
    entries: [reconciled('src/main.c', BASE, [{ start: 0, end: 3, text: 'int', reason: 'rename' }])],
    disk: diskOf({ 'src/main.c': BASE }),
    reconciledTexts: new Map([['src/main.c', BASE]]),
  });
  assert.deepEqual(p.ops, [{ op: 'keep', path: 'src/main.c', sha1: fakeHash(BASE) }]);
});

test('a journal: its paths count as owned, a done edit is kept, a base edit is re-applied, others are stale', () => {
  const edit: TextEdit = { start: 0, end: 6, text: 'int b;', reason: 'rename' };
  const result = applyTextEdits(BASE, [edit]);
  const journal: Journal = {
    schema: 1,
    ops: [
      { op: 'write', path: 'tools/gen.s', resultSha1: fakeHash('new') },
      { op: 'write', path: 'asm/new-then-dropped.s', resultSha1: fakeHash('x') },
      { op: 'edit', path: 'src/a.c', baseSha1: fakeHash(BASE), resultSha1: fakeHash(result) },
      { op: 'edit', path: 'src/b.c', baseSha1: fakeHash(BASE), resultSha1: fakeHash(result) },
      { op: 'edit', path: 'src/c.c', baseSha1: fakeHash(BASE), resultSha1: fakeHash(result) },
    ],
  };
  const p = plan({
    entries: [gen('tools/gen.s', 'new'), reconciled('src/a.c', BASE, [edit]), reconciled('src/b.c', BASE, [edit]), reconciled('src/c.c', BASE, [edit])],
    disk: diskOf({ 'tools/gen.s': 'half-old', 'asm/new-then-dropped.s': 'x', 'src/a.c': result, 'src/b.c': BASE, 'src/c.c': 'user' }),
    reconciledTexts: new Map([['src/a.c', result], ['src/b.c', BASE], ['src/c.c', 'user']]),
    journal,
  });
  assert.deepEqual(p.ops, [
    { op: 'delete', path: 'asm/new-then-dropped.s' },
    { op: 'keep', path: 'src/a.c', sha1: fakeHash(result) },
    { op: 'edit', path: 'src/b.c', baseSha1: fakeHash(BASE), resultSha1: fakeHash(result), text: result },
    { op: 'write', path: 'tools/gen.s', text: 'new', sha1: fakeHash('new'), writer: 'function' },
  ]);
  assert.deepEqual(codes(p), ['E_STALE_EDIT src/c.c']);
  // without the journal the outside-root write is refused, and the dropped file is only warned about
  const without = plan({ entries: [gen('tools/gen.s', 'new')], disk: diskOf({ 'tools/gen.s': 'half-old', 'asm/new-then-dropped.s': 'x' }) });
  assert.deepEqual(codes(without), ['W_UNOWNED_FILE asm/new-then-dropped.s', 'E_PATH_NOT_OWNED tools/gen.s']);
});

test('ops, manifest and diagnostics are sorted by path whatever the stream order', () => {
  const paths = ['asm/z.s', 'asm/B.s', 'asm/a.s', 'asm/nonmatchings/m/É.s', 'asm/nonmatchings/m/E.s', 'data/m.s'];
  const p = plan({ entries: paths.map((path) => gen(path, path)), disk: diskOf(Object.fromEntries(paths.map((x) => [x, null]))) });
  const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(p.ops.map((o) => o.path), sorted);
  assert.deepEqual(Object.keys(p.manifest.files), sorted);
});

test('the stream is consumed once', () => {
  let started = 0;
  const entries: Iterable<FileEntry> = {
    *[Symbol.iterator]() {
      started++;
      if (started > 1) throw new Error('consumed twice');
      yield gen('asm/a.s', 'A');
      yield gen('asm/b.s', 'B');
    },
  };
  const p = plan({ entries, disk: diskOf({ 'asm/a.s': null, 'asm/b.s': null }) });
  assert.equal(started, 1);
  assert.equal(p.ops.length, 2);
});

test('the manifest version: the input, else the old manifest, else unknown', () => {
  const entries = [gen('asm/a.s', 'A')];
  const disk = diskOf({ 'asm/a.s': 'A' });
  assert.equal(plan({ entries, disk, romlift: '2.0.0', manifest: manifestOf({}) }).manifest.romlift, '2.0.0');
  assert.equal(plan({ entries, disk, manifest: manifestOf({}, '1.5.0') }).manifest.romlift, '1.5.0');
  assert.equal(plan({ entries, disk }).manifest.romlift, UNKNOWN_ROMLIFT_VERSION);
  assert.equal(plan({ entries, disk }).manifest.schema, 1);
});

test('a broken caller contract throws RomliftInvariantError', () => {
  assert.throws(() => plan({ entries: [gen('asm/a.s', 'A'), gen('asm/a.s', 'B')], disk: diskOf({ 'asm/a.s': null }) }), RomliftInvariantError);
  assert.throws(() => plan({ entries: [gen('asm/a.s', 'A')] }), RomliftInvariantError);
  for (const bad of ['../x.s', '/abs.s', 'asm//a.s', 'asm\\a.s', 'asm/./a.s', '']) {
    assert.throws(() => plan({ entries: [gen(bad, 'A')], disk: new Map([[bad, 'absent']]) }), RomliftInvariantError, bad);
  }
});

test('applyTextEdits applies non-overlapping edits by offset, insertions at one offset in order', () => {
  const edits: TextEdit[] = [
    { start: 6, end: 6, text: '2', reason: 'add-stub' },
    { start: 0, end: 5, text: 'HELLO', reason: 'rename' },
    { start: 6, end: 6, text: '3', reason: 'add-stub' },
    { start: 11, end: 11, text: '!', reason: 'add-stub' },
  ];
  assert.equal(applyTextEdits('hello world', edits), 'HELLO 23world!');
  assert.equal(applyTextEdits('abc', []), 'abc');
  assert.throws(() => applyTextEdits('abc', [{ start: 0, end: 2, text: '', reason: 'remove-stub' }, { start: 1, end: 3, text: '', reason: 'remove-stub' }]), RomliftInvariantError);
  assert.throws(() => applyTextEdits('abc', [{ start: 2, end: 4, text: '', reason: 'remove-stub' }]), RomliftInvariantError);
  assert.throws(() => applyTextEdits('abc', [{ start: 2, end: 1, text: '', reason: 'remove-stub' }]), RomliftInvariantError);
});
