// The build-compiler registry (architecture §3.4, D47): agbcc and old_agbcc ship, each with its cc1 path
// under tools/agbcc/bin, the pret flags and the banner it prints; nothing else is registered, and templates/MANIFEST.json
// installs one Makefile fragment per registered compiler, mk/<id>.mk from compilers/<id>.mk.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  BUILD_COMPILERS,
  DEFAULT_BUILD_COMPILER,
  buildCompilerOf,
  isBuildCompilerId,
} from '../../../src/core/config/compilers.ts';

test('agbcc and old_agbcc ship', () => {
  assert.deepEqual(Object.keys(BUILD_COMPILERS), ['agbcc', 'old_agbcc']);
  assert.deepEqual(BUILD_COMPILERS['agbcc'], {
    id: 'agbcc',
    cc1: 'tools/agbcc/bin/agbcc',
    flags: ['-mthumb-interwork', '-Wimplicit', '-Wparentheses', '-O2', '-fhex-asm'],
    banner: 'gcc 2.9-arm-000512',
  });
  assert.equal(BUILD_COMPILERS['old_agbcc']?.cc1, 'tools/agbcc/bin/old_agbcc');
  assert.equal(BUILD_COMPILERS['old_agbcc']?.banner, 'gcc 2.9-arm-000512');
  for (const [id, compiler] of Object.entries(BUILD_COMPILERS)) assert.equal(compiler.id, id);
  assert.equal(DEFAULT_BUILD_COMPILER, 'agbcc');
});

test('lookups accept only registered ids, never inherited members', () => {
  assert.ok(isBuildCompilerId('agbcc'));
  assert.ok(isBuildCompilerId('old_agbcc'));
  for (const id of ['gcc', '', 'toString', '__proto__', 'AGBCC']) {
    assert.ok(!isBuildCompilerId(id), id);
    assert.equal(buildCompilerOf(id), undefined, id);
  }
  assert.equal(buildCompilerOf('old_agbcc')?.id, 'old_agbcc');
});

test('templates/MANIFEST.json installs exactly one Makefile fragment per registered compiler', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../templates/MANIFEST.json', import.meta.url), 'utf8')) as {
    readonly files: readonly { readonly target: string; readonly source: string | null }[];
  };
  const fragments = manifest.files.filter((f) => f.target.startsWith('mk/')).map((f) => [f.target, f.source]);
  assert.deepEqual(
    fragments,
    Object.keys(BUILD_COMPILERS).map((id) => [`mk/${id}.mk`, `compilers/${id}.mk`]),
  );
});
