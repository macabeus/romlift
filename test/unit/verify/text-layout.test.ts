// The text-layout self-check (architecture §6.4, §6.7, D49): hand-written files of a consistent model lay
// out to their ROM ranges (a `.4byte Func` with the Thumb bit, a pool after `.align 2, 0`, an ARM chunk
// after `bx pc`, a module file of includes, the writers' data, ldscript and symbols files); every kind of
// difference is E_SELF_CHECK_TEXT with the file, the line and the address. A function chunk that folded the pad
// before its entry lays out from the pad, which its start macro's `.align 2, 0` emits as the padding item.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emitTree } from '../../../src/core/emit/emit-tree.ts';
import { cStubWriter } from '../../../src/core/emit/writers/c-stub.ts';
import { expectedWriter } from '../../../src/core/emit/writers/expected.ts';
import { WRITERS } from '../../../src/core/emit/writers/index.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import type { Model } from '../../../src/core/model/types.ts';
import { checkEntries, MAX_PER_ENTRY, textLayoutResult } from '../../../src/core/verify/text-layout.ts';
import { entryDiagnostics } from '../../helpers/text-layout.ts';
import { DIALECT } from '../../../src/foundation/asm/dialect.ts';
import type { Diagnostic } from '../../../src/foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { codeItems, dataItem, label, modelOf, romWith, words } from '../../helpers/model.ts';
import { thumbAt } from '../../helpers/thumb.ts';
import { analysisOf, BASE, configOf, fact, HEADER_END } from '../layout/hand-made.ts';
import { entry, FILES, fixtureEntries, fixtureModel, fixtureRom } from './fixture.ts';

const rom = fixtureRom();
const model = fixtureModel(rom);
const CX = { decomp: { defined: [] } };

/** The files of the data, ldscript and symbols writers for a model. */
function written(r: Rom, m: Model): readonly FileEntry[] {
  return WRITERS.filter((w) => w.id === 'data' || w.id === 'ldscript' || w.id === 'symbols').flatMap((w) =>
    w.scope === 'global' ? [...w.emit(r, m, CX, null)] : m.modules.flatMap((_, i) => [...w.emit(r, m, CX, i)]),
  );
}

function textOf(path: string, entries: readonly FileEntry[] = written(rom, model)): string {
  const found = entries.find((e) => e.path === path);
  return found !== undefined && found.ownership === 'generated' ? found.text : (FILES[path] ?? '');
}

/** entryDiagnostics on `path` with `text`, as [code, path, addr, line] rows. */
function check(path: string, text: string, m: Model = model, r: Rom = rom): readonly (readonly [string, string | undefined, number | undefined, number])[] {
  return entryDiagnostics(r, m, entry(path, text)).map((d: Diagnostic) => [d.code, d.path, d.addr, Number(/ line (\d+):/.exec(d.message)?.[1] ?? -1)] as const);
}

function messages(path: string, text: string, m: Model = model): string {
  return entryDiagnostics(rom, m, entry(path, text))
    .map((d) => d.message)
    .join('\n');
}

test('every file of the consistent fixture lays out to its ROM range, and the paths are distinct', () => {
  const entries = [...fixtureEntries(), ...written(rom, model)];
  for (const e of entries) assert.deepEqual(entryDiagnostics(rom, model, e), [], e.path);
  const report = checkEntries(rom, model, entries);
  assert.equal(report.ok, true);
  assert.deepEqual(
    report.checks.map((c) => [c.id, c.ok, c.detail]),
    [
      ['text-layout', true, '10 files lay out to their ROM ranges'],
      ['paths', true, '10 paths, no two of them one file'],
    ],
  );
});

test('entryDiagnostics, the tests\' one-entry check: a one-entry stream\'s stream-level diagnostics are dropped, the entry\'s own kept', () => {
  const path = 'asm/nonmatchings/main/Func.s';
  const alone = checkEntries(rom, model, [entry(path, FILES[path] ?? '')]).checks.find((c) => c.id === 'text-layout');
  assert.ok(alone !== undefined && alone.diagnostics.length > 0 && alone.diagnostics.every((d) => / the stream emits no such file, /.test(d.message)), 'a one-entry stream misses every other file');
  assert.deepEqual(entryDiagnostics(rom, model, entry(path, FILES[path] ?? '')), []);
  const plain = (FILES[path] ?? '').replace('.4byte Func', '.4byte 0x08000100');
  const own = checkEntries(rom, model, [entry(path, plain)]).checks.find((c) => c.id === 'text-layout')?.diagnostics ?? [];
  assert.deepEqual(entryDiagnostics(rom, model, entry(path, plain)), own.filter((d) => d.path === path), 'the entry\'s own problem, first in the stream');
  assert.equal(entryDiagnostics(rom, model, entry(path, plain)).length, 1);
});

test('`.4byte Func` links to the Thumb function plus one; the plain address differs at the pool word', () => {
  const path = 'asm/nonmatchings/main/Func.s';
  assert.deepEqual(check(path, FILES[path] ?? ''), []);
  const plain = (FILES[path] ?? '').replace('.4byte Func', '.4byte 0x08000100');
  assert.deepEqual(check(path, plain), [['E_SELF_CHECK_TEXT', path, 0x0800_0108, 8]]);
  assert.match(messages(path, plain), /lays out 0x00 where the ROM holds 0x01/);
});

