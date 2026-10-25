// The model's modules (architecture §6.2, §6.7, D46, D47): spans from the config's starts, E_MODULE_ORDER and
// E_MODULE_BORDER (naming the nearest legal borders), the build compiler and its flags, the library, and the
// run address of a runs_at override (identity in phase 3) or E_OVERRIDE_INVALID.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUILD_COMPILERS } from '../../../src/core/config/compilers.ts';
import { dataRangeModuleAt, loadAddressOf, loadModuleAt, moduleIndexAt, modulePieces, planModules, relocatedModules, runOffsetAt, runStartOf, toLoad } from '../../../src/core/model/modules.ts';
import type { ModuleConfig, RomliftConfig } from '../../../src/core/config/schema.ts';

type RomliftConfigOverrides = RomliftConfig['overrides'];
import { isLegalStart } from '../../../src/core/layout/borders.ts';
import { BASE, configOf, HEADER_END, romWith } from '../layout/hand-made.ts';

const ROM = romWith([], { size: 0x400 });
const BORDERS = [BASE, HEADER_END, BASE + 0x100, BASE + 0x200, BASE + 0x300];
/** The border rule of BORDERS with no data region past them (the data start at the ROM end). */
const RULE = { borders: BORDERS, dataStart: ROM.end, end: ROM.end };

test('modules span from their start to the next one, the last to the ROM end, with the build compiler resolved', () => {
  const config = configOf({
    modules: [
      ['rom_header', BASE],
      ['main', HEADER_END],
      { name: 'm4a', start: BASE + 0x200, kind: 'asm', generated: false, library: 'm4a', version: '2001', compiler: 'old_agbcc', cflags: ['-ftst'] },
      { name: 'data', start: BASE + 0x300, kind: 'data', generated: true },
    ],
  });
  const { modules, diagnostics } = planModules(ROM, config, RULE);
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
  const { modules, diagnostics } = planModules(ROM, config, RULE);
  assert.equal(diagnostics.length, 1);
  const d = diagnostics[0];
  assert.equal(d?.code, 'E_MODULE_BORDER');
  assert.equal(d?.severity, 'error');
  assert.equal(d?.addr, BASE + 0x180);
  assert.deepEqual(d?.cites, [BASE + 0x100, BASE + 0x200]);
  assert.match(d?.message ?? '', /0x08000100 below and 0x08000200 above/);
  assert.equal(modules[2]?.span.start, BASE + 0x180, 'the module is kept where the config puts it');
});

test('past the data start every word-aligned address is a legal start (D75 a); below it only the legal borders are', () => {
  const rule = { borders: BORDERS, dataStart: BASE + 0x2f0, end: ROM.end };
  const config = configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], ['data', BASE + 0x318]] });
  assert.deepEqual(planModules(ROM, config, rule).diagnostics, [], 'a data border the TOML keeps past a lower data start');
  assert.deepEqual(planModules(ROM, config, RULE).diagnostics.map((d) => d.code), ['E_MODULE_BORDER'], 'without the data start the same start is refused');
  assert.equal(isLegalStart(rule, BASE + 0x2f0), true);
  assert.equal(isLegalStart(rule, BASE + 0x31a), false, 'not word-aligned');
  assert.equal(isLegalStart(rule, BASE + 0x2ec), false, 'below the data start, and no legal border');
  assert.equal(isLegalStart(rule, ROM.end), false, 'the ROM end starts nothing');
  // E_MODULE_BORDER in the data region names the nearest words, from core/layout's one rule.
  const unaligned = planModules(ROM, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], ['data', BASE + 0x31a]] }), rule).diagnostics;
  assert.deepEqual(unaligned.map((d) => [d.code, d.cites]), [['E_MODULE_BORDER', [BASE + 0x318, BASE + 0x31c]]]);
  assert.match(unaligned[0]?.message ?? '', /0x08000318 below and 0x0800031C above/);
});

