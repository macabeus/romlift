// The C-stub part of the dialect (architecture §6.3 `c-stub`, §6.6, D74): the INCLUDE_ASM statement, the header
// that defines the macro, and the lines a generated src/<module>.c starts with. The header must expand, after a C
// preprocessor, to a file-scope asm statement that includes the chunk file in romlift's `.s` dialect.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nonmatchingDir } from '../../../src/core/model/paths.ts';
import { C_STUB_HEADER, DIALECT, INCLUDE_ASM_HEADER, includeAsmStatement } from '../../../src/foundation/asm/dialect.ts';
import { INCLUDE_ASM_HEADER_PATH, NONMATCHINGS_ROOT } from '../../../src/foundation/util/project-files.ts';

test('includeAsmStatement spells the stub of a chunk file in its module directory', () => {
  assert.equal(includeAsmStatement('main', 'AgbMain'), 'INCLUDE_ASM("asm/nonmatchings/main", AgbMain);');
  assert.equal(includeAsmStatement('main_2', 'VBlankCB_08001234'), 'INCLUDE_ASM("asm/nonmatchings/main_2", VBlankCB_08001234);');
  assert.equal(`${NONMATCHINGS_ROOT}/m`, nonmatchingDir('m'), 'the directory the function writer writes to');
});

test('the C stub header includes include_asm.h through -I include', () => {
  assert.equal(INCLUDE_ASM_HEADER_PATH, 'include/include_asm.h');
  assert.equal(C_STUB_HEADER, '#include "include_asm.h"\n\n');
});

test('INCLUDE_ASM_HEADER defines the macro once, guarded, and includes the macro file once', () => {
  const lines = INCLUDE_ASM_HEADER.split('\n');
  assert.equal(lines[0], '#ifndef GUARD_INCLUDE_ASM_H');
  assert.equal(lines[1], '#define GUARD_INCLUDE_ASM_H');
  assert.equal(lines.filter((l) => l.startsWith('#define INCLUDE_ASM(DIR, NAME) ')).length, 1);
  assert.ok(INCLUDE_ASM_HEADER.endsWith('#endif\n'));
  assert.ok(lines.includes(`asm("${DIALECT.macrosInclude.replace(/"/g, '\\"')}\\n");`), 'the macro file, once per translation unit');
});

/** What a C preprocessor and agbcc make of one INCLUDE_ASM statement: the assembly text of its asm string. */
function expand(statement: string): string {
  const define = /^#define INCLUDE_ASM\(DIR, NAME\) asm\((.*)\)$/m.exec(INCLUDE_ASM_HEADER)?.[1];
  const call = /^INCLUDE_ASM\("([^"]*)", ([A-Za-z0-9_.$]+)\);$/.exec(statement);
  assert.ok(define !== undefined && call?.[1] !== undefined && call[2] !== undefined);
  // Substitute the parameters (#NAME stringifies), then concatenate the adjacent string literals and unescape.
  const substituted = define.replace(/#NAME/g, `"${call[2]}"`).replace(/\bDIR\b/g, `"${call[1]}"`);
  const literals = [...substituted.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? '');
  assert.equal(substituted.replace(/"((?:[^"\\]|\\.)*)"/g, '').trim(), '', 'only string literals remain');
  return literals.join('').replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c));
}

test('an INCLUDE_ASM statement expands to the include of its chunk file in unified syntax, then back to divided', () => {
  assert.equal(expand(includeAsmStatement('main', 'AgbMain')), '.syntax unified\n.include "asm/nonmatchings/main/AgbMain.s"\n.syntax divided\n');
});
