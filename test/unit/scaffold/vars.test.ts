// The scaffold's frozen contract (architecture §6.3, D74): ScaffoldVars, the placeholders, and the strict
// readers of templates/MANIFEST.json and templates/agbcc.json; the committed manifest itself decodes, lists one
// fragment per build compiler and never targets a generated root or romlift's own files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { BUILD_COMPILERS } from '../../../src/core/config/compilers.ts';
import { MACROS_PATH } from '../../../src/core/model/paths.ts';
import {
  ROMLIFT_RENDERED_TARGETS,
  SCAFFOLD_PLACEHOLDERS,
  decodeAgbccPin,
  decodeScaffoldManifest,
  placeholderText,
  placeholderValues,
  placeholdersIn,
  scaffoldVars,
} from '../../../src/core/scaffold/vars.ts';
import type { ScaffoldVars } from '../../../src/core/scaffold/vars.ts';
import { underGeneratedRoot } from '../../../src/core/write-plan/types.ts';
import { BASEROM_FILE, INCLUDE_ASM_HEADER_PATH } from '../../../src/foundation/util/project-files.ts';

const MANIFEST = readFileSync(new URL('../../../templates/MANIFEST.json', import.meta.url), 'utf8');
const PIN = { url: 'https://github.com/pret/agbcc', commit: 'da598c1d918402c42c0c0d7128ba14567f3175e9' } as const;

const VARS: ScaffoldVars = scaffoldVars({
  name: 'klonoa-eod',
  sha1: 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b',
  romliftVersion: '0.4.0',
  agbcc: PIN,
  title: 'KLONOA',
});

/** A manifest text with these entries (some deliberately malformed). */
function rendered(entries: readonly object[]): string {
  return JSON.stringify({ schema: 1, files: entries });
}

const RENDERED = ROMLIFT_RENDERED_TARGETS.map((target) => ({ target, source: null, executable: false }));

test('scaffoldVars derives the built ROM and the SHA-1 file from the build name; the ROM is baserom.gba', () => {
  assert.equal(VARS.builtRom, 'klonoa-eod.gba');
  assert.equal(VARS.sha1File, 'klonoa-eod.sha1');
  assert.equal(VARS.romFile, BASEROM_FILE, 'the scaffold names the ROM file every layer reads');
  assert.equal(BASEROM_FILE, 'baserom.gba');
});

test('every placeholder has a value, and placeholdersIn reads the @@name@@ spelling', () => {
  const values = placeholderValues(VARS);
  assert.deepEqual(Object.keys(values).sort(), [...SCAFFOLD_PLACEHOLDERS].sort());
  assert.equal(values.agbccUrl, PIN.url);
  assert.equal(values.agbccCommit, PIN.commit);
  assert.equal(values.sha1File, 'klonoa-eod.sha1');
  assert.equal(placeholderText('builtRom'), '@@builtRom@@');
  assert.deepEqual(placeholdersIn('$(NAME) @@name@@.gba ${{ github.sha }} @@nope@@ @@'), ['name', 'nope']);
});

test('the committed MANIFEST.json decodes and lists every scaffold file of architecture §6.3', () => {
  const decoded = decodeScaffoldManifest(MANIFEST);
  assert.ok(decoded.ok, decoded.ok ? '' : decoded.message);
  const files = decoded.value.files;
  const targets = files.map((f) => f.target);
  for (const target of [
    'Makefile',
    'setup.sh',
    'AGENTS.md',
    'README.md',
    '.github/workflows/build.yml',
    '.gitignore',
    '@@sha1File@@',
    'package.json',
    '.gitmodules',
    MACROS_PATH,
    INCLUDE_ASM_HEADER_PATH,
  ]) {
    assert.ok(targets.includes(target), target);
  }
  assert.deepEqual(
    files.filter((f) => f.executable).map((f) => f.target),
    ['setup.sh'],
  );
  assert.deepEqual(
    targets,
    [...targets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    'targets sorted by code unit',
  );
  for (const id of Object.keys(BUILD_COMPILERS)) {
    const compiler = BUILD_COMPILERS[id];
    const entry = files.find((f) => f.target === `mk/${id}.mk`);
    assert.ok(compiler !== undefined && entry !== undefined, `mk/${id}.mk`);
    assert.equal(entry.source, `compilers/${id}.mk`, `mk/${id}.mk comes from the compiler's fragment template`);
  }
  for (const target of targets) {
    assert.ok(!underGeneratedRoot(target), `${target} lies under a generated root`);
    assert.ok(
      !['romlift.toml', 'decomp.yaml', BASEROM_FILE].includes(target) &&
        !target.startsWith('src/') &&
        !target.startsWith('.romlift/'),
      target,
    );
  }
});

test('decodeScaffoldManifest refuses what is not a manifest, as a value', () => {
  const ok = { target: 'Makefile', source: 'Makefile', executable: false };
  const bad: readonly [string, string][] = [
    ['{', 'not JSON'],
    ['[]', 'not a JSON object'],
    [JSON.stringify({ schema: 2, files: [] }), 'schema 2'],
    [JSON.stringify({ schema: 1, files: {} }), 'files is not an array'],
    [JSON.stringify({ schema: 1, files: [], extra: 1 }), 'unknown member'],
    [rendered([...RENDERED, { ...ok, mode: 1 }]), 'unknown member "mode"'],
    [rendered([...RENDERED, { ...ok, target: '../Makefile' }]), 'not a project path'],
    [rendered([...RENDERED, { ...ok, target: '/Makefile' }]), 'not a project path'],
    [rendered([...RENDERED, { ...ok, target: '@@nmae@@.mk' }]), 'unknown placeholder @@nmae@@'],
    [rendered([...RENDERED, { ...ok, target: 'a@@b' }]), 'a lone @@'],
    [rendered([...RENDERED, { ...ok, source: '../x' }]), 'neither null nor a path'],
    [rendered([...RENDERED, { ...ok, source: null }]), 'has no template'],
    [rendered([...RENDERED, { ...ok, executable: 'yes' }]), 'executable is not a boolean'],
    [rendered([...RENDERED, ok, ok]), 'listed twice'],
    [rendered([...RENDERED.slice(1), ok]), 'does not list @@sha1File@@'],
    [
      rendered([
        ...RENDERED.slice(0, -1),
        { target: INCLUDE_ASM_HEADER_PATH, source: 'include_asm.h', executable: false },
      ]),
      'its source must be null',
    ],
  ];
  for (const [text, message] of bad) {
    const decoded = decodeScaffoldManifest(text);
    assert.equal(decoded.ok, false, text);
    if (!decoded.ok) assert.ok(decoded.message.includes(message), `${text}: ${decoded.message}`);
  }
  const good = decodeScaffoldManifest(rendered([...RENDERED, ok]));
  assert.ok(good.ok);
});

test('decodeAgbccPin reads templates/agbcc.json strictly', () => {
  const good = decodeAgbccPin(JSON.stringify(PIN));
  assert.deepEqual(good, { ok: true, value: PIN });
  for (const [text, message] of [
    ['nope', 'not JSON'],
    [JSON.stringify({ ...PIN, branch: 'master' }), 'unknown member'],
    [JSON.stringify({ ...PIN, url: '' }), 'url'],
    [JSON.stringify({ ...PIN, commit: 'da598c1' }), 'commit'],
    [JSON.stringify({ ...PIN, commit: PIN.commit.toUpperCase() }), 'commit'],
  ] as const) {
    const decoded = decodeAgbccPin(text);
    assert.equal(decoded.ok, false, text);
    if (!decoded.ok) assert.ok(decoded.message.includes(message), decoded.message);
  }
});
