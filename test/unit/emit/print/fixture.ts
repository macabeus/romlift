// A hand-made Model with real instruction bytes for the printer and writer tests (D62 f): every item kind,
// a Thumb function at 2 mod 4, ARM code after `bx pc` (after `mov r8, r8` and after zero padding), each case
// of the pool naming rule, a jump table with the Thumb bit, data notes, an orphan with a global label inside,
// a cross-module short branch printed raw, a module-scoped name repeated in two modules, and an inner label.
// `layoutUnit` lays a unit file and its includes out with foundation/asm, the assembler model the corpus
// proves against GNU as, so a test can require the text to reproduce the ROM bytes.
import type { FileEntry } from '../../../../src/core/emit/tree.ts';
import { resolverFor, symbolValueOf } from '../../../../src/core/model/resolver.ts';
import type { Label, Model } from '../../../../src/core/model/types.ts';
import { DIALECT } from '../../../../src/foundation/asm/dialect.ts';
import { layoutStatements } from '../../../../src/foundation/asm/layout.ts';
import type { Layout } from '../../../../src/foundation/asm/layout.ts';
import { parseStatements } from '../../../../src/foundation/asm/statements.ts';
import type { Statement } from '../../../../src/foundation/asm/statements.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import type { Addr } from '../../../../src/foundation/rom/span.ts';
import { armAt } from '../../../helpers/arm.ts';
import { codeItems, dataItem, label, modelOf, poolItem, romWith, words } from '../../../helpers/model.ts';
import type { ItemInput } from '../../../helpers/model.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

export const MAIN = 0x0800_0100;
export const HELPER = 0x0800_0126;
export const SWITCH = 0x0800_012c;
export const TO_ARM = 0x0800_0148;
export const TO_ARM_PAD = 0x0800_0154;
export const TAIL = 0x0800_015c;
export const ORPHAN = 0x0800_0160;
export const G_TABLE = 0x0800_0170;
export const ARM_FUNC = 0x0800_0180;
export const HELPER_2 = 0x0800_0190;
export const RAM_WORD = 0x0300_0000;

/** The sample ROM: header, an ARM startup piece, and the code of the modules `main` and `other`. */
export function sampleRom(): Rom {
  return romWith([
    { at: 0x0800_00c0, bytes: armAt(0x0800_00c0)`ldr r0, _080000CC; mov lr, pc; bx r0` },
    { at: 0x0800_00cc, bytes: words(MAIN + 1) },
    {
      at: MAIN,
      bytes: thumbAt(MAIN)`
        push {lr}
        bl _08000126
        ldr r0, _08000114
        ldr r1, _08000118
        cmp r0, #0
        beq _08000110
        movs r0, #1
        pop {r0}
        bx r0`,
    },
    { at: 0x0800_0114, bytes: words(HELPER + 1, MAIN, RAM_WORD, ARM_FUNC) },
    { at: 0x0800_0124, bytes: Uint8Array.of(0xff, 0xee) },
    { at: HELPER, bytes: thumbAt(HELPER)`movs r0, #0; bx lr` },
    {
      at: SWITCH,
      bytes: thumbAt(SWITCH)`
        lsls r0, r0, #2
        ldr r1, _08000138
        adds r0, r0, r1
        ldr r0, [r0]
        mov pc, r0`,
    },
    { at: 0x0800_0138, bytes: words(0x0800_013c, 0x0800_0145, 0x0800_0147) },
    { at: 0x0800_0144, bytes: thumbAt(0x0800_0144)`movs r0, #1; bx lr` },
    { at: TO_ARM, bytes: thumbAt(TO_ARM)`bx pc; mov r8, r8` },
    { at: TO_ARM + 4, bytes: armAt(TO_ARM + 4)`add r0, r0, #1; bx lr` },
    { at: TO_ARM_PAD, bytes: thumbAt(TO_ARM_PAD)`bx pc` },
    { at: TO_ARM_PAD + 4, bytes: armAt(TO_ARM_PAD + 4)`bx lr` },
    { at: TAIL, bytes: thumbAt(TAIL)`b _08000190` },
    { at: ORPHAN, bytes: Uint8Array.from({ length: 0x20 }, (_, i) => 0x10 + i) },
    { at: ARM_FUNC, bytes: armAt(ARM_FUNC)`ldr r0, _08000188; bx lr` },
    { at: ARM_FUNC + 8, bytes: words(G_TABLE, 0xdeadbeef) },
    { at: HELPER_2, bytes: thumbAt(HELPER_2)`movs r0, #2; bx lr` },
  ]);
}

