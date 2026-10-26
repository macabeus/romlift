// A C stub read back (core/verify/c-stub.ts, D74 g): its INCLUDE_ASM statements as chunk files with their lines, and
// every reason it is not a stub-only unit; stubAssemblyOf gives the agbcc assembly of a stub-only one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stubAssemblyText } from '../../../src/core/model/c-unit.ts';
import { readStub, stubAssemblyOf } from '../../../src/core/verify/c-stub.ts';
import { C_STUB_HEADER } from '../../../src/foundation/asm/dialect.ts';

const STUB = `${C_STUB_HEADER}INCLUDE_ASM("asm/nonmatchings/main", A);\n/* kept */\nINCLUDE_ASM("asm/nonmatchings/main", B_08000100);\n`;

test('a stub-only unit: its includes in text order, no problem, and its assembly', () => {
  assert.deepEqual(readStub(STUB), {
    includes: [
      { path: 'asm/nonmatchings/main/A.s', line: 3 },
      { path: 'asm/nonmatchings/main/B_08000100.s', line: 5 },
    ],
    problems: [],
  });
  assert.deepEqual(stubAssemblyOf(STUB, 'old_agbcc'), { ok: true, text: stubAssemblyText(['asm/nonmatchings/main/A.s', 'asm/nonmatchings/main/B_08000100.s'], 'old_agbcc') });
  assert.deepEqual(readStub(C_STUB_HEADER), { includes: [], problems: [] }, 'a module without chunk files');
  assert.deepEqual(readStub(''), { includes: [], problems: [] });
});

test('every reason a C text is not a stub-only unit, by line', () => {
  const text = `#define FOO\n${C_STUB_HEADER}#include "include_asm.h"\nint x;\nINCLUDE_ASM("asm/nonmatchings/main", A);\nvoid F(void) { }\n"open`;
  const reading = readStub(text);
  assert.deepEqual(
    reading.problems.map((p) => p.line),
    [1, 4, 5, 7, 8, 8],
  );
  const refused = stubAssemblyOf(text, 'agbcc');
  assert.equal(refused.ok, false);
  assert.ok(!refused.ok && refused.problems.length === 6);
});