test('starts that do not increase are E_MODULE_ORDER and are left out; a first start above the base is moved to it', () => {
  const config = configOf({ modules: [['rom_header', BASE], ['main', BASE + 0x200], ['back', BASE + 0x100], ['same', BASE + 0x200]] });
  const { modules, diagnostics } = planModules(ROM, config, RULE);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.addr]), [
    ['E_MODULE_ORDER', BASE + 0x100],
    ['E_MODULE_ORDER', BASE + 0x200],
  ]);
  assert.deepEqual(modules.map((m) => m.name), ['rom_header', 'main']);

  const late = planModules(ROM, configOf({ modules: [['main', HEADER_END]] }), RULE);
  assert.deepEqual(late.diagnostics.map((d) => d.code), ['E_MODULE_ORDER']);
  assert.equal(late.modules[0]?.span.start, BASE);

  const none = planModules(ROM, configOf({ modules: [] }), RULE);
  assert.deepEqual(none.diagnostics.map((d) => d.code), ['E_MODULE_ORDER']);
  assert.deepEqual(none.modules.map((m) => [m.name, m.span.start, m.span.end]), [['main', BASE, ROM.end]]);

  const outside = planModules(ROM, configOf({ modules: [['rom_header', BASE], ['past', ROM.end]] }), RULE);
  assert.deepEqual(outside.diagnostics.map((d) => d.code), ['E_MODULE_BORDER']);
  assert.equal(outside.modules.length, 1);
});

test('a runs_at override bounded by module borders sets the run address of its modules (identity in phase 3)', () => {
  const modules3 = [['rom_header', BASE], ['main', HEADER_END], ['iwram', BASE + 0x200], ['data', BASE + 0x300]] as const;
  const identity = planModules(ROM, configOf({ modules: modules3, overrides: [{ start: BASE + 0x200, size: 0x100, kind: 'code', runsAt: BASE + 0x200 }] }), RULE);
  assert.deepEqual(identity.diagnostics, []);
  assert.deepEqual(identity.modules.map((m) => m.runAt), [undefined, undefined, BASE + 0x200, undefined]);
  const relocated = relocatedModules(identity.modules);
  assert.equal(runOffsetAt(relocated, BASE + 0x210), 0);

  const ram = planModules(ROM, configOf({ modules: modules3, overrides: [{ start: BASE + 0x200, size: 0x100, kind: 'code', runsAt: 0x0300_0000 }] }), RULE);
  const moved = relocatedModules(ram.modules);
  assert.equal(ram.modules[2]?.runAt, 0x0300_0000);
  assert.equal(runOffsetAt(moved, BASE + 0x210), 0x0300_0000 - (BASE + 0x200));
  assert.equal(runOffsetAt(moved, BASE + 0x110), 0);
  assert.equal(loadAddressOf(moved, 0x0300_0010), BASE + 0x210);
  assert.equal(loadAddressOf(moved, BASE + 0x110), BASE + 0x110);
  assert.equal(moduleIndexAt(ram.modules, 0x0300_0010, moved), 2);
  assert.equal(moduleIndexAt(ram.modules, 0x0300_0010, ram.modules), 2, 'every module looked at gives the same index');
  assert.equal(loadModuleAt(ram.modules, 0x0300_0010), -1);
  assert.equal(moduleIndexAt(ram.modules, BASE + 0x110, []), 1);
  assert.equal(moduleIndexAt(ram.modules, BASE + 0x210, moved), 2, 'a load address inside the runs_at module');
  const module = ram.modules[2];
  assert.ok(module !== undefined);
  assert.equal(runStartOf(module), 0x0300_0000);
  assert.equal(toLoad(module, 0x0300_0010), BASE + 0x210);
  const plain = ram.modules[1];
  assert.ok(plain !== undefined);
  assert.equal(runStartOf(plain), plain.span.start);
  assert.equal(toLoad(plain, BASE + 0x110), BASE + 0x110);
});