const g = { scope: 'global' } as const;

/** The labels of the sample model. */
export function sampleLabels(): readonly Label[] {
  return [
    label('rom_header', 0x0800_0000, { kind: 'data', thumb: false, ...g }),
    label('Start', 0x0800_00c0, { thumb: false }),
    label('_080000CC', 0x0800_00cc, { kind: 'pool', thumb: false }),
    label('unk_080000D0', 0x0800_00d0, { kind: 'data', thumb: false }),
    label('Main', MAIN, g),
    label('_08000110', 0x0800_0110, { kind: 'local' }),
    ...[0x114, 0x118, 0x11c, 0x120].map((o) =>
      label(`_08000${o.toString(16).toUpperCase()}`, 0x0800_0000 + o, { kind: 'pool', thumb: false }),
    ),
    label('Helper', HELPER),
    label('Switch', SWITCH),
    label('_08000138', 0x0800_0138, { kind: 'pool', thumb: false }),
    label('_0800013C', 0x0800_013c, { kind: 'table', thumb: false }),
    label('_08000144', 0x0800_0144, { kind: 'local' }),
    label('_08000146', 0x0800_0146, { kind: 'local' }),
    label('ThumbToArm', TO_ARM),
    label('ThumbToArmPadded', TO_ARM_PAD),
    label('Tail', TAIL),
    label('unk_08000160', ORPHAN, { kind: 'data', thumb: false }),
    label('gTable', G_TABLE, { kind: 'data', thumb: false, ...g }),
    label('ArmFunc', ARM_FUNC, { thumb: false, ...g }),
    label('_08000188', ARM_FUNC + 8, { kind: 'pool', thumb: false }),
    label('Helper', HELPER_2),
    label('HelperTail', HELPER_2 + 2, g),
  ];
}

function replace(items: readonly ItemInput[], at: Addr, item: ItemInput): ItemInput[] {
  return items.map((i) => (i.start === at ? item : i));
}