test('the pool after `.align 2, 0`: the alignment must be the padding item, and pad nothing where none is', () => {
  const path = 'asm/nonmatchings/main/Func.s';
  // Without the .align the pool word moves up to 0x08000106, where the load cannot reach it.
  const unaligned = (FILES[path] ?? '').replace('\t.align 2, 0\n', '');
  assert.deepEqual(check(path, unaligned)[0], ['E_SELF_CHECK_TEXT', path, 0x0800_0102, 5]);
  assert.match(messages(path, unaligned), /cannot encode `ldr r0, _08000108`/);
  // An .align that emits zeros where the model has data (the ROM's bytes there are zeros too).
  const r = romWith([{ at: 0x0800_0100, bytes: thumbAt(0x0800_0100)`bx lr` }], { size: 0x400 });
  const m = modelOf(r, {
    modules: [
      { name: 'head', kind: 'data', chunks: [{ kind: 'data', name: 'head', items: [dataItem(0x0800_0000, 0x100)] }] },
      { name: 'main', chunks: [{ name: 'F', items: [{ kind: 'insn', start: 0x0800_0100, length: 2, specId: 'thumb.bx' }, dataItem(0x0800_0102, 0x2fe)] }] },
    ],
    labels: [label('F', 0x0800_0100)],
  });
  const text = `.thumb\n\tthumb_func_start F\nF:\n\tbx lr\n\t.align 2, 0\n\t.incbin "baserom.gba", 0x104, 0x2FC\n`;
  const found = entryDiagnostics(r, m, entry('asm/nonmatchings/main/F.s', text));
  assert.equal(found.length, 1);
  assert.equal(found[0]?.addr, 0x0800_0102);
  assert.match(found[0]?.message ?? '', /line 5: the alignment emits 2 bytes, but no padding item starts there/);
});

test('an ARM chunk after `bx pc`: the switch to ARM state emits its leading padding', () => {
  const path = 'asm/nonmatchings/main/ArmFunc.s';
  assert.deepEqual(check(path, FILES[path] ?? ''), []);
  // Laid out from the chunk start in Thumb state (Veneer's bx pc), `.arm` pads 0x0800010E..0x08000110.
  const twice = (FILES[path] ?? '').replace('.arm\n', '.arm\n\t.align 2, 0\n\t.2byte 0\n');
  assert.equal(check(path, twice)[0]?.[2], 0x0800_0110);
});

test('a chunk file that includes the macro file again fails, as `as` does inside its module file', () => {
  const path = 'asm/nonmatchings/main/Veneer.s';
  const text = `${DIALECT.preamble('thumb')}${(FILES[path] ?? '').replace('.thumb\n', '')}`;
  const found = check(path, text);
  assert.equal(found[0]?.[3], 2);
  assert.match(messages(path, text), /macro `arm_func_start` is already defined/);
});

test('a parse error and an undefined symbol name their line and address', () => {
  const path = 'asm/nonmatchings/main/Func.s';
  const bad = (FILES[path] ?? '').replace('\tpop {pc}', '\t.bogus 1\n\tpop {pc}');
  const rows = check(path, bad);
  assert.deepEqual(rows[0], ['E_SELF_CHECK_TEXT', path, 0x0800_0104, 6]);
  assert.match(messages(path, bad), /unsupported directive `\.bogus`/);
  // Veneer is module-scoped in main: the data module cannot name it.
  const dataText = textOf('data/data.s').replace('.4byte Func', '.4byte Veneer');
  assert.match(messages('data/data.s', dataText), /line 9: undefined symbol `Veneer` \(at 0x08000140\)/);
});

