// Instruction items (architecture §5 "Printing rule", D14, D15): an insn item prints its mnemonic through
// foundation/isa `format` with its module's resolver, an adr with the one that names only labels linking to its
// target itself (the model has proved it round-trips); a raw-insn item
// prints `.inst.n 0xXXXX @ <decoding>` / `.inst.w` / `.inst 0xXXXXXXXX @ <decoding>` (formatRaw), its reason
// in the comment, so a cross-module short branch shows its numeric target and why it is raw. A PC-relative
// load also names what its pool word prints as (`@ =gFoo`). The result says what the readability family
// counts: whether it is a branch (b, bcc, bl) or a PC-relative load, and whether it printed symbolically.
import { format, formatRaw } from '@match-kit/isa/armv4t';
import type { Insn, SymbolResolver } from '@match-kit/isa/armv4t';

import type { Rom } from '../../../foundation/rom/rom.ts';
import { u16, u32 } from '../../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../../foundation/rom/span.ts';
import { hex } from '../../../foundation/util/hex.ts';
import type { ItemRawReason } from '../../model/types.ts';
import { poolLoadComment } from './pool.ts';

/** One printed instruction item. */
export interface PrintedInsn {
  readonly line: string;
  /** The state the item is assembled in; the chunk printer switches to it first. */
  readonly mode: Mode;
  /** Undefined when it printed as a mnemonic. */
  readonly rawReason?: ItemRawReason;
  readonly branch: boolean;
  readonly poolLoad: boolean;
}

/** What the instruction printer needs besides the item: names for addresses and for pool words. */
export interface InsnContext {
  readonly resolver: SymbolResolver;
  /**
   * The names of an adr's target (core/model/resolver.ts adrResolverFor): only labels that link to the target
   * itself, never a Thumb function's, which links to the target plus one.
   */
  readonly adrResolver: SymbolResolver;
  /** What the word loaded from run address `addr` prints as, or undefined when it is not in the ROM. */
  poolOperand(addr: Addr): string | undefined;
}

function isBranch(insn: Insn): boolean {
  return insn.flow.kind === 'branch' || insn.flow.kind === 'call';
}

function isPoolLoad(insn: Insn): boolean {
  return insn.flow.kind === 'pool-load';
}

/** formatRaw's text, with the item's reason appended when formatRaw did not already name it. */
function rawText(insn: Insn, reason: ItemRawReason): string {
  const text = formatRaw(insn);
  return text.endsWith(`(${reason})`) ? text : `${text} (${reason})`;
}

/** An instruction item as a mnemonic; falls back to raw ('no-roundtrip') when the text cannot be formed. */
export function printInsn(insn: Insn, cx: InsnContext): PrintedInsn {
  const text = format(insn, insn.flow.kind === 'adr' ? cx.adrResolver : cx.resolver);
  if (text === undefined) return printRawInsn(insn, 'no-roundtrip');
  let line = `\t${text}`;
  if (insn.flow.kind === 'pool-load') {
    const operand = cx.poolOperand(insn.flow.pool);
    if (operand !== undefined) line = `${line} ${poolLoadComment(operand)}`;
  }
  return { line, mode: insn.mode, branch: isBranch(insn), poolLoad: isPoolLoad(insn) };
}

/** A decoded instruction printed raw for `reason`. */
export function printRawInsn(insn: Insn, reason: ItemRawReason): PrintedInsn {
  return {
    line: `\t${rawText(insn, reason)}`,
    mode: insn.mode,
    rawReason: reason,
    branch: isBranch(insn),
    poolLoad: isPoolLoad(insn),
  };
}

/**
 * A raw-insn item the model kept no row for: its bytes as `.inst.n` / `.inst.w` (a Thumb pair, first halfword
 * first, as formatRaw spells it) in Thumb state, `.inst` in ARM state.
 */
export function printUndecodedInsn(rom: Rom, span: Span, mode: Mode, reason: ItemRawReason): PrintedInsn {
  const length = span.end - span.start;
  let text: string;
  if (mode === 'arm' && length === 4) text = `.inst 0x${hex(u32(rom, span.start))}`;
  else if (length === 4) text = `.inst.w 0x${hex(u16(rom, span.start), 4)}${hex(u16(rom, span.start + 2), 4)}`;
  else text = `.inst.n 0x${hex(u16(rom, span.start), 4)}`;
  return {
    line: `\t${text} @ (${reason})`,
    mode: mode === 'arm' && length !== 4 ? 'thumb' : mode,
    rawReason: reason,
    branch: false,
    poolLoad: false,
  };
}
