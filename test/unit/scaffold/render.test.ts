// renderScaffold (architecture §6.3, D74 d, roadmap 4.B): every manifest file rendered over ScaffoldVars, sorted,
// with scaffold ownership; the placeholder errors (bugs of the package, RomliftInvariantError); the five files
// romlift renders itself; and the committed templates' agreements with the definitions they must not drift from
// (the dialect's assembler arguments, the build compilers, the generated roots, the C-data ASSERT's message).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { BUILD_COMPILERS } from '../../../src/core/config/compilers.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { gitmodulesText, npmPackageName, packageJsonText, renderScaffold, sha1FileText } from '../../../src/core/scaffold/render.ts';
import type { ScaffoldFileEntry } from '../../../src/core/scaffold/render.ts';
import { decodeScaffoldManifest, ROMLIFT_RENDERED_TARGETS, scaffoldVars } from '../../../src/core/scaffold/vars.ts';
import type { ScaffoldManifest, ScaffoldTemplates, ScaffoldVars } from '../../../src/core/scaffold/vars.ts';
import { GENERATED_ROOTS, ROMLIFT_DIR } from '../../../src/core/write-plan/types.ts';
import { DIALECT, INCLUDE_ASM_HEADER } from '../../../src/foundation/asm/dialect.ts';
import { INCLUDE_ASM_HEADER_PATH } from '../../../src/foundation/util/project-files.ts';
import { RomliftInvariantError } from '../../../src/foundation/diagnostics/diagnostic.ts';