test('a module file must include its chunk files, in ROM order, after the macro file, and add nothing', () => {
  const path = 'asm/main.s';
  const text = FILES[path] ?? '';
  assert.deepEqual(check(path, text), []);
  const missing = text.replace('.include "asm/nonmatchings/main/Veneer.s"\n', '');
  assert.deepEqual(check(path, missing), [['E_SELF_CHECK_TEXT', path, 0x0800_010c, 6]]);
  assert.match(messages(path, missing), /does not include|includes "asm\/nonmatchings\/main\/ArmFunc\.s" where the module's chunk file in ROM order is "asm\/nonmatchings\/main\/Veneer\.s"/);
  const swapped = text.replace(/(\.include "asm\/nonmatchings\/main\/Func\.s"\n)(\.include "asm\/nonmatchings\/main\/Veneer\.s"\n)/, '$2$1');
  assert.deepEqual(check(path, swapped), [['E_SELF_CHECK_TEXT', path, 0x0800_0100, 5]]);
  const last = text.replace('.include "asm/nonmatchings/main/unk_08000114.s"\n', '');
  assert.match(messages(path, last), /line 7: does not include "asm\/nonmatchings\/main\/unk_08000114\.s", the chunk file at 0x08000114/);
  const extra = text.replace('.include "asm/nonmatchings/main/Veneer.s"\n', '.include "asm/nonmatchings/main/Veneer.s"\n\t.2byte 0x1234\n');
  assert.deepEqual(check(path, extra)[0], ['E_SELF_CHECK_TEXT', path, 0x0800_010e, 7]);
  const noMacros = text.replace('.include "include/macros.inc"\n', '');
  assert.match(messages(path, noMacros), /includes a chunk file before it includes "include\/macros\.inc"/);
});

test('a flipped byte of a data file, the header and crt0 is found with its line', () => {
  const data = textOf('data/data.s').replace('0x144, 0x2BC', '0x145, 0x2BC');
  assert.deepEqual(check('data/data.s', data)[0], ['E_SELF_CHECK_TEXT', 'data/data.s', 0x0800_0144, 10]);
  const header = (FILES['asm/rom_header.s'] ?? '').replace('0x0, 0xC0', '0x0, 0xBC');
  assert.match(messages('asm/rom_header.s', header), /line 4: the file lays out 188 bytes, but its range 0x08000000\.\.0x080000C0 holds 192 \(at 0x080000BC\)/);
  const crt0 = (FILES['asm/crt0.s'] ?? '').replace('mov r0, #1', 'mov r0, #2');
  assert.deepEqual(check('asm/crt0.s', crt0)[0], ['E_SELF_CHECK_TEXT', 'asm/crt0.s', 0x0800_00c0, 6]);
});

test('paths no chunk or module has: an error for a phase-3 writer, nothing for other writers and ownerships', () => {
  assert.match(messages('asm/nonmatchings/main/Ghost.s', '.thumb\n'), /the function writer emits a file no chunk or module of the model has/);
  assert.deepEqual(entryDiagnostics(rom, model, entry('objdiff.json', '{}', 'objdiff')), []);
  assert.deepEqual(entryDiagnostics(rom, model, { ownership: 'scaffold', path: 'Makefile', text: 'all:\n', writer: 'scaffold' }), []);
  assert.deepEqual(entryDiagnostics(rom, model, { ownership: 'reconciled', path: 'src/main.c', baseSha1: 'x', edits: [] }), []);
});

test('ldscript.txt: every build unit once in ROM order, INCLUDE symbols.ld when it defines a symbol', () => {
  const text = textOf('ldscript.txt');
  assert.deepEqual(check('ldscript.txt', text), []);
  const swapped = text.replace('build/crt0.o(.text);\n        build/main.o(.text);', 'build/main.o(.text);\n        build/crt0.o(.text);');
  assert.deepEqual(check('ldscript.txt', swapped), [['E_SELF_CHECK_TEXT', 'ldscript.txt', 0x0800_00c0, 7]]);
  const dropped = text.replace('        build/data.o(.text);\n', '');
  assert.match(messages('ldscript.txt', dropped), /does not link build\/data\.o, the unit of module data/);
  assert.match(messages('ldscript.txt', text.replace('INCLUDE symbols.ld\n', '')), /line 1: does not INCLUDE symbols\.ld/);
  assert.match(messages('ldscript.txt', text.replace('. = 0x08000000;', '. = 0x08000100;')), /the link starts at 0x08000100/);
  assert.match(messages('ldscript.txt', `${text}KEEP(*)\n`), /unexpected `KEEP\(\*\)` outside SECTIONS/);
});

test('ldscript.txt: a runs_at unit opens its own section at its run address, loaded in place, with its __load_ symbol', () => {
  const r = romWith([{ at: 0x0800_0100, bytes: words(1, 2, 3, 4) }], { size: 0x400 });
  const m = modelOf(r, {
    modules: [
      { name: 'head', kind: 'data', chunks: [{ kind: 'data', name: 'head', items: [dataItem(0x0800_0000, 0x100)] }] },
      { name: 'ram', kind: 'data', runAt: 0x0300_0000, chunks: [{ kind: 'data', name: 'ram', runAt: 0x0300_0000, items: [dataItem(0x0800_0100, 0x10)] }] },
      { name: 'tail', kind: 'data', chunks: [{ kind: 'data', name: 'tail', items: [dataItem(0x0800_0110, 0x2f0)] }] },
    ],
  });
  const text = textOf('ldscript.txt', written(r, m));
  assert.deepEqual(check('ldscript.txt', text, m, r), []);
  assert.match(entryDiagnostics(r, m, entry('ldscript.txt', text.replace('.ram 0x03000000', '.ram 0x03000004'))).map((d) => d.message).join(), /runs from 0x03000000 and must open its own section/);
  assert.match(entryDiagnostics(r, m, entry('ldscript.txt', text.replace(/ *__load_ram = LOADADDR\(\.ram\);\n/, ''))).map((d) => d.message).join(), /no `__load_ram = LOADADDR\(\.ram\);`/);
  assert.match(entryDiagnostics(r, m, entry('ldscript.txt', text.replace('.text.tail 0x08000110 : AT(0x08000110)', '.text.tail 0x08000114 : AT(0x08000114)'))).map((d) => d.message).join(), /but build\/tail\.o loads at 0x08000110/);
  // The other units of the stream lay out at their run address: ram's file names its own label at 0x03000000.
  for (const e of written(r, m)) assert.deepEqual(entryDiagnostics(r, m, e), [], e.path);
});

test('symbols.ld: each symbol outside the ROM once, with the model value, and nothing else', () => {
  const text = textOf('symbols.ld');
  assert.deepEqual(check('symbols.ld', text), []);
  assert.match(messages('symbols.ld', text.replace('0x02000000', '0x02000004')), /line 2: defines gRam as 0x02000004, but the model has 0x02000000/);
  assert.match(messages('symbols.ld', text.replace('gRam = 0x02000000;\n', '')), /does not define gRam/);
  assert.match(messages('symbols.ld', `${text}gRam = 0x02000000;\n`), /defines gRam twice/);
  assert.match(messages('symbols.ld', `${text}gOther = 0x03000000;\n`), /defines gOther, which is no \[symbols\] entry outside the ROM/);
  assert.match(messages('symbols.ld', `${text}PROVIDE(x = 1);\n`), /unexpected `PROVIDE\(x = 1\);`/);
});

test('a stream that lacks a file the model needs, or emits one twice, fails the pass', () => {
  const entries = [...fixtureEntries(), ...written(rom, model)].filter((e) => e.path !== 'asm/nonmatchings/main/Veneer.s');
  const report = checkEntries(rom, model, [...entries, entry('asm/nonmatchings/main/func.s', FILES['asm/nonmatchings/main/Func.s'] ?? '')]);
  assert.equal(report.ok, false);
  const [layout, paths] = report.checks;
  assert.equal(layout?.id, 'text-layout');
  assert.ok(layout?.diagnostics.some((d) => d.path === 'asm/nonmatchings/main/Veneer.s' && d.addr === 0x0800_010c && /emits no such file/.test(d.message)));
  assert.equal(paths?.diagnostics[0]?.code, 'E_PATH_CASE_COLLISION');
});

test('one entry reports at most MAX_PER_ENTRY problems; the aggregate counts them', () => {
  const junk = Array.from({ length: 40 }, (_, i) => `.bogus${i}`).join('\n');
  assert.equal(entryDiagnostics(rom, model, entry('asm/nonmatchings/main/Func.s', junk)).length, MAX_PER_ENTRY);
  const result = textLayoutResult(entryDiagnostics(rom, model, entry('asm/nonmatchings/main/Func.s', junk)), 1);
  assert.equal(result.ok, false);
  assert.match(result.detail, /\(16 problems in all\)$/);
});

test('a function file of a runs_at module lays out at its run address, so its own labels take run addresses', () => {
  const r = romWith([{ at: 0x0800_0100, bytes: thumbAt(0x0300_0000)`ldr r0, _03000004; bx lr` }, { at: 0x0800_0104, bytes: words(0x0300_0001) }], { size: 0x400 });
  const code = codeItems(r, 0x0800_0100, 0x0800_0104, 'thumb');
  const m = modelOf(r, {
    modules: [
      { name: 'head', kind: 'data', chunks: [{ kind: 'data', name: 'head', items: [dataItem(0x0800_0000, 0x100)] }] },
      { name: 'ram', runAt: 0x0300_0000, chunks: [{ name: 'RamFunc', runAt: 0x0300_0000, items: [...code, { kind: 'pool', start: 0x0800_0104, value: 0x0300_0001 }] }] },
      { name: 'tail', kind: 'data', chunks: [{ kind: 'data', name: 'tail', items: [dataItem(0x0800_0108, 0x2f8)] }] },
    ],
    labels: [label('RamFunc', 0x0300_0000, { scope: 'global' }), label('_03000004', 0x0300_0004, { kind: 'pool', thumb: false })],
  });
  const text = '.thumb\n\tthumb_func_start RamFunc\nRamFunc:\n\tldr r0, _03000004\n\tbx lr\n_03000004: .4byte RamFunc\n\tthumb_func_end RamFunc\n';
  assert.deepEqual(entryDiagnostics(r, m, entry('asm/nonmatchings/ram/RamFunc.s', text)), []);
  // Laid out at its load address, `.4byte RamFunc` would be 0x08000101.
  const atLoad = { ...m, chunks: m.chunks.map(({ runAt: _, ...c }) => c) };
  const found = entryDiagnostics(r, atLoad, entry('asm/nonmatchings/ram/RamFunc.s', text));
  assert.equal(found[0]?.addr, 0x0800_0105);
  assert.match(found[0]?.message ?? '', /line 6: the file lays out 0x01 where the ROM holds 0x00/);
});

test('a PC-relative load of a label in another module fails, as `as` refuses it (D63); in its own module it passes', () => {
  const r = romWith([{ at: 0x0800_0100, bytes: thumbAt(0x0800_0100)`push {lr}; ldr r0, _08000108; pop {pc}` }, { at: 0x0800_0108, bytes: words(0x0200_0000) }], { size: 0x200 });
  const code = [...codeItems(r, 0x0800_0100, 0x0800_0106, 'thumb'), { kind: 'padding' as const, start: 0x0800_0106, length: 2 }];
  const pool = { kind: 'pool' as const, start: 0x0800_0108, value: 0x0200_0000 };
  const head = { name: 'head', kind: 'data' as const, chunks: [{ kind: 'data' as const, name: 'head', items: [dataItem(0x0800_0000, 0x100)] }] };
  const tail = { name: 'tail', kind: 'data' as const, chunks: [{ kind: 'data' as const, name: 'tail', items: [dataItem(0x0800_010c, 0xf4)] }] };
  const labels = [label('Func', 0x0800_0100, { scope: 'global' }), label('_08000108', 0x0800_0108, { kind: 'pool', thumb: false, scope: 'global' })];
  const func = { name: 'Func', items: code };
  const orphan = { kind: 'orphan' as const, name: 'unk_08000108', items: [pool] };
  const split = modelOf(r, { modules: [head, { name: 'main', chunks: [func] }, { name: 'main_2', chunks: [orphan] }, tail], labels });
  const joined = modelOf(r, { modules: [head, { name: 'main', chunks: [func, orphan] }, tail], labels });
  const text = '.thumb\n\tthumb_func_start Func\nFunc: @ 08000100\n\tpush {lr}\n\tldr r0, _08000108\n\tpop {pc}\n\t.align 2, 0\n\tthumb_func_end Func\n';
  assert.deepEqual(entryDiagnostics(r, joined, entry('asm/nonmatchings/main/Func.s', text)), []);
  const found = entryDiagnostics(r, split, entry('asm/nonmatchings/main/Func.s', text));
  assert.equal(found[0]?.code, 'E_SELF_CHECK_TEXT');
  assert.equal(found[0]?.addr, 0x0800_0102);
  assert.match(found[0]?.message ?? '', /line 5: `ldr r0, _08000108` reaches `_08000108` PC-relatively in another object, which `as` cannot relocate/);
});

test('a name the printers cannot place (a label inside an instruction) is an undefined symbol, as for `as` (D63 d)', () => {
  // FuncPlus1 sits at 0x08000101, inside Func's `push {lr}`: no printer defines it, though its value is the pool word's.
  const inside = { ...model, labels: [...model.labels, label('FuncPlus1', 0x0800_0101, { kind: 'data', thumb: false, scope: 'global' })] };
  const dataText = textOf('data/data.s').replace('.4byte Func', '.4byte FuncPlus1');
  assert.match(
    entryDiagnostics(rom, inside, entry('data/data.s', dataText, 'data'))
      .map((d) => d.message)
      .join('\n'),
    /undefined symbol `FuncPlus1`/,
  );
  // At an item's start (the pool word) a name is defined: its value differs from the word, but it is no undefined symbol.
  const atStart = { ...model, labels: [...model.labels, label('AtPool', 0x0800_0108, { kind: 'data', thumb: false, scope: 'global' })] };
  const poolText = textOf('data/data.s').replace('.4byte Func', '.4byte AtPool');
  assert.doesNotMatch(
    entryDiagnostics(rom, atStart, entry('data/data.s', poolText, 'data'))
      .map((d) => d.message)
      .join('\n'),
    /undefined symbol/,
  );
});

/** The fixture with module main a C unit: the c-stub writer's stub instead of asm/main.s. */
function cFixture(): { readonly model: Model; readonly stub: FileEntry; readonly entries: readonly FileEntry[] } {
  const c: Model = { ...model, modules: model.modules.map((m) => (m.name === 'main' ? { ...m, kind: 'c' as const } : m)) };
  const main = c.modules.findIndex((m) => m.name === 'main');
  const [stub] = [...cStubWriter.emit(rom, c, CX, main)];
  assert.ok(stub !== undefined);
  return { model: c, stub, entries: [...fixtureEntries().filter((e) => e.path !== 'asm/main.s'), stub, ...written(rom, c)] };
}

/** entryDiagnostics of a C stub text on the C fixture, as [code, addr, line, message] rows. */
function checkStub(text: string): readonly (readonly [string, number | undefined, number, string])[] {
  const { model: c, stub } = cFixture();
  const found = entryDiagnostics(rom, c, { ...stub, text } as FileEntry);
  return found.map((d) => [d.code, d.addr, Number(/ line (\d+):/.exec(d.message)?.[1] ?? -1), d.message] as const);
}

test('a C unit: the c-stub writer\'s stub lays out as agbcc compiles it, its chunk files as in an asm module', () => {
  const { model: c, stub, entries } = cFixture();
  assert.equal(stub.ownership, 'scaffold');
  assert.equal(stub.path, 'src/main.c');
  assert.equal(
    'text' in stub ? stub.text : '',
    '#include "include_asm.h"\n\nINCLUDE_ASM("asm/nonmatchings/main", Func);\nINCLUDE_ASM("asm/nonmatchings/main", Veneer);\nINCLUDE_ASM("asm/nonmatchings/main", ArmFunc);\nINCLUDE_ASM("asm/nonmatchings/main", unk_08000114);\n',
  );
  assert.deepEqual(entryDiagnostics(rom, c, stub), []);
  const report = checkEntries(rom, c, entries);
  assert.deepEqual(report.checks.map((r) => [r.id, r.ok]), [['text-layout', true], ['paths', true]]);
});

test('a C module needs its stub in the stream: without the c-stub writer\'s entry the check fails (correctness-6)', () => {
  const { model: c, entries } = cFixture();
  const report = checkEntries(rom, c, entries.filter((e) => e.path !== 'src/main.c'));
  assert.equal(report.ok, false);
  const failed = report.checks.find((r) => r.id === 'text-layout');
  assert.equal(failed?.ok, false);
  assert.match(failed?.detail ?? '', /^src\/main\.c line 1: the stream emits no such file, which the model needs \(at 0x08000100\)/);
});

test('a C stub must include exactly the module\'s chunk files in ROM order', () => {
  const head = '#include "include_asm.h"\n\n';
  const stmt = (name: string): string => `INCLUDE_ASM("asm/nonmatchings/main", ${name});\n`;
  const all = ['Func', 'Veneer', 'ArmFunc', 'unk_08000114'];
  const swapped = checkStub(head + ['Veneer', 'Func', 'ArmFunc', 'unk_08000114'].map(stmt).join(''));
  assert.deepEqual(swapped.map((r) => r.slice(0, 3)), [['E_SELF_CHECK_TEXT', 0x0800_0100, 3]]);
  assert.match(swapped[0]?.[3] ?? '', /includes "asm\/nonmatchings\/main\/Veneer\.s" where the module's chunk file in ROM order is "asm\/nonmatchings\/main\/Func\.s"/);
  const missing = checkStub(head + all.slice(0, 3).map(stmt).join(''));
  assert.match(missing[0]?.[3] ?? '', /line 5: does not include "asm\/nonmatchings\/main\/unk_08000114\.s", the chunk file at 0x08000114/);
  const extra = checkStub(head + [...all, 'Func'].map(stmt).join(''));
  assert.match(extra[0]?.[3] ?? '', /line 7: includes "asm\/nonmatchings\/main\/Func\.s" after the module's last chunk file/);
  const otherDir = checkStub(head + all.map(stmt).join('').replace('nonmatchings/main", Veneer', 'nonmatchings/other", Veneer'));
  assert.match(otherDir[0]?.[3] ?? '', /includes "asm\/nonmatchings\/other\/Veneer\.s" where/);
  // Comments and blank lines are not code: the same stub with them passes.
  assert.deepEqual(checkStub(`/* main */\n${head}${all.map((n) => `// ${n}\n${stmt(n)}\n`).join('')}`), []);
});

test('a C stub holds nothing a compiler would turn into bytes: no definition, no declaration, no other directive, the header first', () => {
  const body = ['Func', 'Veneer', 'ArmFunc', 'unk_08000114'].map((n) => `INCLUDE_ASM("asm/nonmatchings/main", ${n});\n`).join('');
  const head = '#include "include_asm.h"\n\n';
  const defined = checkStub(`${head}${body}void Extra(void) { }\n`);
  assert.match(defined[0]?.[3] ?? '', /line 7: defines the function Extra; only a stub-only unit is laid out/);
  const declared = checkStub(`${head}int gCounter;\n${body}`);
  assert.match(declared[0]?.[3] ?? '', /line 3: holds `int…` at file scope/);
  const directive = checkStub(`${head}#define X 1\n${body}`);
  assert.match(directive[0]?.[3] ?? '', /line 3: holds the directive `#define X 1`/);
  const headless = checkStub(body);
  assert.match(headless[0]?.[3] ?? '', /line 1: uses INCLUDE_ASM without `#include "include_asm.h"` before it/);
  const late = checkStub(`${body}${head}`);
  assert.equal(late.length, 2, 'the header after the statements, and the statements without it');
  const open = checkStub(`${head}${body}/* unterminated`);
  assert.match(open[0]?.[3] ?? '', /the file ends inside a comment/);
  for (const rows of [defined, declared, directive, headless, late, open]) for (const r of rows) assert.equal(r[0], 'E_SELF_CHECK_TEXT');
});

test('a C module holding a chunk without a file cannot be a stub: E_SELF_CHECK_TEXT at the chunk', () => {
  const r = romWith([], { size: 0x200 });
  const m = modelOf(r, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
      { name: 'main', kind: 'c', chunks: [{ name: 'F', items: [dataItem(0x0800_00c0, 0x20)] }, { kind: 'data', name: 'gTable', items: [dataItem(0x0800_00e0, 0x120)] }] },
    ],
  });
  const [stub] = [...cStubWriter.emit(r, m, CX, 1)];
  assert.ok(stub !== undefined && 'text' in stub);
  const found = entryDiagnostics(r, m, stub);
  assert.deepEqual(found.map((d) => [d.code, d.addr]), [['E_SELF_CHECK_TEXT', 0x0800_00e0]]);
  assert.match(found[0]?.message ?? '', /the data chunk gTable at 0x080000E0 has no file of its own/);
});

test('a C unit asks the alignment of Thumb state and of its chunk files, as an asm unit does (D65 a)', () => {
  // main is one 6-byte Thumb function whose start macro asks 4: as pads the unit's .text to 8, past the module's end.
  const at = 0x0800_00c0;
  const r = romWith([{ at, bytes: thumbAt(at)`push {lr}; pop {pc}; bx lr` }], { size: 0x200 });
  const unit = (end: number): Model =>
    modelOf(r, {
      modules: [
        { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
        { name: 'main', kind: 'c', chunks: [{ name: 'F', items: [...codeItems(r, at, at + 6, 'thumb'), ...(end > at + 6 ? [dataItem(at + 6, end - at - 6)] : [])] }] },
        { name: 'data', kind: 'data', chunks: [{ kind: 'data', name: 'data', items: [dataItem(end, 0x0800_0200 - end)] }] },
      ],
      labels: [label('F', at)],
    });
  const short = unit(at + 6);
  const failed = checkEntries(r, short, [...emitTree(r, short, CX)]).checks.find((c) => c.id === 'text-layout');
  assert.equal(failed?.ok, false);
  assert.match(failed?.detail ?? '', /^src\/main\.c line 1: GNU as pads the object's section to a multiple of 4 bytes, 2 past the module's end 0x080000C6/);
  const whole = unit(at + 8);
  assert.equal(checkEntries(r, whole, [...emitTree(r, whole, CX)]).ok, true);
});

test('two definable labels of one static name in two modules: each module resolves its own (architecture-r2-9)', () => {
  // Module `a` holds a table word naming its `sLocal` (0x08000108), module `b` one naming its own (0x08000188); both labels
  // are module-scoped and start a data item, so the index holds two labels under one name.
  const r = romWith([{ at: 0x0800_0100, bytes: words(0x0800_0108) }, { at: 0x0800_0180, bytes: words(0x0800_0188) }], { size: 0x200 });
  const head = { name: 'head', kind: 'data' as const, chunks: [{ kind: 'data' as const, name: 'head', items: [dataItem(0x0800_0000, 0x100)] }] };
  const a = { name: 'a', kind: 'data' as const, chunks: [{ kind: 'data' as const, name: 'a', items: [{ kind: 'table-entry' as const, start: 0x0800_0100, target: 0x0800_0108, thumbBit: false }, dataItem(0x0800_0104, 4), dataItem(0x0800_0108, 0x78)] }] };
  const b = { name: 'b', kind: 'data' as const, chunks: [{ kind: 'data' as const, name: 'b', items: [{ kind: 'table-entry' as const, start: 0x0800_0180, target: 0x0800_0188, thumbBit: false }, dataItem(0x0800_0184, 4), dataItem(0x0800_0188, 0x78)] }] };
  const labels = [label('sLocal', 0x0800_0108, { kind: 'data', thumb: false }), label('sLocal', 0x0800_0188, { kind: 'data', thumb: false })];
  const m = modelOf(r, { modules: [head, a, b], labels });
  const files = written(r, m);
  for (const name of ['a', 'b']) {
    const file = files.find((e) => e.path === `data/${name}.s`);
    assert.ok(file !== undefined && file.ownership === 'generated', name);
    assert.match(file.text, /\.4byte sLocal\b/, name);
    assert.deepEqual(entryDiagnostics(r, m, file), [], name);
  }
  // Had module b's `.4byte sLocal` resolved to module a's label (the first of the name), it would lay out a's address,
  // which the check finds at b's word: the clean verdicts above rest on each module resolving its own.
  const bText = files.find((e) => e.path === 'data/b.s');
  assert.ok(bText !== undefined && bText.ownership === 'generated');
  const swapped = bText.text.replace(/\.4byte sLocal\b/, '.4byte 0x08000108');
  assert.equal(entryDiagnostics(r, m, entry('data/b.s', swapped, 'data'))[0]?.addr, 0x0800_0180);
});

test('a folded pad: the function file lays out from the pad, its start macro emitting the padding item; without that alignment it fails', () => {
  const r = romWith(
    [
      { at: BASE + 0x100, bytes: thumbAt(BASE + 0x100)`push {lr}; movs r0, #0; bl _0800010C; pop {pc}` },
      { at: BASE + 0x10c, bytes: thumbAt(BASE + 0x10c)`movs r0, #1; bx lr` },
    ],
    { size: 0x200 },
  );
  const analysis = analysisOf(r, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x10a }), fact({ entry: BASE + 0x10c, end: BASE + 0x110 })] });
  const config = configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x110, kind: 'data', generated: true }], functions: [[BASE + 0x100, 'A'], [BASE + 0x10c, 'B']] });
  const m = buildModel(r, analysis, config);
  const entries = [...emitTree(r, m, CX)];
  const file = entries.find((e) => e.path === 'asm/nonmatchings/main/B.s');
  assert.ok(file !== undefined && file.ownership === 'generated');
  assert.equal(entries.some((e) => e.path === 'asm/nonmatchings/main/unk_0800010A.s'), false, 'no orphan file');
  assert.equal(file.text.includes('.align'), false);
  assert.equal(checkEntries(r, m, entries).ok, true);
  assert.deepEqual(entryDiagnostics(r, m, file), []);
  const unaligned = entryDiagnostics(r, m, entry(file.path, file.text.replace('thumb_func_start_local B', 'non_word_aligned_thumb_func_start_local B')));
  assert.deepEqual(
    unaligned.map((d) => [d.code, d.addr]),
    [['E_SELF_CHECK_TEXT', BASE + 0x10a]],
  );
  // A pad the file emits again after the macro is a second copy of its bytes.
  const twice = entryDiagnostics(r, m, entry(file.path, file.text.replace('B: @ 0800010C', '\t.2byte 0\nB: @ 0800010C')));
  assert.equal(twice[0]?.code, 'E_SELF_CHECK_TEXT');
});

