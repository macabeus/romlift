// The build-compiler registry (architecture §3.4, D47): agbcc and old_agbcc ship, each with its cc1 path
// under tools/agbcc/bin, the pret flags and its Makefile rule template; nothing else is registered.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUILD_COMPILERS, buildCompilerOf, DEFAULT_BUILD_COMPILER, isBuildCompilerId } from '../../../src/core/config/compilers.ts';

test('agbcc and old_agbcc ship', () => {
  assert.deepEqual(Object.keys(BUILD_COMPILERS), ['agbcc', 'old_agbcc']);
  assert.deepEqual(BUILD_COMPILERS['agbcc'], {
    id: 'agbcc',
    cc1: 'tools/agbcc/bin/agbcc',
    flags: ['-mthumb-interwork', '-Wimplicit', '-Wparentheses', '-O2', '-fhex-asm'],
    rule: 'templates/compilers/agbcc.mk',
  });
  assert.equal(BUILD_COMPILERS['old_agbcc']?.cc1, 'tools/agbcc/bin/old_agbcc');
  assert.equal(BUILD_COMPILERS['old_agbcc']?.rule, 'templates/compilers/old_agbcc.mk');
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