const TEMPLATES_URL = new URL('../../../templates/', import.meta.url);
const PIN = { url: 'https://github.com/pret/agbcc', commit: 'da598c1d918402c42c0c0d7128ba14567f3175e9' } as const;
const VARS: ScaffoldVars = scaffoldVars({ name: 'klonoa-eod', sha1: 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b', romliftVersion: '0.4.0', agbcc: PIN, title: 'KLONOA' });

function decoded(json: string): ScaffoldManifest {
  const manifest = decodeScaffoldManifest(json);
  if (!manifest.ok) throw new Error(manifest.message);
  return manifest.value;
}

/** The committed manifest and templates, read synchronously (the shell's reader has its own test). */
function committed(): ScaffoldTemplates {
  const manifest = decoded(readFileSync(new URL('MANIFEST.json', TEMPLATES_URL), 'utf8'));
  const texts = new Map<string, string>();
  for (const file of manifest.files) if (file.source !== null) texts.set(file.source, readFileSync(new URL(file.source, TEMPLATES_URL), 'utf8'));
  return { manifest, texts };
}

const RENDERED = ROMLIFT_RENDERED_TARGETS.map((target) => ({ target, source: null, executable: false }));

/** A manifest of the five rendered targets plus `extra`, with the template texts given. */
function templates(extra: readonly { readonly target: string; readonly source: string; readonly executable?: boolean }[], texts: Readonly<Record<string, string>>): ScaffoldTemplates {
  const files = [...RENDERED, ...extra.map((e) => ({ target: e.target, source: e.source, executable: e.executable ?? false }))];
  return { manifest: { schema: 1, files }, texts: new Map(Object.entries(texts)) };
}

function textOf(entries: readonly ScaffoldFileEntry[], path: string): string {
  const entry = entries.find((e) => e.path === path);
  if (entry === undefined) throw new Error(`no ${path} in the scaffold`);
  return entry.text;
}

const SCAFFOLD = renderScaffold(VARS, committed());

test('every manifest file is rendered once, sorted by path, as a scaffold entry a FileEntry list accepts', () => {
  const asTree: readonly FileEntry[] = SCAFFOLD;
  assert.equal(asTree.length, committed().manifest.files.length);
  const paths = SCAFFOLD.map((e) => e.path);
  assert.deepEqual(paths, [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.equal(new Set(paths).size, paths.length);
  for (const e of SCAFFOLD) {
    assert.equal(e.ownership, 'scaffold');
    assert.equal(e.writer, 'scaffold');
    assert.doesNotMatch(e.text, /@@/, `${e.path} keeps a placeholder`);
    assert.ok(e.text.endsWith('\n'), `${e.path} ends with a line break`);
  }
  assert.ok(paths.includes('klonoa-eod.sha1'), 'the @@sha1File@@ target is filled');
  assert.deepEqual(
    SCAFFOLD.filter((e) => e.executable).map((e) => e.path),
    ['setup.sh'],
  );
});

test('the files romlift renders itself: <name>.sha1, package.json, .gitmodules and the two headers', () => {
  assert.equal(textOf(SCAFFOLD, 'klonoa-eod.sha1'), 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b  klonoa-eod.gba\n');
  assert.match(sha1FileText(VARS), /^[0-9a-f]{40} {2}klonoa-eod\.gba\n$/, 'sha1sum format, the ROM make builds');
  const pkg = JSON.parse(textOf(SCAFFOLD, 'package.json')) as { name: string; private: boolean; devDependencies: Record<string, string> };
  assert.equal(pkg.name, 'klonoa-eod');
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.devDependencies, { romlift: '0.4.0' }, 'the exact version, no range');
  assert.equal(textOf(SCAFFOLD, 'package.json'), packageJsonText(VARS));
  const gitmodules = textOf(SCAFFOLD, '.gitmodules');
  assert.equal(gitmodules, gitmodulesText(VARS));
  assert.match(gitmodules, /^\[submodule "tools\/agbcc"\]\n\tpath = tools\/agbcc\n\turl = https:\/\/github\.com\/pret\/agbcc\n/m);
  assert.equal(textOf(SCAFFOLD, DIALECT.macrosPath), DIALECT.macrosInc);
  assert.equal(textOf(SCAFFOLD, INCLUDE_ASM_HEADER_PATH), INCLUDE_ASM_HEADER);
});

test('npmPackageName turns any build name into a name npm accepts', () => {
  assert.equal(npmPackageName('klonoa-eod'), 'klonoa-eod');
  assert.equal(npmPackageName('BPEE'), 'bpee');
  assert.equal(npmPackageName('My Game: Deluxe!'), 'my-game-deluxe');
  assert.equal(npmPackageName('._rom'), 'rom');
  assert.equal(npmPackageName('!!!'), 'romlift-project');
  assert.equal(npmPackageName('a'.repeat(300)).length, 214);
});

test('a placeholder is replaced in one pass: a value that spells a placeholder stays as it is', () => {
  const vars = scaffoldVars({ ...VARS, title: '@@name@@', agbcc: PIN });
  const out = renderScaffold(vars, templates([{ target: 'T.md', source: 't.md' }], { 't.md': '@@title@@ / @@name@@\n' }));
  assert.equal(textOf(out, 'T.md'), '@@name@@ / klonoa-eod\n');
});

test('an unknown placeholder, a lone @@ or a missing template text is a bug: RomliftInvariantError', () => {
  const render = (text: string): unknown => renderScaffold(VARS, templates([{ target: 'T.md', source: 't.md' }], { 't.md': text }));
  assert.throws(() => render('@@nmae@@\n'), (e: unknown) => e instanceof RomliftInvariantError && /templates\/t\.md: unknown placeholder @@nmae@@/.test(e.message));
  assert.throws(() => render('@@@@\n'), RomliftInvariantError, 'an empty placeholder');
  assert.throws(() => render('mail@@example\n'), (e: unknown) => e instanceof RomliftInvariantError && /lone @@/.test(e.message));
  assert.throws(() => renderScaffold(VARS, templates([{ target: 'T.md', source: 't.md' }], {})), (e: unknown) => e instanceof RomliftInvariantError && /no text for the template t\.md/.test(e.message));
  const badTarget: ScaffoldTemplates = { manifest: { schema: 1, files: [...RENDERED, { target: '@@base@@.txt', source: 't.md', executable: false }] }, texts: new Map([['t.md', 'x\n']]) };
  assert.throws(() => renderScaffold(VARS, badTarget), (e: unknown) => e instanceof RomliftInvariantError && /target @@base@@\.txt: unknown placeholder/.test(e.message));
  const noRenderer: ScaffoldTemplates = { manifest: { schema: 1, files: [{ target: 'other.txt', source: null, executable: false }] }, texts: new Map() };
  assert.throws(() => renderScaffold(VARS, noRenderer), (e: unknown) => e instanceof RomliftInvariantError && /no renderer for other\.txt/.test(e.message));
});

test('the Makefile assembles with the dialect\'s arguments, includes modules.mk and every mk/<id>.mk, and checks <name>.sha1', () => {
  const makefile = textOf(SCAFFOLD, 'Makefile');
  assert.match(makefile, new RegExp(`^ASFLAGS  := ${DIALECT.asArgs.join(' ')} -I \\.$`, 'm'));
  assert.match(makefile, /^include modules\.mk$/m);
  assert.match(makefile, /^include \$\(sort \$\(wildcard mk\/\*\.mk\)\)$/m);
  assert.match(makefile, /^NAME {5}:= klonoa-eod$/m);
  assert.match(makefile, /^ROM {6}:= klonoa-eod\.gba$/m);
  assert.match(makefile, /^SHA1FILE := klonoa-eod\.sha1$/m);
  assert.match(makefile, /^\t\$\(SHA1SUM\) -c \$\(SHA1FILE\)$/m);
  assert.match(makefile, /^\t\$\(LD\) -T ldscript\.txt -Map \$\(MAP\) -o \$@ \$\(OBJS\)$/m);
  assert.match(makefile, /^CPPFLAGS := -E -x c -nostdinc -undef -I include$/m, 'the host preprocessor of D74 f');
  assert.match(makefile, /^build\/src\/%\.o: src\/%\.c$/m);
  for (const recipe of makefile.split('\n').filter((line) => line.startsWith('\t'))) assert.doesNotMatch(recipe, /^\t {2}/, 'recipes start with a tab');
});

test('each build compiler has its fragment at mk/<id>.mk, defining the recipe its CC1 file name selects', () => {
  for (const compiler of Object.values(BUILD_COMPILERS)) {
    assert.equal(compiler.cc1, `tools/agbcc/bin/${compiler.id}`, 'the Makefile dispatches on $(notdir $(CC1))');
    const fragment = textOf(SCAFFOLD, `mk/${compiler.id}.mk`);
    assert.match(fragment, new RegExp(`^define C_RECIPE_${compiler.id}$`, 'm'));
    assert.match(fragment, /^\$\(HOSTCC\) \$\(CPPFLAGS\) .* -o \$\(@:\.o=\.i\) \$<$/m);
    assert.match(fragment, /^\$\(CC1\) \$\(CFLAGS\) -o \$\(@:\.o=\.s\) \$\(@:\.o=\.i\)$/m);
    assert.match(fragment, /^\$\(AS\) \$\(ASFLAGS\) --MD \$\(@:\.o=\.d\) -o \$@ \$\(@:\.o=\.s\)$/m);
  }
});

test('.gitignore ignores the ROMs, the build and romlift\'s state, and never a generated root', () => {
  const lines = textOf(SCAFFOLD, '.gitignore')
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'));
  for (const ignored of ['baserom.gba', 'klonoa-eod.gba', 'build/', `${ROMLIFT_DIR}/`, 'node_modules/', '*.o']) assert.ok(lines.includes(ignored), ignored);
  for (const root of GENERATED_ROOTS) assert.ok(!lines.some((line) => line === root || `${line}/` === root || line === `/${root}`), `${root} must not be ignored`);
  assert.match(textOf(SCAFFOLD, '.gitignore'), /asm\/, data\/, ldscript\.txt, symbols\.ld and modules\.mk/, 'the generated roots are declared tool-owned');
});

test('AGENTS.md cites the C-data ASSERT\'s message, and setup.sh runs its five duties in order', () => {
  assert.match(textOf(SCAFFOLD, 'AGENTS.md'), /src\/<module>\.c defines data; see AGENTS\.md \(romlift does not place C data yet\)/);
  const setup = textOf(SCAFFOLD, 'setup.sh');
  assert.ok(setup.startsWith('#!/bin/sh\n'));
  assert.match(setup, /^set -eu$/m);
  assert.match(setup, /^main\(\) \{\n {2}check_toolchain\n {2}setup_agbcc\n {2}copy_baserom\n {2}install_romlift\n {2}generate_tree\n/m);
  assert.match(setup, /^AGBCC_COMMIT='da598c1d918402c42c0c0d7128ba14567f3175e9'$/m);
  assert.doesNotMatch(setup, /romlift\.toml[^\n]*>/, 'it never writes romlift.toml');
  assert.match(textOf(SCAFFOLD, '.github/workflows/build.yml'), /\$\{\{ secrets\.BASEROM_URL \}\}/, 'GitHub expressions survive the @@ spelling');
});
