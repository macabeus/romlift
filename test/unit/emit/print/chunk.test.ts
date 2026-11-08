// printChunk (architecture §5 "Printing beyond one instruction", D14, D16, D62) on the hand-made sample model
// of fixture.ts: each item kind, the start macros (2 mod 4, ARM, _local for module-scoped labels), ARM after
// `bx pc`, the pool naming rule in place, a jump table, data notes, an orphan split by a global label, a
// cross-module short branch printed raw, inner labels, the statistics, the raw printer, and the unit-level
// round trip: every mnemonic line re-parses and re-assembles to its bytes at its address. A function chunk that
// folded the pad before its entry (core/model/chunks.ts) prints no `.align` of its own: its start macro emits it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { printChunk } from '../../../../src/core/emit/print/chunk.ts';
import { printRawRange } from '../../../../src/core/emit/print/raw.ts';
import { emitTree } from '../../../../src/core/emit/emit-tree.ts';
import { buildModel } from '../../../../src/core/model/model.ts';
import { checkEntries } from '../../../../src/core/verify/text-layout.ts';
import { verifyModel } from '../../../../src/core/verify/tiling.ts';
import { itemAt } from '../../../../src/core/model/item-table.ts';
import { resolverFor } from '../../../../src/core/model/resolver.ts';
import type { Model } from '../../../../src/core/model/types.ts';
import { assemble } from '../../../../src/foundation/isa/assemble.ts';
import { parse } from '../../../../src/foundation/isa/parse.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import { codeItems, dataItem, label, modelOf, romWith } from '../../../helpers/model.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { analysisOf, BASE, configOf, fact, HEADER_END } from '../../layout/hand-made.ts';
import { sampleModel, sampleRom } from './fixture.ts';

const rom = sampleRom();
const model = sampleModel(rom);
const index = (name: string, module: string): number => model.chunks.findIndex((c) => c.name === name && c.module === module);
const lines = (name: string, module = 'main'): readonly string[] => printChunk(rom, model, index(name, module)).lines;

test('a Thumb function: its macro and label, mnemonics, local labels, pool loads and words named by the rule, a dead halfword', () => {
  assert.deepEqual(lines('Main'), [
    '.thumb',
    '\tthumb_func_start Main',
    'Main: @ 08000100',
    '\tpush {lr}',
    '\tbl Helper',
    '\tldr r0, _08000114 @ =Helper',
    '\tldr r1, _08000118 @ =0x08000100',
    '\tcmp r0, #0',
    '\tbeq _08000110',
    '\tmovs r0, #1',
    '_08000110:',
    '\tpop {r0}',
    '\tbx r0',
    '_08000114: .4byte Helper',
    '_08000118: .4byte 0x08000100',
    '_0800011C: .4byte 0x03000000',
    '_08000120: .4byte ArmFunc',
    '\t.inst.n 0xEEFF @ dead',
    '\tthumb_func_end Main',
  ]);
});

test('a module-scoped Thumb entry at 2 mod 4 uses non_word_aligned_thumb_func_start_local; padding is .align 2, 0', () => {
  assert.deepEqual(lines('Helper'), ['.thumb', '\tnon_word_aligned_thumb_func_start_local Helper', 'Helper: @ 08000126', '\tmovs r0, #0', '\tbx lr', '\t.align 2, 0', '\tthumb_func_end Helper']);
});

test('a jump table prints one .4byte per entry to its local labels with + 1, after its pool', () => {
  assert.deepEqual(lines('Switch'), [
    '.thumb',
    '\tthumb_func_start_local Switch',
    'Switch: @ 0800012C',
    '\tlsls r0, r0, #2',
    '\tldr r1, _08000138 @ =_0800013C',
    '\tadds r0, r0, r1',
    '\tldr r0, [r0]',
    '\tmov pc, r0',
    '\t.align 2, 0',
    '_08000138: .4byte _0800013C',
    '_0800013C:',
    '\t.4byte _08000144 + 1',
    '\t.4byte _08000146 + 1',
    '_08000144:',
    '\tmovs r0, #1',
    '_08000146:',
    '\tbx lr',
    '\tthumb_func_end Switch',
  ]);
});

