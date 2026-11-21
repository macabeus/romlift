// A small consistent project for the self-check tests: a ROM, its hand-made Model and the files a
// printer would emit for it, written by hand (the code writers are built in parallel, D62). The ROM:
//
//   0x08000000 rom_header  header chunk (the cartridge header romWith writes)
//   0x080000C0 crt0        startup chunk `start`, ARM: mov r0, #1; bx lr; then 0x38 bytes of data
//   0x08000100 main        Func (Thumb): push {lr}; ldr r0, [pc, #4]; pop {pc}; 2 bytes of padding; the pool
//                          word Func + 1 at 0x08000108 (`.4byte Func`, Thumb bit)
//              main        Veneer (Thumb): bx pc at 0x0800010C
//              main        ArmFunc (ARM): 2 bytes of padding from 0x0800010E (emitted by the switch to ARM
//                          state), then bx lr at 0x08000110
//              main        unk_08000114 (orphan): 0x2C bytes of data
//   0x08000140 data        gData: a table entry `.4byte Func` (Thumb bit), then data to the ROM end
//
// plus a RAM symbol gRam at 0x02000000 that symbols.ld defines.
import type { FileEntry, WriterId } from '../../../src/core/emit/tree.ts';
import type { Model } from '../../../src/core/model/types.ts';
import { DIALECT } from '../../../src/foundation/asm/dialect.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { armAt } from '../../helpers/arm.ts';
import { codeItems, dataItem, label, modelOf, poolItem, romWith, words } from '../../helpers/model.ts';
import { thumbAt } from '../../helpers/thumb.ts';

export const ROM_SIZE = 0x400;

function fill(from: number, length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (seed + 7 * i + (from & 0xff)) & 0xff || 1);
}

/** The fixture's ROM. */
export function fixtureRom(): Rom {
  return romWith(
    [
      { at: 0x0800_00c0, bytes: armAt(0x0800_00c0)`mov r0, #1; bx lr` },
      { at: 0x0800_00c8, bytes: fill(0xc8, 0x38, 3) },
      { at: 0x0800_0100, bytes: thumbAt(0x0800_0100)`push {lr}; ldr r0, _08000108; pop {pc}` },
      { at: 0x0800_0108, bytes: words(0x0800_0101) },
      { at: 0x0800_010c, bytes: thumbAt(0x0800_010c)`bx pc` },
      { at: 0x0800_0110, bytes: armAt(0x0800_0110)`bx lr` },
      { at: 0x0800_0114, bytes: fill(0x114, 0x2c, 11) },
      { at: 0x0800_0140, bytes: words(0x0800_0101) },
      { at: 0x0800_0144, bytes: fill(0x144, ROM_SIZE - 0x144, 29) },
    ],
    { size: ROM_SIZE },
  );
}

/** The fixture's Model over `rom`. */
export function fixtureModel(rom: Rom): Model {
  return modelOf(rom, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
      {
        name: 'crt0',
        chunks: [
          {
            kind: 'startup',
            name: 'start',
            mode: 'arm',
            items: [...codeItems(rom, 0x0800_00c0, 0x0800_00c8, 'arm'), dataItem(0x0800_00c8, 0x38)],
          },
        ],
      },
      {
        name: 'main',
        chunks: [
          {
            name: 'Func',
            items: [
              ...codeItems(rom, 0x0800_0100, 0x0800_0106, 'thumb'),
              { kind: 'padding', start: 0x0800_0106, length: 2 },
              poolItem(rom, 0x0800_0108),
            ],
          },
          { name: 'Veneer', items: codeItems(rom, 0x0800_010c, 0x0800_010e, 'thumb') },
          {
            name: 'ArmFunc',
            mode: 'arm',
            items: [
              { kind: 'padding', start: 0x0800_010e, length: 2 },
              ...codeItems(rom, 0x0800_0110, 0x0800_0114, 'arm'),
            ],
          },
          { kind: 'orphan', name: 'unk_08000114', items: [dataItem(0x0800_0114, 0x2c)] },
        ],
      },
      {
        name: 'data',
        kind: 'data',
        chunks: [
          {
            kind: 'data',
            name: 'gData',
            items: [
              { kind: 'table-entry', start: 0x0800_0140, target: 0x0800_0100, thumbBit: true },
              dataItem(0x0800_0144, ROM_SIZE - 0x144),
            ],
          },
        ],
      },
    ],
    labels: [
      label('start', 0x0800_00c0, { thumb: false }),
      label('Func', 0x0800_0100, { scope: 'global' }),
      label('_08000108', 0x0800_0108, { kind: 'pool', thumb: false }),
      label('Veneer', 0x0800_010c),
      label('ArmFunc', 0x0800_0110, { thumb: false }),
      label('gData', 0x0800_0140, { kind: 'data', thumb: false, scope: 'global' }),
    ],
    symbols: [{ addr: 0x0200_0000, name: 'gRam' }],
  });
}

const THUMB = DIALECT.preamble('thumb');
const ARM = DIALECT.preamble('arm');
// A chunk file is assembled inside its module file, which has included the macros already.
const CHUNK_THUMB = '.thumb\n';
const CHUNK_ARM = '.arm\n';

/** The files a printer would emit for the fixture, by path (the data, ldscript and symbols writers' are theirs). */
export const FILES: Readonly<Record<string, string>> = {
  'asm/rom_header.s': `.syntax unified
.global rom_header
rom_header:
\t.incbin "baserom.gba", 0x0, 0xC0
`,
  'asm/crt0.s': `${ARM}\tarm_func_start start
start: @ 0x080000C0
\tmov r0, #1
\tbx lr
\t.incbin "baserom.gba", 0xC8, 0x38
\tarm_func_end start
`,
  'asm/main.s': `${THUMB}
.include "asm/nonmatchings/main/Func.s"
.include "asm/nonmatchings/main/Veneer.s"
.include "asm/nonmatchings/main/ArmFunc.s"
.include "asm/nonmatchings/main/unk_08000114.s"
`,
  'asm/nonmatchings/main/Func.s': `${CHUNK_THUMB}\tthumb_func_start Func
Func: @ 0x08000100
\tpush {lr}
\tldr r0, _08000108
\tpop {pc}
\t.align 2, 0
_08000108: .4byte Func
\tthumb_func_end Func
`,
  'asm/nonmatchings/main/Veneer.s': `${CHUNK_THUMB}\tthumb_func_start_local Veneer
Veneer: @ 0x0800010C
\tbx pc
\tthumb_func_end Veneer
`,
  'asm/nonmatchings/main/ArmFunc.s': `${CHUNK_ARM}\tarm_func_start_local ArmFunc
ArmFunc: @ 0x08000110
\tbx lr
\tarm_func_end ArmFunc
`,
  'asm/nonmatchings/main/unk_08000114.s': `${CHUNK_THUMB}unk_08000114: @ 0x08000114
\t.incbin "baserom.gba", 0x114, 0x2C
`,
};

/** A generated FileEntry of `text` at `path`. */
export function entry(path: string, text: string, writer: WriterId = 'function'): FileEntry {
  return { ownership: 'generated', path, text, writer };
}

/** The fixture's hand-written files as entries. */
export function fixtureEntries(): readonly FileEntry[] {
  const writerOf = (path: string): WriterId =>
    path === 'asm/rom_header.s'
      ? 'header'
      : path === 'asm/crt0.s'
        ? 'crt0'
        : path === 'asm/main.s'
          ? 'module'
          : path.includes('/unk_')
            ? 'orphan'
            : 'function';
  return Object.keys(FILES)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => entry(path, FILES[path] ?? '', writerOf(path)));
}
