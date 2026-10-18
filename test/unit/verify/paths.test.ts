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
