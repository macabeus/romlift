// The reconciliation of a project's C files (core/workflow/c-stubs.ts, architecture §6.6, D75 b, D77 a to d), over the
// composite fixture's init (two `c` modules, main and main_2): a C file in step with the model needs no edit; the C
// definition of a function the TOML now gives the other module is E_C_DEFINITION_MOVED; a src/*.c of no module is
// W_C_FILE_UNUSED; the result is plain data (files sorted by path, a JSON round trip keeps it); the three views
// (projectEntries, resolvedEntries, outTreeEntries) give the reconciled file its edits, its text, and generated ownership.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { emitTree } from '../../../src/core/emit/emit-tree.ts';
import { stubChunks } from '../../../src/core/model/c-unit.ts';
import { outTreeEntries, projectEntries, reconcileStubs, reconciledBases, resolvedEntries } from '../../../src/core/workflow/c-stubs.ts';
import { generatedEntries } from '../../../src/core/workflow/generate.ts';
import { init } from '../../../src/core/workflow/init.ts';
import { includeAsmStatement } from '../../../src/foundation/asm/dialect.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { readScaffoldInputs } from '../../../src/shell/project/read-inputs.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';
import { dataItem, modelOf, romWith } from '../../helpers/model.ts';

const scaffold = await readScaffoldInputs();
if (!scaffold.ok) throw new Error('the package templates do not read');
const FIXTURE = listSyntheticFixtures().find((f) => f.name === 'composite') ?? assert.fail('composite');
const ROM = readFixtureRom(FIXTURE);
const PLAN = init({ rom: ROM, romFile: 'composite.gba', options: {}, templates: scaffold.value.templates, romliftVersion: '0.0.0', agbcc: scaffold.value.agbcc });
if (!PLAN.ok) throw new Error('init refused the composite');
const MODEL = PLAN.result.model;
const TEXTS = new Map<string, string>();
for (const e of generatedEntries(ROM, PLAN.result)) if (e.path.startsWith('src/') && 'text' in e) TEXTS.set(e.path, e.text);
const moduleNamed = (name: string) => MODEL.modules.find((m) => m.name === name) ?? assert.fail(name);
const namesOf = (name: string): readonly string[] => stubChunks(MODEL, moduleNamed(name)).map((c) => c.stub);

test('the C files init wrote need no edit and raise nothing; the result survives a JSON round trip', () => {
  assert.deepEqual([...TEXTS.keys()], ['src/main.c', 'src/main_2.c']);
  const stubs = reconcileStubs(MODEL, TEXTS);
  assert.deepEqual(stubs.diagnostics, []);
  assert.deepEqual(stubs.files.map((f) => [f.path, f.edits.length]), [['src/main.c', 0], ['src/main_2.c', 0]]);
  assert.deepEqual(JSON.parse(JSON.stringify(stubs)), stubs);
  assert.deepEqual([...reconciledBases(stubs).keys()], ['src/main.c', 'src/main_2.c']);
});

test("a C definition of a function the TOML gives the other module is E_C_DEFINITION_MOVED (an error)", () => {
  const moved = namesOf('main_2').find((n) => n.startsWith('sub_')) ?? assert.fail('main_2 has a function');
  const main = `${TEXTS.get('src/main.c') ?? ''}int ${moved}(void) {\n  return 0;\n}\n`;
  const stubs = reconcileStubs(MODEL, new Map([...TEXTS, ['src/main.c', main]]));
  assert.deepEqual(stubs.diagnostics.map((d) => [d.code, d.severity, d.path]), [['E_C_DEFINITION_MOVED', 'error', 'src/main.c']]);
  assert.match(stubs.diagnostics[0]?.message ?? '', new RegExp(`defines ${moved} \\(line \\d+\\), which romlift.toml now puts in module main_2`));
  const helper = `${TEXTS.get('src/main.c') ?? ''}static int Helper(void) {\n  return 0;\n}\n`;
  assert.deepEqual(reconcileStubs(MODEL, new Map([...TEXTS, ['src/main.c', helper]])).diagnostics, [], 'a definition no module has is the user\'s');
});

test('a src/*.c that is the source of no module is W_C_FILE_UNUSED, and is left out of the reconciliation', () => {
  const stubs = reconcileStubs(MODEL, new Map([...TEXTS, ['src/old.c', 'int Kept(void) { return 1; }\n']]));
  assert.deepEqual(stubs.diagnostics.map((d) => [d.code, d.severity, d.path]), [['W_C_FILE_UNUSED', 'warning', 'src/old.c']]);
  assert.deepEqual(stubs.files.map((f) => f.path), ['src/main.c', 'src/main_2.c']);
});

test('the three views: the project gets an edit, a fresh tree the text, generate --out a generated file', () => {
  const first = namesOf('main')[0] ?? assert.fail('main has a chunk');
  const text = (TEXTS.get('src/main.c') ?? '').replace(`${includeAsmStatement('main', first)}\n`, '');
  const stubs = reconcileStubs(MODEL, new Map([...TEXTS, ['src/main.c', text]]));
  const file = stubs.files.find((f) => f.path === 'src/main.c') ?? assert.fail('src/main.c');
  assert.equal(file.text, TEXTS.get('src/main.c'), 'the removed stub is put back');
  const entries = (): Iterable<FileEntry> => emitTree(ROM, MODEL, PLAN.result.cx);
  const project = [...projectEntries(entries(), stubs, sha1Of)].find((e) => e.path === 'src/main.c');
  assert.ok(project?.ownership === 'reconciled' && project.baseSha1 === sha1Of(text) && project.edits.length === 1);
  const fresh = [...resolvedEntries(entries(), stubs)].find((e) => e.path === 'src/main.c');
  assert.ok(fresh?.ownership === 'scaffold' && fresh.text === file.text);
  const out = [...outTreeEntries(resolvedEntries(entries(), stubs))].filter((e) => e.path.startsWith('src/'));
  assert.deepEqual(out.map((e) => [e.path, e.ownership]), [['src/main.c', 'generated'], ['src/main_2.c', 'generated']]);
});