test('ARM after bx pc: the mov r8, r8 printed as an instruction, or .align 2, 0 over zeros, then .arm', () => {
  assert.deepEqual(lines('ThumbToArm'), ['.thumb', '\tthumb_func_start_local ThumbToArm', 'ThumbToArm: @ 08000148', '\tbx pc', '\tmov r8, r8', '.arm', '\tadd r0, r0, #1', '\tbx lr', '\tthumb_func_end ThumbToArm']);
  assert.deepEqual(lines('ThumbToArmPadded'), ['.thumb', '\tthumb_func_start_local ThumbToArmPadded', 'ThumbToArmPadded: @ 08000154', '\tbx pc', '\t.align 2, 0', '.arm', '\tbx lr', '\tthumb_func_end ThumbToArmPadded']);
});

test('a short branch across a module border prints raw with its target and reason, and is counted', () => {
  const printed = printChunk(rom, model, index('Tail', 'main'));
  assert.deepEqual(printed.lines, ['.thumb', '\tthumb_func_start_local Tail', 'Tail: @ 0800015C', '\t.inst.n 0xE018 @ b 0x08000190 (cross-module-short-branch)', '\t.align 2, 0', '\tthumb_func_end Tail']);
  assert.deepEqual(printed.stats, { insns: 1, rawInsns: 1, branches: 1, symbolicBranches: 0, poolLoads: 0, symbolicPoolLoads: 0, rawReasons: { 'cross-module-short-branch': 1 } });
});

test('an orphan: the comment, a global unk_ label, its bytes split at the global data label inside', () => {
  assert.deepEqual(lines('unk_08000160'), [
    '.thumb',
    '@ bytes between functions: 32 bytes',
    '.global unk_08000160',
    'unk_08000160: @ 08000160',
    '\t.4byte 0x13121110, 0x17161514, 0x1B1A1918, 0x1F1E1D1C',
    '.global gTable',
    'gTable:',
    '\t.4byte 0x23222120, 0x27262524, 0x2B2A2928, 0x2F2E2D2C',
  ]);
});

test('an ARM function with a global label: arm_func_start, a pool naming a global data label, a mixer hole', () => {
  assert.deepEqual(lines('ArmFunc', 'other'), [
    '.arm',
    '\tarm_func_start ArmFunc',
    'ArmFunc: @ 08000180',
    '\tldr r0, _08000188 @ =gTable',
    '\tbx lr',
    '_08000188: .4byte gTable',
    '\t.4byte 0xDEADBEEF @ mixer hole',
    '\tarm_func_end ArmFunc',
  ]);
});

test('a module-scoped name repeated in another module prints _local; a global inner Thumb label is typed', () => {
  assert.deepEqual(lines('Helper', 'other'), [
    '.thumb',
    '\tthumb_func_start_local Helper',
    'Helper: @ 08000190',
    '\tmovs r0, #2',
    '.global HelperTail',
    '.type HelperTail, %function',
    '.thumb_func',
    'HelperTail:',
    '\tbx lr',
    '\tthumb_func_end Helper',
  ]);
});

test('the header and an ARM startup chunk', () => {
  const header = printChunk(rom, model, index('rom_header', 'rom_header')).lines;
  assert.deepEqual(header.slice(0, 4), ['.thumb', '@ GBA cartridge header', '.global rom_header', 'rom_header:']);
  assert.equal(header.length, 4 + 12);
  assert.ok(header.slice(4).every((l) => /^\t\.byte( 0x[0-9A-F]{2},){15} 0x[0-9A-F]{2}$/.test(l)));
  assert.deepEqual(lines('Start', 'crt0'), ['.arm', '\tarm_func_start_local Start', 'Start: @ 080000C0', '\tldr r0, _080000CC @ =Main', '\tmov lr, pc', '\tbx r0', '_080000CC: .4byte Main', '\tarm_func_end Start']);
});

test('statistics count instructions, branches and PC-relative loads, and what printed symbolically', () => {
  assert.deepEqual(printChunk(rom, model, index('Main', 'main')).stats, { insns: 9, rawInsns: 0, branches: 2, symbolicBranches: 2, poolLoads: 2, symbolicPoolLoads: 2, rawReasons: {} });
  assert.deepEqual(printChunk(rom, model, index('unk_08000160', 'main')).stats, { insns: 0, rawInsns: 0, branches: 0, symbolicBranches: 0, poolLoads: 0, symbolicPoolLoads: 0, rawReasons: {} });
});

