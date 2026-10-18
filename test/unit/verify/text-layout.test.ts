// The text-layout self-check (architecture §6.4, §6.7, D49): hand-written files of a consistent model lay
// out to their ROM ranges (a `.4byte Func` with the Thumb bit, a pool after `.align 2, 0`, an ARM chunk
// after `bx pc`, a module file of includes, the writers' data, ldscript and symbols files); every kind of
// difference is E_SELF_CHECK_TEXT with the file, the line and the address.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WRITERS } from '../../../src/core/emit/writers/index.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import type { Model } from '../../../src/core/model/types.ts';
import { checkEntries, checkEntry, MAX_PER_ENTRY, textLayoutResult } from '../../../src/core/verify/text-layout.ts';
import { DIALECT } from '../../../src/foundation/asm/dialect.ts';
import type { Diagnostic } from '../../../src/foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { codeItems, dataItem, label, modelOf, romWith, words } from '../../helpers/model.ts';
import { thumbAt } from '../../helpers/thumb.ts';
import { entry, FILES, fixtureEntries, fixtureModel, fixtureRom } from './fixture.ts';

const rom = fixtureRom();
const model = fixtureModel(rom);
const CX = { decomp: { defined: new Set<string>() } };

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

/** checkEntry on `path` with `text`, as [code, path, addr, line] rows. */
function check(path: string, text: string, m: Model = model, r: Rom = rom): readonly (readonly [string, string | undefined, number | undefined, number])[] {
  return checkEntry(r, m, entry(path, text)).map((d: Diagnostic) => [d.code, d.path, d.addr, Number(/ line (\d+):/.exec(d.message)?.[1] ?? -1)] as const);
}

function messages(path: string, text: string, m: Model = model): string {
  return checkEntry(rom, m, entry(path, text))
    .map((d) => d.message)
    .join('\n');
}

test('every file of the consistent fixture lays out to its ROM range, and the paths are distinct', () => {
  const entries = [...fixtureEntries(), ...written(rom, model)];
  for (const e of entries) assert.deepEqual(checkEntry(rom, model, e), [], e.path);
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
  const found = checkEntry(r, m, entry('asm/nonmatchings/main/F.s', text));
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
  assert.deepEqual(checkEntry(rom, model, entry('objdiff.json', '{}', 'objdiff')), []);
  assert.deepEqual(checkEntry(rom, model, { ownership: 'scaffold', path: 'Makefile', text: 'all:\n', writer: 'scaffold' }), []);
  assert.deepEqual(checkEntry(rom, model, { ownership: 'reconciled', path: 'src/main.c', baseSha1: 'x', edits: [] }), []);
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
  assert.match(checkEntry(r, m, entry('ldscript.txt', text.replace('.ram 0x03000000', '.ram 0x03000004'))).map((d) => d.message).join(), /runs from 0x03000000 and must open its own section/);
  assert.match(checkEntry(r, m, entry('ldscript.txt', text.replace(/ *__load_ram = LOADADDR\(\.ram\);\n/, ''))).map((d) => d.message).join(), /no `__load_ram = LOADADDR\(\.ram\);`/);
  assert.match(checkEntry(r, m, entry('ldscript.txt', text.replace('.text.tail 0x08000110 : AT(0x08000110)', '.text.tail 0x08000114 : AT(0x08000114)'))).map((d) => d.message).join(), /but build\/tail\.o loads at 0x08000110/);
  // The other units of the stream lay out at their run address: ram's file names its own label at 0x03000000.
  for (const e of written(r, m)) assert.deepEqual(checkEntry(r, m, e), [], e.path);
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
  assert.equal(checkEntry(rom, model, entry('asm/nonmatchings/main/Func.s', junk)).length, MAX_PER_ENTRY);
  const result = textLayoutResult(checkEntry(rom, model, entry('asm/nonmatchings/main/Func.s', junk)), 1);
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
  assert.deepEqual(checkEntry(r, m, entry('asm/nonmatchings/ram/RamFunc.s', text)), []);
  // Laid out at its load address, `.4byte RamFunc` would be 0x08000101.
  const atLoad = { ...m, chunks: m.chunks.map(({ runAt: _, ...c }) => c) };
  const found = checkEntry(r, atLoad, entry('asm/nonmatchings/ram/RamFunc.s', text));
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
  assert.deepEqual(checkEntry(r, joined, entry('asm/nonmatchings/main/Func.s', text)), []);
  const found = checkEntry(r, split, entry('asm/nonmatchings/main/Func.s', text));
  assert.equal(found[0]?.code, 'E_SELF_CHECK_TEXT');
  assert.equal(found[0]?.addr, 0x0800_0102);
  assert.match(found[0]?.message ?? '', /line 5: `ldr r0, _08000108` reaches `_08000108` PC-relatively in another object, which `as` cannot relocate/);
});

test('a name the printers cannot place (a label inside an instruction) is an undefined symbol, as for `as` (D63 d)', () => {
  // FuncPlus1 sits at 0x08000101, inside Func's `push {lr}`: no printer defines it, though its value is the pool word's.
  const inside = { ...model, labels: [...model.labels, label('FuncPlus1', 0x0800_0101, { kind: 'data', thumb: false, scope: 'global' })] };
  const dataText = textOf('data/data.s').replace('.4byte Func', '.4byte FuncPlus1');
  assert.match(
    checkEntry(rom, inside, entry('data/data.s', dataText, 'data'))
      .map((d) => d.message)
      .join('\n'),
    /undefined symbol `FuncPlus1`/,
  );
  // At an item's start (the pool word) a name is defined: its value differs from the word, but it is no undefined symbol.
  const atStart = { ...model, labels: [...model.labels, label('AtPool', 0x0800_0108, { kind: 'data', thumb: false, scope: 'global' })] };
  const poolText = textOf('data/data.s').replace('.4byte Func', '.4byte AtPool');
  assert.doesNotMatch(
    checkEntry(rom, atStart, entry('data/data.s', poolText, 'data'))
      .map((d) => d.message)
      .join('\n'),
    /undefined symbol/,
  );
});