test('a runs_at range that does not start and end on module borders is E_OVERRIDE_INVALID', () => {
  const config = configOf({
    modules: [['rom_header', BASE], ['main', HEADER_END], ['iwram', BASE + 0x200]],
    overrides: [
      { start: BASE + 0x200, size: 0x80, kind: 'code', runsAt: 0x0300_0000 },
      { start: BASE + 0x100, size: 0x40, kind: 'data' },
    ],
  });
  const { modules, diagnostics } = planModules(ROM, config, RULE);
  assert.deepEqual(diagnostics.map((d) => [d.code, d.span]), [['E_OVERRIDE_INVALID', { start: BASE + 0x200, end: BASE + 0x280 }]]);
  assert.ok(modules.every((m) => m.runAt === undefined));
  const toEnd = planModules(ROM, configOf({ modules: [['rom_header', BASE], ['iwram', BASE + 0x200]], overrides: [{ start: BASE + 0x200, size: 0x200, kind: 'code', runsAt: 0x0300_0000 }] }), RULE);
  assert.deepEqual(toEnd.diagnostics, [], 'the ROM end is a border');
});

// C data ranges (architecture §6.6, phase 6, D92): a `c` module's data_start D starts [D, the next module start or the
// ROM end); a data module at D is dropped, one holding D is clipped there, and every illegal data_start is
// E_DATA_RANGE_INVALID, leaving the module without a range.

/** The border rule of BORDERS with the data start at 0x300: the bytes from there are data. */
const DATA_RULE = { borders: BORDERS, dataStart: BASE + 0x300, end: ROM.end };

function cModule(name: string, start: number, dataStart?: number): ModuleConfig {
  return { name, start, kind: 'c', generated: true, ...(dataStart === undefined ? {} : { dataStart }) };
}

function spans(modules: readonly { readonly name: string; readonly span: { readonly start: number; readonly end: number }; readonly dataRange?: { readonly start: number; readonly end: number } }[]) {
  return modules.map((m) => [m.name, m.span.start - BASE, m.span.end - BASE, ...(m.dataRange === undefined ? [] : [m.dataRange.start - BASE, m.dataRange.end - BASE])]);
}

test('a data range at a data module\'s start drops that module; the C module\'s span is its text', () => {
  const config = configOf({ modules: [['rom_header', BASE], cModule('main', HEADER_END, BASE + 0x300), { name: 'data', start: BASE + 0x300, kind: 'data', generated: true }] });
  const { modules, diagnostics } = planModules(ROM, config, DATA_RULE);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(spans(modules), [
    ['rom_header', 0, 0xc0],
    ['main', 0xc0, 0x300, 0x300, 0x400],
  ]);
  assert.deepEqual(
    modulePieces(modules).map((p) => [p.module, p.part, p.span.start - BASE]),
    [
      [0, 'text', 0],
      [1, 'text', 0xc0],
      [1, 'data', 0x300],
    ],
  );
  assert.equal(dataRangeModuleAt(modules, BASE + 0x3fc), 1);
  assert.equal(dataRangeModuleAt(modules, BASE + 0x2fc), -1);
  assert.equal(loadModuleAt(modules, BASE + 0x300), -1, 'a data range lies in no module span');
});

test('a data range inside a data module clips it at the range start; the range ends at the next module start', () => {
  const clipped = planModules(ROM, configOf({ modules: [['rom_header', BASE], cModule('main', HEADER_END, BASE + 0x340), { name: 'data', start: BASE + 0x300, kind: 'data', generated: true }] }), DATA_RULE);
  assert.deepEqual(clipped.diagnostics, []);
  assert.deepEqual(spans(clipped.modules), [
    ['rom_header', 0, 0xc0],
    ['main', 0xc0, 0x300, 0x340, 0x400],
    ['data', 0x300, 0x340],
  ]);
  assert.deepEqual(
    modulePieces(clipped.modules).map((p) => [p.module, p.part]),
    [
      [0, 'text'],
      [1, 'text'],
      [2, 'text'],
      [1, 'data'],
    ],
  );
  const bounded = planModules(
    ROM,
    configOf({ modules: [['rom_header', BASE], cModule('main', HEADER_END, BASE + 0x300), { name: 'data', start: BASE + 0x300, kind: 'data', generated: true }, { name: 'tail', start: BASE + 0x380, kind: 'data', generated: true }] }),
    DATA_RULE,
  );
  assert.deepEqual(bounded.diagnostics, []);
  assert.deepEqual(spans(bounded.modules), [
    ['rom_header', 0, 0xc0],
    ['main', 0xc0, 0x300, 0x300, 0x380],
    ['tail', 0x380, 0x400],
  ]);
  const own = planModules(ROM, configOf({ modules: [['rom_header', BASE], cModule('main', HEADER_END, BASE + 0x340)] }), DATA_RULE);
  assert.deepEqual(own.diagnostics, []);
  assert.deepEqual(spans(own.modules), [
    ['rom_header', 0, 0xc0],
    ['main', 0xc0, 0x340, 0x340, 0x400],
  ], 'a range inside its own module ends that module\'s text');
});