test('the raw printer keeps the opening and closing and prints the body with printRawRange', () => {
  const i = index('Main', 'main');
  const raw = printChunk(rom, model, i, 'raw');
  assert.deepEqual(printChunk(rom, model, i, { decomp: { defined: [] }, printer: 'raw' }), raw, 'a Printer or an EmitContext');
  const chunk = model.chunks[i]!;
  const body = printRawRange(rom, (a) => a >= 0x0800_0114 && a < 0x0800_0124, chunk.span.start, chunk.span.end, []);
  assert.deepEqual(raw.lines, ['.thumb', '\tthumb_func_start Main', 'Main: @ 08000100', ...body, '\tthumb_func_end Main']);
  assert.deepEqual(raw.stats, { insns: 9, rawInsns: 9, branches: 2, symbolicBranches: 0, poolLoads: 2, symbolicPoolLoads: 0, rawReasons: { 'raw-printer': 9 } });
  assert.deepEqual(printChunk(rom, model, index('Tail', 'main'), 'raw').stats.rawReasons, { 'cross-module-short-branch': 1 });
});

test('the raw printer places inner and global labels, declaring the global ones', () => {
  assert.deepEqual(printChunk(rom, model, index('Helper', 'other'), 'raw').lines, ['.thumb', '\tthumb_func_start_local Helper', 'Helper: @ 08000190', '.global HelperTail', '\t.2byte 0x2002', 'HelperTail: @ 08000192', '\t.2byte 0x4770', '\tthumb_func_end Helper']);
  assert.ok(printChunk(rom, model, index('unk_08000160', 'main'), 'raw').lines.includes('gTable: @ 08000170'));
});

/** Every mnemonic line of every chunk, re-parsed and re-assembled at its instruction's address. */
function roundTripEveryMnemonic(r: Rom, m: Model): number {
  let checked = 0;
  for (const [ci, chunk] of m.chunks.entries()) {
    const runOffset = chunk.runAt === undefined ? 0 : chunk.runAt - chunk.span.start;
    const insns = [];
    for (let i = chunk.items.first; i < chunk.items.first + chunk.items.count; i++) {
      const item = itemAt(m.items, i, r, runOffset);
      if (item.kind === 'insn' || item.kind === 'raw-insn') insns.push(item);
    }
    const code = printChunk(r, m, ci).lines.filter((l) => l.startsWith('\t') && !l.startsWith('\t.') && !/^\t\w+_func_(start|end)/.test(l));
    assert.equal(code.length + insns.filter((x) => x.kind === 'raw-insn').length, insns.length, `chunk ${chunk.name}: one line per instruction`);
    const printed = insns.filter((x) => x.kind === 'insn');
    for (const [k, line] of code.entries()) {
      const item = printed[k]!;
      const text = line.replace(/\s*@.*$/, '').trim();
      const parsed = parse(text, item.insn.mode, item.insn.addr, resolverFor(m, chunk.module));
      assert.ok(parsed !== undefined, `${chunk.name}: '${text}' does not parse`);
      const assembled = assemble(parsed, item.insn.addr);
      assert.deepEqual(assembled === undefined ? undefined : { size: assembled.size, word: assembled.word }, { size: item.insn.size, word: item.insn.word }, `${chunk.name}: '${text}'`);
      checked++;
    }
  }
  return checked;
}

test('every readable mnemonic line re-parses and re-assembles to its bytes at its address', () => {
  assert.equal(roundTripEveryMnemonic(rom, model), 31);
});

test('a runs_at chunk decodes and labels at its run address', () => {
  const RUN = 0x0300_0000;
  const LOAD = 0x0800_0300;
  const r = romWith([{ at: LOAD, bytes: thumbAt(RUN)`loop: subs r0, #1; bne loop; bx lr` }]);
  const m = modelOf(r, {
    modules: [{ name: 'iwram', runAt: RUN, chunks: [{ name: 'RamLoop', runAt: RUN, items: codeItems(r, LOAD, LOAD + 6, 'thumb') }] }],
    labels: [label('RamLoop', RUN)],
  });
  assert.deepEqual(printChunk(r, m, 0).lines, ['.thumb', '\tthumb_func_start_local RamLoop', 'RamLoop: @ 03000000', '\tsubs r0, #1', '\tbne RamLoop', '\tbx lr', '\tthumb_func_end RamLoop']);
  assert.equal(roundTripEveryMnemonic(r, m), 3);
});

test('a chunk index outside the model is a caller bug', () => {
  assert.throws(() => printChunk(rom, model, model.chunks.length), /no chunk/);
});

