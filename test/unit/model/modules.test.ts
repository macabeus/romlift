// The model's modules (architecture §6.2, §6.7, D46, D47): spans from the config's starts, E_MODULE_ORDER and
// E_MODULE_BORDER (naming the nearest legal borders), the build compiler and its flags, the library, and the
// run address of a runs_at override (identity in phase 3) or E_OVERRIDE_INVALID.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUILD_COMPILERS } from '../../../src/core/config/compilers.ts';
import { loadAddressOf, loadModuleAt, planModules, relocatedModules, runModuleAt, runOffsetAt } from '../../../src/core/model/modules.ts';
import { BASE, configOf, HEADER_END, romWith } from '../layout/hand-made.ts';

const ROM = romWith([], { size: 0x400 });
const BORDERS = [BASE, HEADER_END, BASE + 0x100, BASE + 0x200, BASE + 0x300];

test('modules span from their start to the next one, the last to the ROM end, with the build compiler resolved', () => {
  const config = configOf({
    modules: [
      ['rom_header', BASE],
      ['main', HEADER_END],
      { name: 'm4a', start: BASE + 0x200, kind: 'asm', generated: false, library: 'm4a', version: '2001', compiler: 'old_agbcc', cflags: ['-ftst'] },
      { name: 'data', start: BASE + 0x300, kind: 'data', generated: true },
    ],
  });
  const { modules, diagnostics } = planModules(ROM, config, BORDERS);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    modules.map((m) => [m.name, m.span.start - BASE, m.span.end - BASE, m.kind, m.generated, m.compiler]),
    [
      ['rom_header', 0, 0xc0, 'asm', true, 'agbcc'],
      ['main', 0xc0, 0x200, 'asm', true, 'agbcc'],
      ['m4a', 0x200, 0x300, 'asm', false, 'old_agbcc'],
      ['data', 0x300, 0x400, 'data', true, 'agbcc'],
    ],
  );
  assert.deepEqual(modules[2]?.cflags, [...(BUILD_COMPILERS['old_agbcc']?.flags ?? []), '-ftst']);
  assert.deepEqual(modules[1]?.cflags, BUILD_COMPILERS['agbcc']?.flags);
  assert.deepEqual(modules[2]?.library, { name: 'm4a', version: '2001' });
  assert.equal(modules[0]?.library, undefined);
});

test('a start that is not a legal border is E_MODULE_BORDER naming the nearest legal borders below and above', () => {
  const config = configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], ['moved', BASE + 0x180]] });
  const { modules, diagnostics } = planModules(ROM, config, BORDERS);
  assert.equal(diagnostics.length, 1);
  const d = diagnostics[0];
  assert.equal(d?.code, 'E_MODULE_BORDER');
  assert.equal(d?.severity, 'error');
  assert.equal(d?.addr, BASE + 0x180);
  assert.deepEqual(d?.cites, [BASE + 0x100, BASE + 0x200]);
  assert.match(d?.message ?? '', /0x08000100 below and 0x08000200 above/);
  assert.equal(modules[2]?.span.start, BASE + 0x180, 'the module is kept where the config puts it');
});

test('starts that do not increase are E_MODULE_ORDER and are left out; a first start above the base is moved to it', () => {
  const config = configOf({ modules: [['rom_header', BASE], ['main', BASE + 0x200], ['back', BASE + 0x100], ['same', BASE + 0x200]] });
  const { modules, diagnostics } = planModules(ROM, config, BORDERS);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.addr]), [
    ['E_MODULE_ORDER', BASE + 0x100],
    ['E_MODULE_ORDER', BASE + 0x200],
  ]);
  assert.deepEqual(modules.map((m) => m.name), ['rom_header', 'main']);

  const late = planModules(ROM, configOf({ modules: [['main', HEADER_END]] }), BORDERS);
  assert.deepEqual(late.diagnostics.map((d) => d.code), ['E_MODULE_ORDER']);
  assert.equal(late.modules[0]?.span.start, BASE);

  const none = planModules(ROM, configOf({ modules: [] }), BORDERS);
  assert.deepEqual(none.diagnostics.map((d) => d.code), ['E_MODULE_ORDER']);
  assert.deepEqual(none.modules.map((m) => [m.name, m.span.start, m.span.end]), [['main', BASE, ROM.end]]);

  const outside = planModules(ROM, configOf({ modules: [['rom_header', BASE], ['past', ROM.end]] }), BORDERS);
  assert.deepEqual(outside.diagnostics.map((d) => d.code), ['E_MODULE_BORDER']);
  assert.equal(outside.modules.length, 1);
});

test('a runs_at override bounded by module borders sets the run address of its modules (identity in phase 3)', () => {
  const modules3 = [['rom_header', BASE], ['main', HEADER_END], ['iwram', BASE + 0x200], ['data', BASE + 0x300]] as const;
  const identity = planModules(ROM, configOf({ modules: modules3, overrides: [{ start: BASE + 0x200, size: 0x100, kind: 'code', runsAt: BASE + 0x200 }] }), BORDERS);
  assert.deepEqual(identity.diagnostics, []);
  assert.deepEqual(identity.modules.map((m) => m.runAt), [undefined, undefined, BASE + 0x200, undefined]);
  const relocated = relocatedModules(identity.modules);
  assert.equal(runOffsetAt(relocated, BASE + 0x210), 0);

  const ram = planModules(ROM, configOf({ modules: modules3, overrides: [{ start: BASE + 0x200, size: 0x100, kind: 'code', runsAt: 0x0300_0000 }] }), BORDERS);
  const moved = relocatedModules(ram.modules);
  assert.equal(ram.modules[2]?.runAt, 0x0300_0000);
  assert.equal(runOffsetAt(moved, BASE + 0x210), 0x0300_0000 - (BASE + 0x200));
  assert.equal(runOffsetAt(moved, BASE + 0x110), 0);
  assert.equal(loadAddressOf(moved, 0x0300_0010), BASE + 0x210);
  assert.equal(loadAddressOf(moved, BASE + 0x110), BASE + 0x110);
  assert.equal(runModuleAt(ram.modules, moved, 0x0300_0010), 2);
  assert.equal(loadModuleAt(ram.modules, 0x0300_0010), -1);
  assert.equal(runModuleAt(ram.modules, [], BASE + 0x110), 1);
});

test('a runs_at range that does not start and end on module borders is E_OVERRIDE_INVALID', () => {
  const config = configOf({
    modules: [['rom_header', BASE], ['main', HEADER_END], ['iwram', BASE + 0x200]],
    overrides: [
      { start: BASE + 0x200, size: 0x80, kind: 'code', runsAt: 0x0300_0000 },
      { start: BASE + 0x100, size: 0x40, kind: 'data' },
    ],
  });
  const { modules, diagnostics } = planModules(ROM, config, BORDERS);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.span]), [['E_OVERRIDE_INVALID', { start: BASE + 0x200, end: BASE + 0x280 }]]);
  assert.ok(modules.every((m) => m.runAt === undefined));
  const toEnd = planModules(ROM, configOf({ modules: [['rom_header', BASE], ['iwram', BASE + 0x200]], overrides: [{ start: BASE + 0x200, size: 0x200, kind: 'code', runsAt: 0x0300_0000 }] }), BORDERS);
  assert.deepEqual(toEnd.diagnostics, [], 'the ROM end is a border');
});
