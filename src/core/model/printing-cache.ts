// The printing rule (foundation/isa roundtrip's rawReason, architecture §5, D14) with the caches the model
// builds its items through. Two of them, and only the first is shared with the re-encode check:
//
// - addressFreeReasons: an instruction whose text names no address (no pc-relative field, a flow that names no
//   target, not a mode switch) prints the same text wherever it is, so its row and answer are those of its mode
//   and exact word. The key is the word itself, so the cache can change no answer.
// - printingCache, the model's: addressFreeReasons, plus a key derived from the word for instructions naming a
//   label of the default spelling (below). Its equivalence is proven on the fixtures (items.test.ts), not by
//   construction, so the re-encode check (core/verify/reencode.ts) never uses it: it runs the round trip itself
//   for every instruction that names an address.
import { specOf } from '@match-kit/isa/armv4t';
import type { Flow, Insn, SpecId, SymbolResolver } from '@match-kit/isa/armv4t';

import { rawReason } from '../../foundation/isa.ts';
import type { RawReason } from '../../foundation/isa.ts';
import type { Addr, Mode } from '../../foundation/rom/span.ts';
import { isDefaultSpelling } from '../../foundation/util/project-files.ts';

/** Per isa row: the bits of its word that hold a pc-relative offset (pc-rel and bl-off fields), 0 for none. */
const OFFSET_MASK = new Map<SpecId, number>();

function offsetMask(id: SpecId): number {
  let mask = OFFSET_MASK.get(id);
  if (mask === undefined) {
    mask = 0;
    for (const f of specOf(id).fields)
      if (f.kind === 'pc-rel' || f.kind === 'bl-off') mask |= ((2 ** f.width - 1) * 2 ** f.lo) >>> 0;
    mask >>>= 0;
    OFFSET_MASK.set(id, mask);
  }
  return mask;
}

/** The one address an instruction's text names, if any. */
export function targetOf(flow: Flow): Addr | undefined {
  switch (flow.kind) {
    case 'branch':
    case 'call':
    case 'adr':
      return flow.target;
    case 'pool-load':
      return flow.pool;
    default:
      return undefined;
  }
}

/** What the printing rule decided for an instruction whose text names no address. */
export interface KnownPrinting {
  readonly specId: SpecId;
  readonly reason: RawReason | null;
}

/** Whether an instruction's text names no address, so it prints alike at every address (see the header). */
export function namesNoAddress(insn: Insn): boolean {
  return targetOf(insn.flow) === undefined && offsetMask(insn.specId) === 0 && insn.flow.kind !== 'mode-switch';
}

/** The printing rule over instructions that name no address, cached by mode and exact word. */
export interface AddressFreeReasons {
  /** The cached row and answer of a word, if one was computed. */
  known(mode: Mode, word: number): KnownPrinting | undefined;
  /** rawReason of an instruction that names no address (namesNoAddress), through the cache. */
  reasonOf(insn: Insn, resolver: SymbolResolver): RawReason | null;
}

export function addressFreeReasons(): AddressFreeReasons {
  const free: Record<Mode, Map<number, KnownPrinting>> = { thumb: new Map(), arm: new Map() };
  return {
    known: (mode, word) => free[mode].get(word),
    reasonOf(insn, resolver) {
      const hit = free[insn.mode].get(insn.word);
      if (hit !== undefined) return hit.reason;
      const reason = rawReason(insn, resolver);
      free[insn.mode].set(insn.word, { specId: insn.specId, reason });
      return reason;
    },
  };
}

/**
 * The printing rule (rawReason) with a cache that changes no answer.
 *
 * - An instruction whose text names no address (no pc-relative field, a flow that names no target) prints the
 *   same text wherever it is, so its row and answer are those of its mode and word (`known`, which lets the
 *   caller skip the decode).
 * - One whose text names a label prints the word's text with the label in place of the offset. When the label
 *   has a default spelling (`_`, `sub_`, `unk_` or `gUnk_` plus eight hex digits, which the parser reads alike)
 *   and resolves back to the target, the round trip assembles the word's own offset again, so the answer is
 *   that of its mode, its word without the offset bits, its word alignment and whether the offset is zero (an
 *   ARM `[pc, #-0]` does not come back).
 * - Anything else runs the round trip itself.
 */
export interface PrintingCache {
  known(mode: Mode, word: number): KnownPrinting | undefined;
  reasonOf(insn: Insn, resolver: SymbolResolver): RawReason | null;
  /**
   * reasonOf for an instruction that names `target`, known by its row, word and run address: `insn` decodes it
   * when the round trip has to run.
   */
  reasonOfNaming(
    mode: Mode,
    specId: SpecId,
    word: number,
    addr: Addr,
    target: Addr,
    resolver: SymbolResolver,
    insn: () => Insn,
  ): RawReason | null;
}

export function printingCache(): PrintingCache {
  const free = addressFreeReasons();
  const labelled: Record<Mode, Map<number, RawReason | null>> = { thumb: new Map(), arm: new Map() };
  const reasonOfNaming: PrintingCache['reasonOfNaming'] = (mode, specId, word, addr, target, resolver, insn) => {
    const name = resolver.labelFor(target, addr);
    if (name === undefined || !isDefaultSpelling(name) || resolver.addressOf(name) !== target)
      return rawReason(insn(), resolver);
    const mask = offsetMask(specId);
    const key = ((word & ~mask) >>> 0) * 8 + (addr & 3) * 2 + ((word & mask) === 0 ? 1 : 0);
    const hit = labelled[mode].get(key);
    if (hit !== undefined) return hit;
    const reason = rawReason(insn(), resolver);
    labelled[mode].set(key, reason);
    return reason;
  };
  return {
    known: free.known,
    reasonOfNaming,
    reasonOf(insn, resolver) {
      const target = targetOf(insn.flow);
      if (target !== undefined)
        return reasonOfNaming(insn.mode, insn.specId, insn.word, insn.addr, target, resolver, () => insn);
      if (!namesNoAddress(insn)) return rawReason(insn, resolver);
      return free.reasonOf(insn, resolver);
    },
  };
}