test('a multi-MiB data run inside a code chunk prints with both printers, no stack overflow (correctness-3)', () => {
  // A 4 MiB orphan of data: 262,144 `.4byte` lines, more than a call can take as spread arguments.
  const size = 0x40_0000;
  const big = romWith([], { size: size + 0x100 });
  const m = modelOf(big, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0x100)] }] },
      { name: 'main', chunks: [{ kind: 'orphan', name: 'unk_08000100', items: [dataItem(0x0800_0100, size)] }] },
    ],
    labels: [],
    symbols: [],
  });
  for (const how of ['readable', 'raw'] as const) {
    const printed = printChunk(big, m, 1, how);
    assert.ok(printed.lines.length > size / 16, how);
    assert.equal(printed.lines[0], '.thumb');
  }
});

// ---------------------------------------------------------------------------------------------------
// A function chunk that folded the zero pad before its entry (phase-3.md Q5 b).

/** A at 0x100 (Thumb, ending at 0x10A, its first instruction `a`), a 2-byte zero pad, B at 0x10C, data from 0x110: buildModel's model. */
function folded(a: string): { readonly rom: Rom; readonly model: Model } {
  const r = romWith(
    [
      { at: BASE + 0x100, bytes: thumbAt(BASE + 0x100)`${a}; bl _0800010C; pop {pc}` },
      { at: BASE + 0x10c, bytes: thumbAt(BASE + 0x10c)`movs r0, #1; bx lr` },
    ],
    { size: 0x200 },
  );
  const analysis = analysisOf(r, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x10a }), fact({ entry: BASE + 0x10c, end: BASE + 0x110 })] });
  const config = configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x110, kind: 'data', generated: true }], functions: [[BASE + 0x100, 'A'], [BASE + 0x10c, 'B']] });
  return { rom: r, model: buildModel(r, analysis, config) };
}

/** The self-checks of the model and its tree with `printer`: the failing checks' details, empty when all pass. */
function selfChecks(r: Rom, m: Model, printer: 'readable' | 'raw'): readonly string[] {
  const reports = [verifyModel(r, m), checkEntries(r, m, emitTree(r, m, { decomp: { defined: [] }, printer }))];
  return reports.flatMap((report) => report.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`));
}

test('a folded pad: both printers put the start macro and label at the entry and print no .align, which the macro emits', () => {
  const { rom: r, model: m } = folded('push {lr}; movs r0, #0');
  const b = m.chunks.findIndex((c) => c.name === 'B');
  assert.deepEqual(m.chunks[b]?.span, { start: BASE + 0x10a, end: BASE + 0x110 });
  assert.deepEqual(printChunk(r, m, b).lines, ['.thumb', '\tthumb_func_start B', 'B: @ 0800010C', '\tmovs r0, #1', '\tbx lr', '\tthumb_func_end B']);
  assert.deepEqual(printChunk(r, m, b, 'raw').lines, ['.thumb', '\tthumb_func_start B', 'B: @ 0800010C', '\t.2byte 0x2001, 0x4770', '\tthumb_func_end B']);
  assert.equal(m.chunks.some((c) => c.kind === 'orphan' && c.span.start === BASE + 0x10a), false);
  assert.deepEqual(selfChecks(r, m, 'readable'), []);
  assert.deepEqual(selfChecks(r, m, 'raw'), []);
});

test('a label inside a folded pad: the pad prints before the start macro (readable: with its local label), so the macro aligns nothing', () => {
  const { rom: r, model: m } = folded('push {lr}; beq _0800010A');
  const b = m.chunks.findIndex((c) => c.name === 'B');
  assert.deepEqual(printChunk(r, m, b).lines, ['.thumb', '_0800010A:', '\t.2byte 0x0000', '\tthumb_func_start B', 'B: @ 0800010C', '\tmovs r0, #1', '\tbx lr', '\tthumb_func_end B']);
  assert.deepEqual(printChunk(r, m, b, 'raw').lines, ['.thumb', '\t.2byte 0x0000', '\tthumb_func_start B', 'B: @ 0800010C', '\t.2byte 0x2001, 0x4770', '\tthumb_func_end B']);
  assert.ok(printChunk(r, m, m.chunks.findIndex((c) => c.name === 'A')).lines.includes('\tbeq _0800010A'));
  assert.deepEqual(selfChecks(r, m, 'readable'), []);
  assert.deepEqual(selfChecks(r, m, 'raw'), []);
});
