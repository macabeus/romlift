// What the sig.* placement rules share (architecture §7.2): one library version's decoded members, their link-order
// chains and candidates, the placements made so far, and the byte tests every rule reads (the PoC's fits, wordDiffs
// and pointersAgree, romlift-poc/src/signatures/apply.ts). match.ts builds a VersionState per library version and runs
// the rules over it; a rule changes the state only through `placeMember`. Internal to core/signatures: the public
// result is the SignaturePlacement of schema.ts.
import { peek32 } from '../../../foundation/rom/rom.ts';
import { le32 } from '../../../foundation/util/bytes.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import type { Addr, Mode } from '../../../foundation/rom/span.ts';
import type { RuleMeta } from '../../provenance/rule-id.ts';
import type { SignaturePolicy } from '../policy.ts';
import type { MemberId, SignaturePlacement, SignatureRuleId } from '../schema.ts';

/** A member of one library version, decoded for matching. */
export interface Member {
  /** Its position in the version: the functions in file order, then the tables. */
  readonly index: number;
  readonly id: MemberId;
  readonly name: string;
  readonly kind: 'function' | 'table';
  /** Functions only. */
  readonly mode?: Mode;
  readonly size: number;
  readonly bytes: Uint8Array;
  readonly mask: Uint8Array;
  /** 2 for Thumb functions, 4 for ARM ones; tables 4, or 2 when a reference placed them off a word. */
  readonly align: 2 | 4;
  /** The bytes whose mask is 0xFF. */
  readonly unmasked: number;
  /** The offset of the first fully unmasked 4-byte word at a halfword offset, or -1. */
  readonly anchor: number;
  /** An anchor exists and unmasked >= policy.minUnmaskedBytes: the member may be searched for alone. */
  readonly free: boolean;
  /**
   * Another member of the version has the same kind, mode, size, mask and unmasked bytes (two wrappers that differ
   * only in the call the link fixes, as libc's sprintf and siprintf): the bytes at a place cannot say which of them
   * it holds, so only a rule that reads a reference's link order may place it (D123).
   */
  readonly twin: boolean;
  /** Tables: per whole aligned word, the member a pointer names, or null. */
  readonly names?: readonly (MemberId | null)[];
  /** Where it fits on the ROM, ascending, at most policy.candidateCap; filled once by the scan. */
  readonly candidates: readonly Addr[];
}

/** A member in one reference's link order, at its address in that reference. */
export interface ChainLink {
  readonly member: Member;
  readonly refAddr: Addr;
}

/** One reference's members of one kind, in reference address order: spacing only holds within one chain. */
export interface Chain {
  readonly reference: string;
  readonly kind: 'function' | 'table';
  readonly links: readonly ChainLink[];
}

/** Where a member was placed, by which rule, and the words it differs in (sig.pinned-both-sides only). */
export interface Placed {
  readonly addr: Addr;
  readonly rule: SignatureRuleId;
  readonly constants?: SignaturePlacement['constants'];
}

/** One library version under matching. */
export interface VersionState {
  readonly rom: Rom;
  readonly policy: SignaturePolicy;
  readonly library: string;
  readonly version: string;
  readonly members: readonly Member[];
  readonly chains: readonly Chain[];
  /** Member ids to members (the first of a repeated id). */
  readonly byId: ReadonlyMap<MemberId, Member>;
  /** Member index to its placement; written only by placeMember. */
  readonly placed: Map<number, Placed>;
  /** Member index to the first address where it fitted but its pointers named other addresses. */
  readonly refusals: Map<number, Addr>;
}

/** How a rule visits the members of its stage (policy.ts, SignatureStage): every rule of a stage shares one. */
export type SignatureSweep = 'largest-first' | 'listed' | 'chains' | 'chain-member';

interface RuleBase {
  readonly meta: RuleMeta & { readonly id: SignatureRuleId };
}

/** A rule that decides one member at a time: 'largest-first' visits them by size, 'listed' in version order. */
export interface MemberRule extends RuleBase {
  readonly sweep: 'largest-first' | 'listed';
  place(state: VersionState, member: Member): boolean;
}

/**
 * A rule that decides every chain of the version at once (`state.chains`): what one reference's link order proves
 * is weighed against what another's does before anything is placed.
 */
export interface ChainRule extends RuleBase {
  readonly sweep: 'chains';
  place(state: VersionState): boolean;
}

/** A rule that decides the unplaced member at `index` of a chain, reading its placed neighbours there. */
export interface ChainMemberRule extends RuleBase {
  readonly sweep: 'chain-member';
  place(state: VersionState, chain: Chain, index: number): boolean;
}

export type SignatureRule = MemberRule | ChainRule | ChainMemberRule;

/** Whether `member` lies inside the ROM at `addr`, aligned. */
function inRom(rom: Rom, member: Member, addr: Addr): boolean {
  const off = addr - rom.base;
  return Number.isInteger(addr) && off >= 0 && off + member.size <= rom.bytes.length && addr % member.align === 0;
}

