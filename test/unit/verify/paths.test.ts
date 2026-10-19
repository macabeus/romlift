// The paths check (architecture §6.2, §6.4): duplicates and case-folded collisions, in one pass.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkPaths, foldPath, pathsCheck } from '../../../src/core/verify/paths.ts';

test('distinct paths pass', () => {
  assert.deepEqual(checkPaths(['asm/main.s', 'asm/nonmatchings/main/VBlankCB_08000100.s', 'asm/nonmatchings/main/VblankCB_08000200.s']), []);
  const result = pathsCheck(new Set(['a.s', 'b.s']));
  assert.equal(result.ok, true);
  assert.equal(result.detail, '2 paths, no two of them one file');
});

test('an exact duplicate and a case-folded collision are both E_PATH_CASE_COLLISION, on the later path', () => {
  const found = checkPaths(['asm/main/VBlankCB.s', 'data/data.s', 'asm/main/VblankCB.s', 'data/data.s', 'ASM/Main/vblankcb.s']);
  assert.deepEqual(
    found.map((d) => [d.code, d.path, d.message]),
    [
      ['E_PATH_CASE_COLLISION', 'asm/main/VblankCB.s', 'asm/main/VBlankCB.s and asm/main/VblankCB.s are one file on a case-insensitive file system'],
      ['E_PATH_CASE_COLLISION', 'data/data.s', 'the stream emits data/data.s twice'],
      ['E_PATH_CASE_COLLISION', 'ASM/Main/vblankcb.s', 'asm/main/VBlankCB.s and ASM/Main/vblankcb.s are one file on a case-insensitive file system'],
    ],
  );
  const result = pathsCheck(['x.s', 'X.s']);
  assert.equal(result.ok, false);
  assert.equal(result.id, 'paths');
});

test('folding lower-cases the whole path, directories included', () => {
  assert.equal(foldPath('Asm/NonMatchings/X.s'), 'asm/nonmatchings/x.s');
});

test('a path component longer than 255 bytes is E_PATH_TOO_LONG, so the write cannot fail part-way (correctness-r1-2)', () => {
  assert.deepEqual(checkPaths([`asm/nonmatchings/main/${'x'.repeat(253)}.s`]), []);
  const long = `asm/nonmatchings/main/F${'x'.repeat(299)}.s`;
  const found = checkPaths(['asm/main.s', long]);
  assert.deepEqual(found.map((d) => [d.code, d.path]), [['E_PATH_TOO_LONG', long]]);
  assert.match(found[0]?.message ?? '', /302 bytes, more than the 255/);
  assert.equal(pathsCheck([long]).ok, false);
  // UTF-8 bytes, not UTF-16 units: 128 two-byte characters are 256 bytes.
  assert.equal(checkPaths([`data/${'é'.repeat(128)}.s`])[0]?.code, 'E_PATH_TOO_LONG');
});
