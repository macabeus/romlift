// romlift's reading of the instruction set (D121). The tables, the decoder and the printer are the package
// @match-kit/isa, which says only what the architecture says. Three things romlift reads into it are romlift's
// own, kept here so every layer reads them the same way:
//
//   - Half a Thumb bl is not code. Each half is a defined instruction, but no compiler emits one alone, so a
//     lone half is evidence of data: its flow is `invalid`, and it prints raw as `undefined`.
//   - A call changes more than lr. The procedure call standard lets a callee change r0-r3 and r12, and a BIOS
//     call changes r0-r3, so the register effect of a bl and of a swi adds them.
//   - A Thumb write to pc through add or mov is a jump, which the flow says; its register effect is nothing
//     here, as the analysis was tuned.
import {
  type FlowClass,
  type Insn,
  type InsnSpec,
  type Printing as IsaPrinting,
  type RawReason as IsaRawReason,
  type Mode,
  type RegisterEffect,
  type SymbolResolver,
  decode as isaDecode,
  printingOf as isaPrinting,
  rawReason as isaRawReason,
  registerEffect as isaRegisterEffect,
  specOf,
} from '@match-kit/isa/armv4t';

import type { Addr } from './rom/span.ts';

/** Why an instruction prints as `.inst`: the package's reasons, a lone bl half counted as `undefined`. */
export type RawReason = Exclude<IsaRawReason, 'bl-half'>;

/** Every RawReason, in the order reports list them. */
export const RAW_REASONS: readonly RawReason[] = ['undefined', 'unpredictable', 'sbz-set', 'as-alias', 'no-roundtrip'];

/** What the printing rule decided, with romlift's reasons. */
export type Printing = Exclude<IsaPrinting, { kind: 'raw' }> | { readonly kind: 'raw'; readonly reason: RawReason };

const toRomliftReason = (reason: IsaRawReason): RawReason => (reason === 'bl-half' ? 'undefined' : reason);

const INVALID = { kind: 'invalid' } as const;

/** The flow class of a row as romlift reads it: half a bl is invalid. */
export function flowClassOf(spec: InsnSpec): FlowClass {
  return spec.flow === 'bl-prefix' || spec.flow === 'bl-suffix' ? 'invalid' : spec.flow;
}

/** The package's `decode`, with a lone bl half's flow `invalid`. */
export function decode(mode: Mode, word: number, addr: Addr): Insn {
  const insn = isaDecode(mode, word, addr);
  return insn.specId === 'thumb.bl_prefix' || insn.specId === 'thumb.bl_suffix' ? { ...insn, flow: INVALID } : insn;
}

/** The reason a row gives for these fields alone, before any round trip, with romlift's reasons; null when it prints. */
export function encodingReason(insn: Insn): RawReason | null {
  const reason = specOf(insn.specId).raw?.(insn.fields) ?? null;
  return reason === null ? null : toRomliftReason(reason);
}

/** The package's `rawReason`, with romlift's reasons. */
export function rawReason(insn: Insn, resolver: SymbolResolver): RawReason | null {
  const reason = isaRawReason(insn, resolver);
  return reason === null ? null : toRomliftReason(reason);
}

/** The package's `printing`, with romlift's reasons. */
export function printing(insn: Insn, resolver: SymbolResolver): Printing {
  const result = isaPrinting(insn, resolver);
  return result.kind === 'raw' ? { kind: 'raw', reason: toRomliftReason(result.reason) } : result;
}

/** r0-r3 and r12: what a callee may change besides lr. */
const CALL_CLOBBERS = 0b0001_0000_0000_1111;
/** r0-r3: what a BIOS call may change. */
const SWI_CLOBBERS = 0b1111;
const NONE: RegisterEffect = { writes: 0, from: [] };
/** The Thumb rows whose effect the analysis does not read: half a bl, and the writes to pc through add and mov. */
const UNREAD: ReadonlySet<string> = new Set(['thumb.bl_prefix', 'thumb.bl_suffix', 'thumb.add_pc', 'thumb.mov_pc']);

/** What an instruction writes, a call's clobbers included. */
export function registerEffect(insn: Insn): RegisterEffect {
  if (UNREAD.has(insn.specId)) return NONE;
  const effect = isaRegisterEffect(insn);
  if (insn.flow.kind === 'call') return { writes: effect.writes | CALL_CLOBBERS, from: effect.from };
  if (insn.flow.kind === 'interrupt') return { writes: effect.writes | SWI_CLOBBERS, from: effect.from };
  return effect;
}
