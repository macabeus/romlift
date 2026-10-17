// The assembler dialect: the preamble every generated file starts with, the macros of
// include/macros.inc (named as in the proof of concept's scaffold) and the arguments of `as`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIALECT } from '../../../src/foundation/asm/dialect.ts';

test('the preamble selects unified syntax, includes the macros and sets the mode', () => {
  assert.equal(DIALECT.preamble('thumb'), '.syntax unified\n.include "include/macros.inc"\n.thumb\n');
  assert.equal(DIALECT.preamble('arm'), '.syntax unified\n.include "include/macros.inc"\n.arm\n');
});

test('macros.inc defines the function macros and their module-local variants', () => {
  const names = [...DIALECT.macrosInc.matchAll(/^\t\.macro (\w+) name$/gm)].map((m) => m[1]);
  assert.deepEqual(names, [
    'arm_func_start',
    'arm_func_start_local',
    'arm_func_end',
    'thumb_func_start',
    'thumb_func_start_local',
    'non_word_aligned_thumb_func_start',
    'non_word_aligned_thumb_func_start_local',
    'thumb_func_end',
  ]);
  assert.equal(DIALECT.macrosInc.match(/\.endm/g)?.length, names.length);
});

test('a start macro aligns, exports, sets the mode and types the symbol; the local and 2-mod-4 ones omit their part', () => {
  const body = (name: string): string => {
    const start = DIALECT.macrosInc.indexOf(`.macro ${name} name\n`);
    return DIALECT.macrosInc.slice(start, DIALECT.macrosInc.indexOf('.endm', start));
  };
  assert.match(body('thumb_func_start'), /\.align 2, 0\n\t\.global \\name\n\t\.thumb\n\t\.thumb_func\n\t\.type \\name, %function/);
  assert.doesNotMatch(body('thumb_func_start_local'), /\.global/);
  assert.doesNotMatch(body('non_word_aligned_thumb_func_start'), /\.align/);
  assert.match(body('arm_func_start'), /\.align 2, 0\n\t\.global \\name\n\t\.arm\n\t\.type \\name, %function/);
  assert.match(body('thumb_func_end'), /\.size \\name, \.-\\name/);
});

test('as runs for the ARM7TDMI', () => {
  assert.deepEqual(DIALECT.asArgs, ['-mcpu=arm7tdmi']);
});