// Fix round 3 (D78 a): the previous tree's chunk files, case-folded pairs, and the kind of the module a function moved to.

const ROM2 = romWith([], { size: 0x200 });
/** rom_header; c module `main` with a case-folded pair Foo/foo and Nop; asm module `tail` with Moved. */
const PAIR = modelOf(ROM2, {
  modules: [
    { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
    { name: 'main', kind: 'c', chunks: [{ name: 'Foo', items: [dataItem(0x0800_00c0, 0x20)] }, { name: 'foo', items: [dataItem(0x0800_00e0, 0x20)] }, { name: 'Nop', items: [dataItem(0x0800_0100, 0x80)] }] },
    { name: 'tail', chunks: [{ name: 'Moved', items: [dataItem(0x0800_0180, 0x80)] }] },
  ],
});
const PAIR_STUB = `#include "include_asm.h"\n\n${includeAsmStatement('main', 'Foo_080000C0')}\n${includeAsmStatement('main', 'foo_080000E0')}\n${includeAsmStatement('main', 'Nop')}\n`;

test('a case-folded pair with one member decompiled needs no edit and raises nothing (architecture-a1-1)', () => {
  const text = PAIR_STUB.replace(`${includeAsmStatement('main', 'Foo_080000C0')}\n`, 'void Foo(void) {\n}\n');
  const stubs = reconcileStubs(PAIR, new Map([['src/main.c', text]]));
  assert.deepEqual(stubs.diagnostics, []);
  assert.deepEqual(stubs.files.map((f) => f.edits), [[]]);
});

test('the previous tree: the C of a renamed or deleted function is stale anywhere; a helper is not (correctness-a1-2, a1-3)', () => {
  const previous = ['asm/nonmatchings/main/Foo_080000C0.s', 'asm/nonmatchings/main/foo_080000E0.s', 'asm/nonmatchings/main/sub_08000100.s', 'asm/nonmatchings/tail/Moved.s'];
  // sub_08000100 was decompiled and the TOML renamed it Nop (a border move could put Nop anywhere): stale.
  const renamed = `${PAIR_STUB}void sub_08000100(void) {\n}\n`;
  const stale = reconcileStubs(PAIR, new Map([['src/main.c', renamed]]), previous);
  assert.deepEqual(stale.diagnostics.map((d) => [d.code, d.severity]), [['E_C_STALE_DEFINITION', 'error']]);
  // A helper no tree had: nothing.
  const helper = `${PAIR_STUB}static int Helper(void) {\n    return 1;\n}\n`;
  assert.deepEqual(reconcileStubs(PAIR, new Map([['src/main.c', helper]]), previous).diagnostics, []);
  // A previous function another module still has is E_C_DEFINITION_MOVED, never stale; an asm module builds no C.
  const moved = `${PAIR_STUB}void Moved(void) {\n}\n`;
  const refused = reconcileStubs(PAIR, new Map([['src/main.c', moved]]), previous).diagnostics;
  assert.deepEqual(refused.map((d) => d.code), ['E_C_DEFINITION_MOVED']);
  assert.match(refused[0]?.message ?? '', /now puts in module tail: tail is an asm module, which builds no C: delete the C definition, or make tail a c module in romlift.toml/);
});

// Fix round 4 (D80 a): the module's own chunk files of the previous tree, and a file of no module that holds decompiled C.

test('a C-only rename where a chunk of the module\'s own previous directory was is stale; a file of no module is still read (correctness-a2-1, a2-4)', () => {
  const previous = ['asm/nonmatchings/main/Foo_080000C0.s', 'asm/nonmatchings/main/foo_080000E0.s', 'asm/nonmatchings/main/Nop.s', 'asm/nonmatchings/tail/Moved.s'];
  const renamedInC = PAIR_STUB.replace(`${includeAsmStatement('main', 'Nop')}\n`, 'void Pause(void) {\n}\n');
  const stale = reconcileStubs(PAIR, new Map([['src/main.c', renamedInC]]), previous);
  assert.deepEqual(stale.diagnostics.map((d) => [d.code, d.severity]), [['E_C_STALE_DEFINITION', 'error']]);
  assert.match(stale.diagnostics[0]?.message ?? '', /defines Pause \(line \d+\) where the INCLUDE_ASM of Nop was, and module main still has Nop/);
  // Nop's file was in another module's directory (a border move brought it here): Pause is a helper beside its stub.
  const moved = previous.map((p) => p.replace('main/Nop.s', 'tail/Nop.s'));
  assert.deepEqual(reconcileStubs(PAIR, new Map([['src/main.c', renamedInC]]), moved).diagnostics, []);
  // A src/*.c of no module that defines a function a module has: its C would leave the build unseen.
  const orphan = reconcileStubs(PAIR, new Map([['src/main.c', PAIR_STUB], ['src/gone.c', 'void Moved(void) {\n}\nint Kept(void) { return 1; }\n']]), previous);
  assert.deepEqual(orphan.diagnostics.map((d) => [d.code, d.path]), [['W_C_FILE_UNUSED', 'src/gone.c'], ['E_C_DEFINITION_MOVED', 'src/gone.c']]);
});
