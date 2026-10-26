// The map side of core/signatures/extract.ts (architecture §7.2, roadmap 6.A): object globs as the PoC wrote them
// (`*` spans '/', matched at a path-segment boundary), object base names and member ids, and the input placements of
// a GNU map, `.text` apart from the rest.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapPlacements, memberIdOf, objectBaseName, objectGlobMatches } from '../../../../src/core/signatures/extract.ts';
import { parseGnuMap } from '../../../../src/foundation/formats/gnu-map.ts';

test('object globs match the object as the map prints it, whole or from a path segment on; * spans /', () => {
  const yes: readonly (readonly [string, string])[] = [
    ['libgcc.a(*)', '../../tools/agbcc/lib/libgcc.a(_udivsi3.o)'],
    ['libagbsyscall.a(*)', '/Users/x/sa2/libagbsyscall/build/gba/libagbsyscall.a(CpuSet.o)'],
    ['src/m4a.o', 'src/m4a.o'],
    ['m4a.o', 'src/m4a.o'],
    ['src/lib/m4a/m4a0.o', 'src/lib/m4a/m4a0.o'],
    ['src/*.o', 'src/lib/m4a/m4a0.o'],
    ['fix_*.o', 'build/fix_math.o'],
    ['src/m4a_?.o', 'src/m4a_1.o'],
    ['*', 'anything/at/all.o'],
  ];
  for (const [glob, object] of yes) assert.ok(objectGlobMatches(glob, object), `${glob} ~ ${object}`);
  const no: readonly (readonly [string, string])[] = [
    ['src/m4a.o', 'src/m4a_1.o'],
    ['m4a.o', 'src/xm4a.o'],
    ['libgcc.a(*)', 'libgcc.a'],
    ['src/m4a.o', 'other/src/m4a.o.bak'],
    ['fix_*.o', 'build/fix_math.s'],
    ['src/m4a_?.o', 'src/m4a_12.o'],
    ['a.o', 'ba.o'],
  ];
  for (const [glob, object] of no) assert.ok(!objectGlobMatches(glob, object), `${glob} !~ ${object}`);
});

test('a base name is an archive member own name, else the file name; a member id is <symbol>@<base name>', () => {
  assert.equal(objectBaseName('../../tools/agbcc/lib/libgcc.a(_udivsi3.o)'), '_udivsi3.o');
  assert.equal(objectBaseName('libgcc.a(dp-bit.o)'), 'dp-bit.o');
  assert.equal(objectBaseName('src/m4a.o'), 'm4a.o');
  assert.equal(objectBaseName('m4a.o'), 'm4a.o');
  assert.equal(memberIdOf('__udivsi3', 'libgcc.a(_udivsi3.o)'), '__udivsi3@_udivsi3.o');
  assert.equal(memberIdOf('m4aSoundMain', 'src/m4a.o'), 'm4aSoundMain@m4a.o');
  assert.equal(memberIdOf('bad name', 'src/m4a.o'), undefined);
  assert.equal(memberIdOf('a@b', 'src/m4a.o'), undefined);
  assert.equal(memberIdOf('f', 'src/m4a.obj'), undefined);
});

const MAP = [
  'Linker script and memory map',
  '',
  '.text           0x08000000      0x30',
  ' .text          0x08000000       0x10 build/crt0.o',
  ' .text          0x08000010       0x18 ../lib/libgcc.a(_divsi3.o)',
  '                0x08000010                __divsi3',
  ' .text          0x08000028        0x0 build/empty.o',
  ' .rodata        0x08000028        0x8 build/data.o',
  '                0x08000028                gTable',
  '.bss            0x02000000        0x4',
  ' .bss           0x02000000        0x4 build/data.o',
  '',
].join('\n');

test('map placements: every input with a size, the .text ones apart, objects printed with their archive', () => {
  const map = parseGnuMap(MAP);
  assert.ok(map.ok, map.ok ? '' : map.error);
  const { text, data } = mapPlacements(map.value);
  assert.deepEqual(text, [
    { object: 'build/crt0.o', start: 0x0800_0000, size: 0x10 },
    { object: '../lib/libgcc.a(_divsi3.o)', start: 0x0800_0010, size: 0x18 },
  ]);
  assert.deepEqual(data, [
    { object: 'build/data.o', start: 0x0800_0028, size: 8 },
    { object: 'build/data.o', start: 0x0200_0000, size: 4 },
  ]);
});
