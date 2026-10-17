// The printing rule (D14): an instruction prints as a mnemonic only when its own text, parsed and
// assembled in process at its address, gives back its size and bytes.
import { assemble } from './assemble.ts';
import { format } from './format.ts';
import { parse } from './parse.ts';
import { specOf } from './rows.ts';
import type { Insn, RawReason, SymbolResolver } from './types.ts';

/** assemble(parse(format(insn))) reproduces the instruction's size and word. */
export function roundTrips(insn: Insn, resolver: SymbolResolver): boolean {
  const text = format(insn, resolver);
  if (text === undefined) return false;
  const parsed = parse(text, insn.mode, insn.addr, resolver);
  if (parsed === undefined) return false;
  const assembled = assemble(parsed, insn.addr);
  return assembled !== undefined && assembled.size === insn.size && assembled.word === insn.word;
}

/** Why the instruction prints raw: the row's encoding reason first, then 'no-roundtrip'; null when it prints. */
export function rawReason(insn: Insn, resolver: SymbolResolver): RawReason | null {
  const reason = specOf(insn.specId).raw?.(insn.fields) ?? null;
  if (reason !== null) return reason;
  return roundTrips(insn, resolver) ? null : 'no-roundtrip';
}
