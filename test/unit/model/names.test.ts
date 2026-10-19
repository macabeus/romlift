// Names (architecture §6.2, D9): the default spellings, where a function's name came from, and names unique
// within a module; a name may repeat in another module only while every label of it is module-scoped.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildModel } from '../../../src/core/model/model.ts';
import { dataName, functionName, invalidNames, isDefaultSpelling, localName, nameCollisions, nameSourceOf, orphanName } from '../../../src/core/model/names.ts';
import type { Module } from '../../../src/core/model/types.ts';
import { analysisOf, BASE, configOf, fact, HEADER_END, romWith, thumbAt } from '../layout/hand-made.ts';

test('the default spellings: sub_, unk_, _ and gUnk_ with eight upper-case hex digits', () => {
  assert.equal(functionName(0x0800_00ab), 'sub_080000AB');
  assert.equal(orphanName(0x0800_00ab), 'unk_080000AB');
  assert.equal(localName(0x0800_00ab), '_080000AB');
  assert.equal(dataName(0x0300_0010), 'gUnk_03000010');
  for (const name of ['sub_080000AB', 'unk_080000AB', '_080000AB', 'gUnk_03000010']) assert.ok(isDefaultSpelling(name), name);
  for (const name of ['sub_080000ab', 'Main', 'sub_0800AB', 'r0']) assert.ok(!isDefaultSpelling(name), name);
});

test('a config name equal to the default spelling is a default name; another one is the TOML\'s, with its from key', () => {
  assert.deepEqual(nameSourceOf(0x0800_0100, { name: 'sub_08000100' }), { kind: 'default' });
  assert.deepEqual(nameSourceOf(0x0800_0100, { name: 'sub_08000100', from: 'sig:m4a@2001' }), { kind: 'default' });
  assert.deepEqual(nameSourceOf(0x0800_0100, { name: 'Main' }), { kind: 'toml' });
  assert.deepEqual(nameSourceOf(0x0800_0100, { name: 'm4aSoundMain', from: 'sig:m4a@2001' }), { kind: 'toml', from: 'sig:m4a@2001' });
});

const MODULES: Module[] = ['alpha', 'beta'].map((name, i) => ({
  name,
  span: { start: BASE + 0x1000 * (i + 1), end: BASE + 0x1000 * (i + 2) },
  kind: 'asm',
  generated: true,
  compiler: 'agbcc',
  cflags: [],
  chunks: { first: i, count: 1 },
}));

test('nameCollisions: a module-scoped name repeated in two modules is allowed; a global one, or one used twice in a module, is not', () => {
  const A = BASE + 0x1000;
  const B = BASE + 0x2000;
  assert.deepEqual(nameCollisions([{ name: 'sub_static', addr: A, scope: 'module' }, { name: 'sub_static', addr: B, scope: 'module' }], MODULES), []);
  assert.deepEqual(nameCollisions([{ name: 'x', addr: A, scope: 'module' }, { name: 'x', addr: A, scope: 'global' }], MODULES), [], 'one address');
  const referenced = nameCollisions([{ name: 'sub_static', addr: A, scope: 'module' }, { name: 'sub_static', addr: B, scope: 'global' }], MODULES);
  assert.deepEqual(referenced.map((d) => [d.code, d.severity, d.addr, d.cites]), [['E_NAME_COLLISION', 'error', A, [A, B]]]);
  assert.match(referenced[0]?.message ?? '', /sub_static .*in two modules.*0x08001000 \(alpha\), 0x08002000 \(beta, global\)/);
  const twice = nameCollisions([{ name: 'Dup', addr: A + 0x10, scope: 'module' }, { name: 'Dup', addr: A, scope: 'module' }], MODULES);
  assert.deepEqual(twice.map((d) => [d.code, d.addr]), [['E_NAME_COLLISION', A]]);
  assert.match(twice[0]?.message ?? '', /twice in one module/);
});

test('buildModel: two functions of one name in one module, or an alias equal to another name, are E_NAME_COLLISION', () => {
  const code = thumbAt(BASE + 0x100)`
    bx lr
    bx lr
    bx lr
    bx lr
  `;
  const rom = romWith([{ at: BASE + 0x100, bytes: code }], { size: 0x200 });
  const analysis = analysisOf(rom, { functions: [0, 2, 4, 6].map((o) => fact({ entry: BASE + 0x100 + o, end: BASE + 0x102 + o })) });
  const modules = [['rom_header', BASE], ['main', HEADER_END]] as const;
  const same = buildModel(rom, analysis, configOf({ modules, functions: [[BASE + 0x100, 'Twin'], [BASE + 0x102, 'Twin'], [BASE + 0x104, 'C'], [BASE + 0x106, 'D']] }));
  assert.deepEqual(same.diagnostics.map((d) => [d.code, d.addr]), [['E_NAME_COLLISION', BASE + 0x100]]);
  const alias = buildModel(rom, analysis, configOf({ modules, functions: [[BASE + 0x100, { name: 'A', aliases: ['D'] }], [BASE + 0x102, 'B'], [BASE + 0x104, 'C'], [BASE + 0x106, 'D']] }));
  assert.deepEqual(alias.diagnostics.map((d) => d.code), ['E_NAME_COLLISION']);
  assert.deepEqual(alias.functions[0]?.aliases, ['D']);
  const clean = buildModel(rom, analysis, configOf({ modules, functions: [[BASE + 0x100, { name: 'A', aliases: ['A2'] }], [BASE + 0x102, 'B'], [BASE + 0x104, 'C'], [BASE + 0x106, 'D']] }));
  assert.deepEqual(clean.diagnostics, []);
});

test('a name longer than 200 characters is E_NAME_INVALID: it is a file name, which a file system stores in at most 255 bytes (correctness-r1-2)', () => {
  const at = 0x0804_0b50;
  assert.deepEqual(invalidNames([{ name: `F${'x'.repeat(199)}`, addr: at }]), []);
  const found = invalidNames([{ name: `F${'x'.repeat(299)}`, addr: at }]);
  assert.deepEqual(found.map((d) => [d.code, d.addr]), [['E_NAME_INVALID', at]]);
  assert.match(found[0]?.message ?? '', /at most 200 characters/);
});
