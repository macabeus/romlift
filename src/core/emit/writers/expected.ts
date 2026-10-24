// The `expected` writer (architecture §6.1 rung 3, §6.3, §6.8, D92): expected/<module>.s of every generated module (a
// `c` module's is the one a decompiled function is diffed against; an asm or data module's lets objdiff and
// g6.expected-bytes judge every module alike), objdiff's target. Scope: module; ownership generated. `make expected` assembles it with the build's assembler flags
// and no compiler into expected/<module>.o, whose `.text` is the module's ROM range byte for byte at the same offsets
// (g6.expected-bytes, which reads the unlinked object) and whose symbols are the module's functions under their model
// names, global and typed as functions, with their sizes: the names a decompiled function's C object defines, which
// objdiff pairs it with. A module's data range (§6.6) is not part of it: its bytes are the C object's `.rodata`.
//
// The chunks are not printed as their chunk files are. A chunk file names labels (`bl Name`, `.4byte Name`), which an
// unlinked object leaves to relocations whose fields hold no ROM bytes (an R_ARM_ABS32 word holds 0), so its `.text`
// could not equal the ROM. Every item is printed as its own bytes instead: an instruction as `.inst.n`/`.inst.w`
// (Thumb) or `.inst` (ARM), so the object keeps the `$t`/`$a` mapping symbols and objdiff disassembles it as code; a
// pool word or a table entry as `.4byte <value>` and padding as `.byte`, data (`$d`) as agbcc's pools are; any other
// data as `.incbin` of baserom.gba. The object has no relocation at all: the target objdiff accepts "created without
// relocations" (objdiff.json's `functionRelocDiffs = none`, the objdiff writer). It does not depend on which chunk files
// the tree writes where (asm/nonmatchings/ or asm/matchings/): it is the ROM's, whatever has been decompiled.
//
// Per chunk, in ROM order: before its entry the pad it folded (core/model/chunks.ts); at its entry, and at each inner
// function label, the label's state (`.thumb`/`.arm`), `.global`, `.type <name>, %function`, `.thumb_func` for a Thumb
// one, and the label; an orphan, header or data chunk gets a global label of its name; then its items, switching state
// only before a label or an instruction of the other state (GNU as word-aligns at `.arm`); a function chunk ends with
// `.size <name>, .-<name>`.
import { DIALECT } from '../../../foundation/asm/dialect.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import { ROM_BASE, u16, u32, u8 } from '../../../foundation/rom/rom.ts';
import type { Addr, Mode } from '../../../foundation/rom/span.ts';
import { hex } from '../../../foundation/util/hex.ts';
import { BASEROM_FILE } from '../../../foundation/util/project-files.ts';
import { chunkEntry } from '../../model/chunks.ts';
import { modeOfSpec, specIdAt } from '../../model/item-table.ts';
import { expectedSourcePath, hasExpectedTarget } from '../../model/paths.ts';
import { ItemKind, NO_SPEC } from '../../model/types.ts';
import type { Chunk, Label, Model, Module } from '../../model/types.ts';
import type { EmitContext, FileEntry, Writer } from '../tree.ts';

/** The bytes per `.byte` line of padding. */
const BYTES_PER_LINE = 16;

function modeDirective(mode: Mode): string {
  return mode === 'arm' ? '.arm' : '.thumb';
}

/** The lines that define function label `name` at the running address, in `mode`. */
function functionLabel(name: string, mode: Mode): readonly string[] {
  return [`\t.global ${name}`, `\t.type ${name}, %function`, ...(mode === 'thumb' ? ['\t.thumb_func'] : []), `${name}:`];
}

/** The mode of item `i`'s isa row, or undefined for an item that names none. */
function itemMode(model: Model, i: number): Mode | undefined {
  const kind = model.items.kind[i];
  if (kind !== ItemKind.insn && kind !== ItemKind.rawInsn) return undefined;
  const spec = specIdAt(model.items.spec[i] ?? NO_SPEC);
  return spec === undefined ? undefined : modeOfSpec(spec);
}

/** The ROM bytes [start, start + length) as `.byte` lines. */
function byteLines(rom: Rom, start: Addr, length: number): string[] {
  const out: string[] = [];
  for (let at = start; at < start + length; at += BYTES_PER_LINE) {
    const bytes: string[] = [];
    for (let a = at; a < Math.min(start + length, at + BYTES_PER_LINE); a++) bytes.push(`0x${hex(u8(rom, a), 2)}`);
    out.push(`\t.byte ${bytes.join(', ')}`);
  }
  return out;
}

/** One instruction's bytes in state `mode`: `.inst` (an ARM word), `.inst.w` (a Thumb pair, first halfword first), `.inst.n`. */
function instLine(rom: Rom, start: Addr, width: 2 | 4, mode: Mode): string {
  if (mode === 'arm') return `\t.inst 0x${hex(u32(rom, start))}`;
  if (width === 4) return `\t.inst.w 0x${hex(u16(rom, start), 4)}${hex(u16(rom, start + 2), 4)}`;
  return `\t.inst.n 0x${hex(u16(rom, start), 4)}`;
}