/** Whether every unmasked bit of `member` equals the ROM at `addr` (the PoC's fits). */
export function fits(rom: Rom, member: Member, addr: Addr): boolean {
  if (!inRom(rom, member, addr)) return false;
  const off = addr - rom.base;
  const b = rom.bytes;
  const { bytes, mask } = member;
  for (let i = 0; i < bytes.length; i++) {
    const m = mask[i] ?? 0;
    if (m !== 0 && (((b[off + i] ?? 0) ^ (bytes[i] ?? 0)) & m) !== 0) return false;
  }
  return true;
}

/**
 * The 4-byte words of `member` (from its start) at which it does not fit at `addr`, with the reference's and the
 * ROM's word; undefined when it lies outside the ROM, is misaligned, or differs in more than `max` words (the PoC's
 * wordDiffs).
 */
export function wordDiffs(rom: Rom, member: Member, addr: Addr, max: number): NonNullable<SignaturePlacement['constants']> | undefined {
  if (!inRom(rom, member, addr)) return undefined;
  const off = addr - rom.base;
  const b = rom.bytes;
  const { bytes, mask } = member;
  const out: { offset: number; reference: number; rom: number }[] = [];
  for (let w = 0; w < bytes.length; w += 4) {
    let differs = false;
    for (let i = w; i < Math.min(w + 4, bytes.length); i++) {
      const m = mask[i] ?? 0;
      if (m !== 0 && (((b[off + i] ?? 0) ^ (bytes[i] ?? 0)) & m) !== 0) differs = true;
    }
    if (!differs) continue;
    if (out.length === max) return undefined;
    out.push({ offset: w, reference: le32(bytes, w), rom: le32(b, off + w) });
  }
  return out;
}

/** Where `member` was placed, if it was. */
export function placedAt(state: VersionState, member: Member): Addr | undefined {
  return state.placed.get(member.index)?.addr;
}

/**
 * Whether every word of a table at `addr` that names a placed function of this version holds that function's
 * address (with the Thumb bit for a Thumb function); always true for a function or a table without names. A refusal
 * is remembered (W_SIGNATURE_POINTERS when the table stays unplaced).
 */
export function pointersAgree(state: VersionState, member: Member, addr: Addr): boolean {
  const names = member.names;
  if (names === undefined) return true;
  for (let i = 0; i < names.length; i++) {
    const id = names[i];
    if (id === null || id === undefined) continue;
    const target = state.byId.get(id);
    if (target === undefined || target.kind !== 'function') continue;
    const at = placedAt(state, target);
    if (at === undefined) continue;
    if (peek32(state.rom, addr + 4 * i) !== at + (target.mode === 'thumb' ? 1 : 0)) {
      if (!state.refusals.has(member.index)) state.refusals.set(member.index, addr);
      return false;
    }
  }
  return true;
}

/** The object a member id names: `name@object.o` -> `object.o`. */
export function objectOf(id: MemberId): string {
  return id.slice(id.indexOf('@') + 1);
}

/**
 * Whether `member` at `addr` would share a byte with another member of this version already placed: a library's
 * members are linked side by side, so two of them never hold the same byte (two members of different references with
 * the same code, such as one SDK's `DivRem` and another's `Mod`, both fit there, and only one is placed).
 */
export function overlapsPlaced(state: VersionState, member: Member, addr: Addr): boolean {
  const end = addr + member.size;
  for (const other of state.members) {
    if (other.index === member.index) continue;
    const p = state.placed.get(other.index);
    if (p !== undefined && addr < p.addr + other.size && p.addr < end) return true;
  }
  return false;
}

/**
 * Whether fitting at `addr` says anything: a member with an unmasked byte fits only where those bytes are, but one
 * whose every byte is masked (a table of pointers) fits anywhere, so it needs a word that names a placed function of
 * this version and holds that function's address there.
 */
export function evidenced(state: VersionState, member: Member, addr: Addr): boolean {
  if (member.unmasked > 0) return true;
  const names = member.names ?? [];
  for (let i = 0; i < names.length; i++) {
    const id = names[i];
    if (id === null || id === undefined) continue;
    const target = state.byId.get(id);
    if (target === undefined || target.kind !== 'function') continue;
    const at = placedAt(state, target);
    if (at !== undefined && peek32(state.rom, addr + 4 * i) === at + (target.mode === 'thumb' ? 1 : 0)) return true;
  }
  return false;
}

/** Records that `rule` placed `member` at `addr`. */
export function placeMember(state: VersionState, member: Member, addr: Addr, rule: SignatureRuleId, constants?: Placed['constants']): void {
  state.placed.set(member.index, constants === undefined ? { addr, rule } : { addr, rule, constants });
}

/** The nearest placed links before and after `index` in a chain. */
export function placedNeighbours(state: VersionState, chain: Chain, index: number): { readonly prev?: ChainLink; readonly next?: ChainLink } {
  let prev: ChainLink | undefined;
  let next: ChainLink | undefined;
  for (let j = index - 1; j >= 0 && prev === undefined; j--) {
    const link = chain.links[j];
    if (link !== undefined && state.placed.has(link.member.index)) prev = link;
  }
  for (let j = index + 1; j < chain.links.length && next === undefined; j++) {
    const link = chain.links[j];
    if (link !== undefined && state.placed.has(link.member.index)) next = link;
  }
  return { ...(prev === undefined ? {} : { prev }), ...(next === undefined ? {} : { next }) };
}