// Fix round 2 (architecture-r1-4): the objdiff targets, expected/<module>.s and expected/rom/<module>.s (D95 a), each
// refusal of checkExpectedFile and checkExpectedRomFile on the C fixture.

/** The expected writer's two files of module main of the C fixture. */
function expectedFiles(): { readonly model: Model; readonly unit: FileEntry; readonly rom: FileEntry } {
  const { model: c } = cFixture();
  const main = c.modules.findIndex((m) => m.name === 'main');
  const files = [...expectedWriter.emit(rom, c, CX, main)];
  const unit = files.find((f) => f.path === 'expected/main.s');
  const romFile = files.find((f) => f.path === 'expected/rom/main.s');
  assert.ok(unit !== undefined && romFile !== undefined);
  return { model: c, unit, rom: romFile };
}

function checkExpected(file: FileEntry, text: string, m: Model): readonly string[] {
  return entryDiagnostics(rom, m, { ...file, text } as FileEntry).map((d) => `${d.code} ${d.message}`);
}

test('expected/<module>.s of a C module is agbcc\'s stub assembly and lays out to the module; each wrong form is refused', () => {
  const { model: c, unit } = expectedFiles();
  const text = 'text' in unit ? unit.text : '';
  assert.match(text, /^@ expected\/main\.s: module main .*\n@ Generated by gcc /, 'the heading, then c-unit.ts stubAssemblyText');
  assert.deepEqual(checkExpected(unit, text, c), []);
  const twin = text.replace('.include "asm/nonmatchings/main/Veneer.s"', '.include "asm/matchings/main/Veneer.s"');
  assert.deepEqual(checkExpected(unit, twin, c), [], 'the asm/matchings twin of a decompiled function stands for its asm/nonmatchings path');
  const macrosLast = text.replace('\t.include "include/macros.inc"\n', '').replace(/\n$/, '\n\t.include "include/macros.inc"\n');
  assert.match(checkExpected(unit, macrosLast, c).join('\n'), /includes a chunk file before it includes "include\/macros\.inc"/);
  const swapped = text.replace('asm/nonmatchings/main/Func.s', '@@').replace('asm/nonmatchings/main/Veneer.s', 'asm/nonmatchings/main/Func.s').replace('@@', 'asm/nonmatchings/main/Veneer.s');
  assert.match(checkExpected(unit, swapped, c).join('\n'), /includes "asm\/nonmatchings\/main\/Veneer\.s" where the module's chunk file in ROM order is "asm\/nonmatchings\/main\/Func\.s"/);
  const missing = text.replace('.include "asm/nonmatchings/main/unk_08000114.s"\n', '');
  assert.match(checkExpected(unit, missing, c).join('\n'), /does not include "asm\/nonmatchings\/main\/unk_08000114\.s", the chunk file at 0x08000114/);
  const divided = text.replace(/\n$/, '\n\tmovs r0, #0\n');
  assert.match(checkExpected(unit, divided, c).join('\n'), /`movs r0, #0` under `\.syntax divided`: only unified syntax is supported/);
  const extra = text.replace(/\n$/, '\n\t.syntax unified\n\t.2byte 0x1234\n');
  assert.notDeepEqual(checkExpected(unit, extra, c), [], 'a byte past the module is refused');
});

test('expected/<module>.s of an asm or data module includes only its own source', () => {
  const crt0 = model.modules.findIndex((m) => m.name === 'crt0');
  const file = [...expectedWriter.emit(rom, model, CX, crt0)].find((f) => f.path === 'expected/crt0.s');
  assert.ok(file !== undefined && 'text' in file);
  assert.deepEqual(checkExpected(file, file.text, model), []);
  assert.match(checkExpected(file, file.text.replace('"asm/crt0.s"', '"asm/main.s"'), model).join('\n'), /includes "asm\/main\.s" where the module's chunk file in ROM order is "asm\/crt0\.s"/);
});

test('expected/rom/<module>.s is the module\'s ROM range: another offset, length or an include is refused', () => {
  const { model: c, rom: file } = expectedFiles();
  const text = 'text' in file ? file.text : '';
  assert.deepEqual(checkExpected(file, text, c), []);
  const shifted = text.replace(/\.incbin "baserom\.gba", 0x([0-9A-F]+),/, (_, off: string) => `.incbin "baserom.gba", 0x${(Number.parseInt(off, 16) + 2).toString(16).toUpperCase()},`);
  assert.notDeepEqual(checkExpected(file, shifted, c), [], 'the bytes of another offset');
  const short = text.replace(/, 0x([0-9A-F]+)\n$/, (_, len: string) => `, 0x${(Number.parseInt(len, 16) - 2).toString(16).toUpperCase()}\n`);
  assert.notDeepEqual(checkExpected(file, short, c), [], 'a range two bytes short');
  assert.notDeepEqual(checkExpected(file, `${text}.include "asm/nonmatchings/main/Func.s"\n`, c), [], 'an include, which a ROM range resolves to nothing');
});