/** Item `i` as the directives that emit exactly its bytes, in state `mode` (an instruction's own, set by the caller). */
function itemLines(rom: Rom, model: Model, i: number, mode: Mode): readonly string[] {
  const start = model.items.start[i] ?? 0;
  const length = model.items.length[i] ?? 0;
  switch (model.items.kind[i]) {
    case ItemKind.insn:
    case ItemKind.rawInsn: {
      const width: 2 | 4 = mode === 'arm' || length === 4 ? 4 : 2;
      const lines: string[] = [];
      for (let at = start; at < start + length; at += width) lines.push(instLine(rom, at, width, mode));
      return lines;
    }
    case ItemKind.pool:
    case ItemKind.tableEntry:
      return [`\t.4byte 0x${hex(u32(rom, start))}`];
    case ItemKind.padding:
      return byteLines(rom, start, length);
    default:
      return [`\t.incbin "${BASEROM_FILE}", 0x${(start - ROM_BASE).toString(16).toUpperCase()}, 0x${length.toString(16).toUpperCase()}`];
  }
}

/** The inner function labels of a chunk by address (Chunk.innerLabels: label entries and second entries). */
function innerFunctionLabels(chunk: Chunk): ReadonlyMap<Addr, readonly Label[]> {
  const out = new Map<Addr, Label[]>();
  for (const label of chunk.innerLabels) {
    if (label.kind !== 'func') continue;
    const list = out.get(label.addr) ?? [];
    list.push(label);
    out.set(label.addr, list);
  }
  return out;
}

/** The lines of chunk `c` from state `incoming`, and the state they leave. */
function chunkLines(rom: Rom, model: Model, c: number, incoming: Mode): { readonly lines: readonly string[]; readonly mode: Mode } {
  const chunk = model.chunks[c];
  if (chunk === undefined) return { lines: [], mode: incoming };
  let mode = incoming;
  const lines: string[] = [''];
  // A state switch only where a label or an instruction needs it: `.arm` aligns to a word, so one before the zero pad
  // of an ARM function at 2 mod 4 would move every byte after it.
  const enter = (wanted: Mode): void => {
    if (wanted !== mode) lines.push(`\t${modeDirective(wanted)}`);
    mode = wanted;
  };
  const entry = chunkEntry(chunk);
  const isFunction = chunk.kind === 'function' || chunk.kind === 'startup';
  const inner = innerFunctionLabels(chunk);
  if (!isFunction) lines.push(`\t.global ${chunk.name}`, `${chunk.name}:`);
  for (let i = chunk.items.first; i < chunk.items.first + chunk.items.count; i++) {
    const start = model.items.start[i] ?? 0;
    if (isFunction && start === entry) {
      enter(chunk.mode ?? 'thumb');
      lines.push(...functionLabel(chunk.name, mode));
    }
    for (const label of inner.get(start) ?? []) {
      enter(label.thumb ? 'thumb' : 'arm');
      lines.push(...functionLabel(label.name, mode));
    }
    const own = itemMode(model, i);
    if (own !== undefined) enter(own);
    lines.push(...itemLines(rom, model, i, mode));
  }
  if (isFunction) lines.push(`\t.size ${chunk.name}, .-${chunk.name}`);
  return { lines, mode };
}

/** The text of expected/<module>.s: the preamble in the first chunk's mode, then every chunk of the module's span. */
export function expectedText(rom: Rom, model: Model, module: Module): string {
  const lines: string[] = [`@ ${expectedSourcePath(module.name)}: module ${module.name} (0x${hex(module.span.start)}..0x${hex(module.span.end)}) as the ROM's bytes, objdiff's target; generated by romlift.`];
  const opening: Mode = model.chunks[module.chunks.first]?.mode ?? 'thumb';
  let mode = opening;
  for (let c = module.chunks.first; c < module.chunks.first + module.chunks.count; c++) {
    const printed = chunkLines(rom, model, c, mode);
    lines.push(...printed.lines);
    mode = printed.mode;
  }
  return `${DIALECT.preamble(opening)}${lines.join('\n')}\n`;
}

function* expectedFile(rom: Rom, model: Model, _cx: EmitContext, module: number | null): Iterable<FileEntry> {
  const m = module === null ? undefined : model.modules[module];
  if (m === undefined || !hasExpectedTarget(m)) return;
  yield { ownership: 'generated', path: expectedSourcePath(m.name), text: expectedText(rom, model, m), writer: 'expected' };
}

export const expectedWriter: Writer = {
  id: 'expected',
  scope: 'module',
  emit: expectedFile,
};
