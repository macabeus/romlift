// The reconciliation of a project's C files (core/workflow/c-stubs.ts, architecture §6.6, D75 b, D77 a to d), over the
// composite fixture's init (two `c` modules, main and main_2): a C file in step with the model needs no edit; the C
// definition of a function the TOML now gives the other module is E_C_DEFINITION_MOVED; a src/*.c of no module is
// W_C_FILE_UNUSED; the result is plain data (files sorted by path, a JSON round trip keeps it); the three views
// (projectEntries, resolvedEntries, outTreeEntries) give the reconciled file its edits, its text, and generated ownership.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { emitTree } from '../../../src/core/emit/emit-tree.ts';
import { stubChunkFiles, stubName } from '../../../src/core/model/c-unit.ts';
import { outTreeEntries, projectEntries, reconcileStubs, reconciledBases, resolvedEntries } from '../../../src/core/workflow/c-stubs.ts';
import { generatedEntries } from '../../../src/core/workflow/generate.ts';
import { init } from '../../../src/core/workflow/init.ts';
import { includeAsmStatement } from '../../../src/foundation/asm/dialect.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { readScaffoldInputs } from '../../../src/shell/project/read-inputs.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

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
const namesOf = (name: string): readonly string[] => stubChunkFiles(MODEL, moduleNamed(name)).map((f) => stubName(name, f));

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