/** The sample model over sampleRom(). */
export function sampleModel(rom: Rom = sampleRom()): Model {
  return modelOf(rom, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
      {
        name: 'crt0',
        chunks: [
          {
            kind: 'startup',
            name: 'Start',
            mode: 'arm',
            items: [...codeItems(rom, 0x0800_00c0, 0x0800_00cc, 'arm'), poolItem(rom, 0x0800_00cc)],
          },
          { kind: 'orphan', name: 'unk_080000D0', mode: null, items: [dataItem(0x0800_00d0, 0x30)] },
        ],
      },
      {
        name: 'main',
        chunks: [
          {
            name: 'Main',
            items: [
              ...codeItems(rom, MAIN, 0x0800_0114, 'thumb'),
              ...[0x114, 0x118, 0x11c, 0x120].map((o) => poolItem(rom, 0x0800_0000 + o)),
              dataItem(0x0800_0124, 2, 'dead'),
            ],
          },
          {
            name: 'Helper',
            items: [
              ...codeItems(rom, HELPER, 0x0800_012a, 'thumb'),
              { kind: 'padding', start: 0x0800_012a, length: 2 },
            ],
          },
          {
            name: 'Switch',
            items: [
              ...codeItems(rom, SWITCH, 0x0800_0136, 'thumb'),
              { kind: 'padding', start: 0x0800_0136, length: 2 },
              poolItem(rom, 0x0800_0138),
              { kind: 'table-entry', start: 0x0800_013c, target: 0x0800_0144, thumbBit: true },
              { kind: 'table-entry', start: 0x0800_0140, target: 0x0800_0146, thumbBit: true },
              ...codeItems(rom, 0x0800_0144, 0x0800_0148, 'thumb'),
            ],
          },
          {
            name: 'ThumbToArm',
            items: [...codeItems(rom, TO_ARM, TO_ARM + 4, 'thumb'), ...codeItems(rom, TO_ARM + 4, TO_ARM + 12, 'arm')],
          },
          {
            name: 'ThumbToArmPadded',
            items: [
              ...codeItems(rom, TO_ARM_PAD, TO_ARM_PAD + 2, 'thumb'),
              { kind: 'padding', start: TO_ARM_PAD + 2, length: 2 },
              ...codeItems(rom, TO_ARM_PAD + 4, TO_ARM_PAD + 8, 'arm'),
            ],
          },
          {
            name: 'Tail',
            items: [
              ...replace(codeItems(rom, TAIL, TAIL + 2, 'thumb'), TAIL, {
                kind: 'raw-insn',
                start: TAIL,
                length: 2,
                specId: 'thumb.b',
                reason: 'cross-module-short-branch',
              }),
              { kind: 'padding', start: TAIL + 2, length: 2 },
            ],
          },
          { kind: 'orphan', name: 'unk_08000160', mode: null, items: [dataItem(ORPHAN, 0x20)] },
        ],
      },
      {
        name: 'other',
        chunks: [
          {
            name: 'ArmFunc',
            mode: 'arm',
            items: [
              ...codeItems(rom, ARM_FUNC, ARM_FUNC + 8, 'arm'),
              poolItem(rom, ARM_FUNC + 8),
              dataItem(ARM_FUNC + 12, 4, 'mixer-hole'),
            ],
          },
          {
            name: 'Helper',
            items: codeItems(rom, HELPER_2, HELPER_2 + 4, 'thumb'),
            innerLabels: [label('HelperTail', HELPER_2 + 2, g)],
          },
        ],
      },
    ],
    labels: sampleLabels(),
  });
}

// ---------------------------------------------------------------------------------------------------
// Laying a unit file out.

const MACROS = new Map([['include/macros.inc', DIALECT.macrosInc]]);

function statementsOf(text: string, errors: string[], where: string): readonly Statement[] {
  // An included chunk file uses the macros its including unit defined: parse it with them.
  const parsed = parseStatements(`.include "include/macros.inc"\n${text}`, { includes: MACROS });
  for (const e of parsed.errors) errors.push(`${where}:${e.line - 1}: ${e.message}`);
  return parsed.statements;
}

/** A unit file of `entries` laid out at its module's start, with every include resolved from `entries`. */
export function layoutUnit(
  model: Model,
  entries: readonly FileEntry[],
  path: string,
  moduleName: string,
): { readonly layout: Layout; readonly errors: readonly string[] } {
  const texts = new Map(entries.flatMap((e) => (e.ownership === 'generated' ? [[e.path, e.text] as const] : [])));
  const module = model.modules.find((m) => m.name === moduleName);
  const unit = texts.get(path);
  if (module === undefined || unit === undefined) throw new Error(`no unit ${path} of module ${moduleName}`);
  const errors: string[] = [];
  const parsed = parseStatements(unit, { includes: MACROS });
  for (const e of parsed.errors) errors.push(`${path}:${e.line}: ${e.message}`);
  const resolver = resolverFor(model, moduleName);
  const layout = layoutStatements({
    statements: parsed.statements,
    start: module.span.start,
    mode: 'thumb',
    resolve: (name) => {
      const addr = resolver.addressOf(name);
      const found = model.labels.find((l) => l.name === name && l.addr === addr);
      return found === undefined ? undefined : symbolValueOf(found);
    },
    incbin: () => undefined,
    include: (p) => {
      const text = texts.get(p);
      return text === undefined ? undefined : statementsOf(text, errors, p);
    },
  });
  for (const e of layout.errors) errors.push(`${path}: line ${e.line} at 0x${e.at.toString(16)}: ${e.message}`);
  return { layout, errors };
}

/** The ROM bytes of [start, end). */
export function romBytes(rom: Rom, start: Addr, end: Addr): Uint8Array {
  return rom.bytes.subarray(start - rom.base, end - rom.base);
}