test('every illegal data_start is E_DATA_RANGE_INVALID at its address, and the module gets no range', () => {
  const data = (start: number): ModuleConfig => ({ name: 'data', start, kind: 'data', generated: true });
  const cases: readonly { readonly why: string; readonly modules: readonly ModuleConfig[]; readonly overrides?: RomliftConfigOverrides; readonly message: RegExp; readonly at: number }[] = [
    { why: 'an asm module', modules: [{ name: 'main', start: HEADER_END, kind: 'asm', generated: true, dataStart: BASE + 0x300 }, data(BASE + 0x300)], message: /legal only on a module of kind = "c", and main is kind = "asm"/, at: 0x300 },
    { why: 'a data module', modules: [cModule('main', HEADER_END), { ...data(BASE + 0x300), dataStart: BASE + 0x340 }], message: /legal only on a module of kind = "c"/, at: 0x340 },
    { why: 'not word-aligned', modules: [cModule('main', HEADER_END, BASE + 0x342), data(BASE + 0x300)], message: /not word-aligned/, at: 0x342 },
    { why: 'below the data start', modules: [cModule('main', HEADER_END, BASE + 0x2fc), data(BASE + 0x300)], message: /below the data start 0x08000300, where code lies/, at: 0x2fc },
    { why: 'at the ROM end', modules: [cModule('main', HEADER_END, BASE + 0x400)], message: /at or past the ROM end 0x08000400/, at: 0x400 },
    { why: 'at its own start', modules: [cModule('main', HEADER_END), cModule('late', BASE + 0x300, BASE + 0x300)], message: /does not lie past the module's start 0x08000300/, at: 0x300 },
    {
      why: 'inside a runs_at range',
      modules: [cModule('main', HEADER_END, BASE + 0x340), { name: 'ram', start: BASE + 0x300, kind: 'asm', generated: true }],
      overrides: [{ start: BASE + 0x300, size: 0x100, kind: 'code', runsAt: 0x0300_0000 }],
      message: /overlaps the runs_at range \[0x08000300, 0x08000400\)/,
      at: 0x340,
    },
    { why: 'cutting an asm module', modules: [cModule('main', HEADER_END, BASE + 0x340), { name: 'tail', start: BASE + 0x300, kind: 'asm', generated: true }], message: /cuts module tail, which is neither main nor a data module/, at: 0x340 },
    { why: 'covering an asm module', modules: [cModule('main', HEADER_END, BASE + 0x300), { name: 'tail', start: BASE + 0x300, kind: 'asm', generated: true }], message: /covers module tail, which is not a data module/, at: 0x300 },
    { why: 'overlapping another range', modules: [cModule('main', HEADER_END, BASE + 0x340), cModule('other', BASE + 0x200, BASE + 0x380), data(BASE + 0x300)], message: /overlaps module main's data range \[0x08000340, 0x08000400\)/, at: 0x380 },
  ];
  for (const c of cases) {
    const config = configOf({ modules: [['rom_header', BASE], ...c.modules], ...(c.overrides === undefined ? {} : { overrides: c.overrides }) });
    const { modules, diagnostics } = planModules(ROM, config, DATA_RULE);
    const ranged = diagnostics.filter((d) => d.code === 'E_DATA_RANGE_INVALID');
    assert.equal(ranged.length, 1, `${c.why}: ${diagnostics.map((d) => d.message).join('; ')}`);
    assert.equal(ranged[0]?.severity, 'error');
    assert.equal(ranged[0]?.addr, BASE + c.at, c.why);
    assert.match(ranged[0]?.message ?? '', c.message, c.why);
    const failing = c.modules.find((m) => m.dataStart === BASE + c.at)?.name;
    assert.equal(modules.find((m) => m.name === failing)?.dataRange, undefined, `${c.why}: no range`);
  }
});
