// seed.ram-copy (D60 e): code that is copied from the ROM to IWRAM before it runs, found at its load
// address. Accepted Thumb code that calls a copy names [S, S + L) as the load image of code that runs at
// D, where the copy is recognised by what the callee does, never by a fixed argument order:
//
//   - a BIOS copy (foundation/rom/bios.ts): an inline `swi 0x0B` (CpuSet) or `swi 0x0C` (CpuFastSet), or a
//     `bl` to a library stub that is one followed by a return; r0 is the source, r1 the destination and
//     r2 the control word, whose count and unit give L (a fill copies nothing);
//   - a copy loop: a `bl` to Thumb code that loads through a register derived from one argument register
//     and stores through a register derived from another (the source and the destination, whatever
//     their order: a copy(source, dest, size) and memcpy(dest, src, n) alike). The third argument is the
//     size: in bytes when it is added to a copy pointer (the loop then runs to that end pointer); the end
//     itself when a copy pointer is compared with it (`cmp`), the size then end - that pointer's argument;
//     else the store width over the amount it is decremented by each iteration, in bytes per unit; any
//     other shape declines.
//
// S, D and L are the argument values in the straight-line run of at most `ramCopy.argInsns` instructions
// before the call (the profile), which stops at a join point (the reading's entry, a branch or jump-table
// target, the target of any of its `bl`s: returning, noreturn or far) and at an instruction that does not
// fall into the next (an unconditional exit, a far or noreturn `bl`; only ever right before a join):
// pool literals, `movs`, register copies, `adds`/`subs` with an immediate or a register, `negs`, `ands`,
// `orrs` and shifts of known values. D lies in IWRAM and [D, D + L) fits in it (the memory map's 32 KiB), and [S, S + L) in
// the ROM. An IWRAM pointer P in (D, D + L) that accepted code loads from its pool and jumps through
// (`bx`, `mov pc`, or `bl` to a `bx rN` stub of the same register, libgcc's `_call_via_rN`) names the
// entry S + (P - D) of that image: Thumb when P is odd, ARM otherwise. A pointer equal to D names the
// start of the block, which the copy itself already names: it is no evidence of an entry the gap scan
// cannot reach once the block is inside the code, so it proposes nothing.
//
// An entry inside the block opens a function only when the instruction before it is an unconditional
// exit, or the word before it is a literal pool (claimed as one, or a pool of the reading of another entry
// the accepted jumps name in the block): a pointer into code that falls through names a second entry,
// which the code before it holds.
//
// The rule is a queue rule and keeps no state: when the copying function is accepted it maps the jumps
// of every accepted function; when a function that jumps through an IWRAM pointer is accepted it maps
// that jump against the copies of every accepted function; each pair is proposed when the later of the
// two is accepted. Targets are proposed ascending, and a target inside the code of a lower one is not
// proposed (the validity a trusted queue skips); a claimed target, an ARM target that does not decode or
// never returns, and an invalid Thumb target are not proposed either.
import { isConditional, pcOf, popcount, thumbAlignedPc } from '@match-kit/isa/armv4t';
import type { Insn } from '@match-kit/isa/armv4t';

import { decode, registerEffect } from '../../../../foundation/isa.ts';
import { BIOS_COPY_ARGS, biosCopyBytes, isBiosCopy } from '../../../../foundation/rom/bios.ts';
import { MEMORY_REGIONS, regionOf } from '../../../../foundation/rom/memory-map.ts';
import { thumbWordAt } from '../../../../foundation/rom/rom.ts';
import { contains, u16, u32 } from '../../../../foundation/rom/rom.ts';
import type { Addr, Mode } from '../../../../foundation/rom/span.ts';
import { insnAligned, insnUnit } from '../../../../foundation/rom/span.ts';
import { compareNumbers, sortedKeys } from '../../../../foundation/util/sorted.ts';
import type { AnalysisView, Proposal, Reading } from '../../types.ts';
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

/** One copy of a code block from the ROM to IWRAM, by a call of the accepted function `by`. */
interface Copy {
  readonly by: Addr;
  readonly source: Addr;
  readonly dest: Addr;
  readonly bytes: number;
}

/** One jump of an accepted function through an IWRAM pointer it loads from its pool. */
interface Jump {
  readonly by: Addr;
  readonly pointer: number;
}

/** How a call copies: the argument registers of the source and the destination, and its size in bytes from the argument values. */
interface CopyCall {
  readonly source: number;
  readonly dest: number;
  bytes(args: readonly (number | undefined)[]): number | undefined;
}

const IWRAM = MEMORY_REGIONS.find((r) => r.name === 'iwram');

function inIwram(a: number): boolean {
  return regionOf(a)?.name === 'iwram';
}

// Raw-bit pre-filters for the instructions the rule looks for, so a reading's other instructions are never
// decoded (the rule reads only the instructions it needs).
/** Thumb `ldr rd, [pc, #imm]` (format 6). */
const THUMB_LDR_PC = { mask: 0xf800, match: 0x4800 } as const;
/** ARM `ldr rd, [pc, #±imm]`: a word load, pre-indexed, base pc, no writeback, any condition. */
const ARM_LDR_PC = { mask: 0x0f7f0000, match: 0x051f0000 } as const;
/** The U bit of an ARM single data transfer: the offset is added. */
const ARM_OFFSET_UP = 0x0080_0000;
/** Thumb `bx rm`, `mov pc, rm`, and the first half of a `bl`: what can end a jump search. */
const THUMB_BX = { mask: 0xff87, match: 0x4700 } as const;
const THUMB_MOV_PC = { mask: 0xff87, match: 0x4687 } as const;
const THUMB_BL_PREFIX = { mask: 0xf800, match: 0xf000 } as const;
/** Thumb `swi imm8`. */
const THUMB_SWI = { mask: 0xff00, match: 0xdf00 } as const;

function matches(bits: number, p: { readonly mask: number; readonly match: number }): boolean {
  return (bits & p.mask) >>> 0 === p.match;
}

/** The instruction of reading `r` at `a` (one of its instructions), decoded. */
function insnAt(r: Reading, a: Addr, v: AnalysisView): Insn {
  return decodedAt(a, r.mode, v);
}

/** The instruction at `a` in `mode`, decoded from the ROM. */
function decodedAt(a: Addr, mode: Mode, v: AnalysisView): Insn {
  return mode === 'arm' ? decode('arm', u32(v.rom, a), a) : decode('thumb', thumbWordAt(v.rom, a), a);
}

/** The instruction of `r` that ends at `a` (the one laid out right before it), or undefined. */
function previous(r: Reading, a: Addr): Addr | undefined {
  if (r.mode === 'arm') return r.insnAt.get(a - 4) === 4 ? a - 4 : undefined;
  if (r.insnAt.get(a - 2) === 2) return a - 2;
  return r.insnAt.get(a - 4) === 4 ? a - 4 : undefined;
}

/**
 * The straight-line run of at most `window` instructions that control passes through on every path to
 * `at`, nearest first: it stops before a join point, an instruction control can reach other than from the
 * one laid out before it, where the registers may hold other values: the reading's entry, a branch or
 * jump-table target, or the target of any `bl` of the reading (a call that returns, one that never
 * returns, or one walked as a jump: each enters its target with the caller's registers). Code before a
 * join never flows into `at` unchanged on every path, so it says nothing about the registers there
 * (overfitting-r2-1, overfitting-correctness-r1-1).
 *
 * It also stops at an instruction laid out before it that does not fall through into it (an unconditional
 * exit: a return, a register jump, `mov lr, pc; bx rN` included, a branch, or a `bl` the reading walked as
 * a jump or that never returns). With every join above, such an instruction can lie right before an
 * instruction of the reading only when that instruction is itself a join, so this stop decides nothing
 * on the readings the walk records; it is kept for a way into the code the reading does not record as a
 * target, and no unit case can make it decide alone.
 */
function straightLineBefore(r: Reading, at: Addr, window: number, v: AnalysisView): Addr[] {
  const jumps = new Set<Addr>([...r.far, ...r.noret]);
  const joins = new Set<Addr>([r.entry, ...r.branchTargets]);
  for (const t of r.tables) for (const target of t.targets) joins.add(target & ~1);
  // A `bl` walked as a call (one that never returns included) is in blSites with its target; a far `bl` is
  // walked as a jump and never recorded there, so its target comes from the instruction itself.
  for (const b of r.blSites) joins.add(b.target);
  for (const site of r.far) {
    const flow = insnAt(r, site, v).flow;
    if (flow.kind === 'call') joins.add(flow.target);
  }
  const run: Addr[] = [];
  for (let cur = at; run.length < window && !joins.has(cur); ) {
    const a = previous(r, cur);
    if (a === undefined || jumps.has(a) || exits(insnAt(r, a, v))) break;
    run.push(a);
    cur = a;
  }
  return run;
}

/** The instruction of `r` right after the one at `a` in the straight line, or undefined. */
function following(r: Reading, a: Addr): Addr | undefined {
  const len = r.insnAt.get(a);
  return len !== undefined && r.insnAt.has(a + len) ? a + len : undefined;
}

/** The literal a Thumb `ldr rd, [pc, #imm]` or ARM `ldr rd, [pc, #±imm]` at `a` loads, from the raw bits; undefined for anything else. */
function pcLoadLiteral(a: Addr, mode: Mode, v: AnalysisView): Addr | undefined {
  if (mode === 'thumb') {
    const h = u16(v.rom, a);
    return matches(h, THUMB_LDR_PC) ? thumbAlignedPc(a) + (h & 0xff) * 4 : undefined;
  }
  const w = u32(v.rom, a);
  if (!matches(w, ARM_LDR_PC)) return undefined;
  const off = w & 0xfff;
  return pcOf(a, 'arm') + ((w & ARM_OFFSET_UP) !== 0 ? off : -off);
}

/** Rows that copy one register into another unchanged. */
function movedFrom(insn: Insn): number | undefined {
  const plain =
    insn.specId === 'thumb.movs_reg' ||
    insn.specId === 'thumb.mov_hi' ||
    (insn.specId === 'thumb.add_imm3' && insn.fields['imm'] === 0);
  const from = registerEffect(insn).from;
  return plain && from.length === 1 ? from[0] : undefined;
}

/** The single register a row writes, or undefined. */
function writtenRegister(insn: Insn): number | undefined {
  const w = registerEffect(insn).writes;
  return w !== 0 && (w & (w - 1)) === 0 ? 31 - Math.clz32(w) : undefined;
}

/** The value a Thumb row computes into the one register it writes, from known register values; undefined otherwise. */
function computed(insn: Insn, regs: readonly (number | undefined)[]): number | undefined {
  const f = insn.fields;
  const reg = (name: string): number | undefined => regs[f[name] ?? 16];
  const both = (
    x: number | undefined,
    y: number | undefined,
    op: (a: number, b: number) => number,
  ): number | undefined => (x === undefined || y === undefined ? undefined : op(x, y) >>> 0);
  switch (insn.specId) {
    case 'thumb.mov_imm':
      return f['imm'];
    case 'thumb.add_imm3':
      return both(reg('rn'), f['imm'], (a, b) => a + b);
    case 'thumb.sub_imm3':
      return both(reg('rn'), f['imm'], (a, b) => a - b);
    case 'thumb.add_imm8':
      return both(reg('rd'), f['imm'], (a, b) => a + b);
    case 'thumb.sub_imm8':
      return both(reg('rd'), f['imm'], (a, b) => a - b);
    case 'thumb.add_reg':
      return both(reg('rn'), reg('rm'), (a, b) => a + b);
    case 'thumb.sub_reg':
      return both(reg('rn'), reg('rm'), (a, b) => a - b);
    case 'thumb.neg':
      return both(0, reg('rm'), (a, b) => a - b);
    case 'thumb.and':
      return both(reg('rd'), reg('rm'), (a, b) => a & b);
    case 'thumb.orr':
      return both(reg('rd'), reg('rm'), (a, b) => a | b);
    case 'thumb.lsl_imm':
      return both(reg('rm'), f['imm'], (a, b) => a << b);
    case 'thumb.lsr_imm':
      return both(reg('rm'), f['imm5'] === 0 ? 32 : f['imm5'], (a, b) => (b >= 32 ? 0 : a >>> b));
    default:
      return undefined;
  }
}

/**
 * The constant values of r0..r15 after the straight-line run `run` (straightLineBefore, nearest first):
 * pool literals, register copies and the arithmetic of `computed`; any other write (a call's included:
 * r0..r3, r12 and lr) forgets the register.
 */
function constantsAlong(r: Reading, run: readonly Addr[], v: AnalysisView): (number | undefined)[] {
  const regs: (number | undefined)[] = new Array<number | undefined>(16).fill(undefined);
  for (const a of [...run].reverse()) {
    const insn = insnAt(r, a, v);
    const f = insn.flow;
    if (f.kind === 'pool-load') {
      regs[f.rd] = contains(v.rom, f.pool, 4) ? u32(v.rom, f.pool) : undefined;
      continue;
    }
    const rd = writtenRegister(insn);
    const from = movedFrom(insn);
    const value = rd === undefined ? undefined : from !== undefined ? regs[from] : computed(insn, regs);
    const writes = registerEffect(insn).writes;
    for (let k = 0; k < 16; k++) if ((writes & (1 << k)) !== 0) regs[k] = undefined;
    if (rd !== undefined) regs[rd] = value;
  }
  return regs;
}

/** A BIOS copy call by number: the BIOS's argument registers, the bytes from its control word; undefined for another number. */
function biosCall(swi: number): CopyCall | undefined {
  if (!isBiosCopy(swi)) return undefined;
  return {
    source: BIOS_COPY_ARGS.source,
    dest: BIOS_COPY_ARGS.dest,
    bytes: (args) => {
      const control = args[BIOS_COPY_ARGS.control];
      return control === undefined ? undefined : biosCopyBytes(swi, control);
    },
  };
}

/** The number of a Thumb `swi` of a BIOS copy call at `a`, from the raw halfword; undefined for anything else. */
function biosSwiAt(a: Addr, v: AnalysisView): number | undefined {
  if (!contains(v.rom, a, 2)) return undefined;
  const h = u16(v.rom, a);
  return matches(h, THUMB_SWI) && biosCall(h & 0xff) !== undefined ? h & 0xff : undefined;
}

const LOADS: ReadonlySet<string> = new Set([
  'thumb.ldr_imm',
  'thumb.ldrb_imm',
  'thumb.ldrh_imm',
  'thumb.ldr_reg',
  'thumb.ldrb_reg',
  'thumb.ldrh_reg',
  'thumb.ldrsb_reg',
  'thumb.ldrsh_reg',
  'thumb.ldmia',
]);
const STORE_WIDTH: ReadonlyMap<string, number> = new Map([
  ['thumb.str_imm', 4],
  ['thumb.str_reg', 4],
  ['thumb.strh_imm', 2],
  ['thumb.strh_reg', 2],
  ['thumb.strb_imm', 1],
  ['thumb.strb_reg', 1],
]);

function pairKey(x: number, y: number): string {
  return `${Math.min(x, y)},${Math.max(x, y)}`;
}

/** The argument (0, 1 or 2) each register holds at an instruction: null when it holds none, or different ones on different paths. */
type Tags = readonly (number | null)[];

/**
 * What one instruction does to the argument tags: a register copy carries its source's tag, a pointer or a
 * count stepped in place (`adds`/`subs rd, #imm`, `subs rd, rn, #imm`, the base of `ldmia`/`stmia`) keeps
 * its tag, and any other write clears the registers it writes.
 */
function transfer(insn: Insn, s: Tags): (number | null)[] {
  const out = [...s];
  const f = insn.fields;
  const rd = f['rd'];
  const base = f['rn'];
  if ((insn.specId === 'thumb.add_imm8' || insn.specId === 'thumb.sub_imm8') && rd !== undefined && s[rd] !== null)
    return out;
  if (insn.specId === 'thumb.sub_imm3' && rd !== undefined && base !== undefined && s[base] !== null) {
    out[rd] = s[base] ?? null;
    return out;
  }
  const from = movedFrom(insn);
  const written = writtenRegister(insn);
  const stepped =
    (insn.specId === 'thumb.ldmia' || insn.specId === 'thumb.stmia') &&
    base !== undefined &&
    ((f['reglist'] ?? 0) & (1 << base)) === 0
      ? base
      : undefined;
  const writes = registerEffect(insn).writes;
  for (let k = 0; k < 16; k++) if ((writes & (1 << k)) !== 0) out[k] = null;
  if (written !== undefined && from !== undefined) out[written] = s[from] ?? null;
  if (stepped !== undefined) out[stepped] = s[stepped] ?? null;
  return out;
}

/** The instructions control reaches from `insn` inside the reading. */
function successors(insn: Insn, r: Reading): Addr[] {
  const next = insn.addr + insn.size;
  const f = insn.flow;
  const out: Addr[] = [];
  if (f.kind === 'branch') {
    out.push(f.target);
    if (f.conditional) out.push(next);
  } else if (
    f.kind === 'next' ||
    f.kind === 'call' ||
    f.kind === 'pool-load' ||
    f.kind === 'adr' ||
    f.kind === 'interrupt'
  )
    out.push(next);
  return out.filter((a) => r.insnAt.has(a));
}

/**
 * The argument tags at each instruction of a Thumb reading, by forward data flow from its entry (r0, r1,
 * r2 hold arguments 0, 1, 2): where two paths disagree on a register, it holds none.
 */
function argumentTags(r: Reading, v: AnalysisView): ReadonlyMap<Addr, { readonly insn: Insn; readonly tags: Tags }> {
  const at = new Map<Addr, { readonly insn: Insn; tags: (number | null)[] }>();
  const entry: (number | null)[] = new Array<number | null>(16).fill(null);
  entry[0] = 0;
  entry[1] = 1;
  entry[2] = 2;
  at.set(r.entry, { insn: insnAt(r, r.entry, v), tags: entry });
  const work: Addr[] = [r.entry];
  while (work.length > 0) {
    const a = work.pop() ?? r.entry;
    const here = at.get(a);
    if (here === undefined) continue;
    const out = transfer(here.insn, here.tags);
    for (const b of successors(here.insn, r)) {
      const there = at.get(b);
      if (there === undefined) {
        at.set(b, { insn: insnAt(r, b, v), tags: [...out] });
        work.push(b);
        continue;
      }
      let changed = false;
      for (let k = 0; k < 16; k++) {
        if (there.tags[k] !== null && there.tags[k] !== out[k]) {
          there.tags[k] = null;
          changed = true;
        }
      }
      if (changed) work.push(b);
    }
  }
  return at;
}

/**
 * How a Thumb callee copies, from what it does with its argument registers r0, r1 and r2 (argumentTags):
 * a load through a base holding an argument marks that argument a source, a store a destination. Exactly
 * one source and one destination, distinct, are needed; the third argument is the size, in bytes when it
 * is added to one of them (an end pointer), else the store width over the one amount it is decremented by.
 * Undefined otherwise.
 */
function loopCall(callee: Reading, v: AnalysisView): CopyCall | undefined {
  if (callee.mode !== 'thumb' || callee.errors.length > 0) return undefined;
  const loads = new Set<number>();
  const stores = new Map<number, number>();
  const steps = new Map<number, Set<number>>();
  const ends = new Set<string>();
  const compares = new Set<string>();
  const step = (arg: number, by: number): void => {
    const set = steps.get(arg) ?? new Set<number>();
    set.add(by);
    steps.set(arg, set);
  };
  const flow = argumentTags(callee, v);
  for (const a of sortedKeys(flow)) {
    const here = flow.get(a);
    if (here === undefined) continue;
    const { insn, tags } = here;
    const f = insn.fields;
    const tagOf = (name: string): number | null => tags[f[name] ?? 16] ?? null;
    const base = tagOf('rn');
    if (LOADS.has(insn.specId) && base !== null) loads.add(base);
    const width = insn.specId === 'thumb.stmia' ? 4 * popcount(f['reglist'] ?? 0) : STORE_WIDTH.get(insn.specId);
    if (width !== undefined && base !== null) stores.set(base, Math.max(width, stores.get(base) ?? 0));
    const counted = insn.specId === 'thumb.sub_imm8' ? tagOf('rd') : insn.specId === 'thumb.sub_imm3' ? base : null;
    if (counted !== null) step(counted, f['imm'] ?? 0);
    if (insn.specId === 'thumb.add_reg' || insn.specId === 'thumb.cmp_reg') {
      const x = tagOf('rn');
      const y = tagOf('rm');
      if (x !== null && y !== null && x !== y) (insn.specId === 'thumb.add_reg' ? ends : compares).add(pairKey(x, y));
    }
  }
  const sources = sortedKeys(loads).filter((a) => !stores.has(a));
  const dests = sortedKeys(stores).filter((a) => !loads.has(a));
  const source = sources.length === 1 ? sources[0] : undefined;
  const dest = dests.length === 1 ? dests[0] : undefined;
  if (source === undefined || dest === undefined) return undefined;
  const size = [0, 1, 2].find((a) => a !== source && a !== dest);
  if (size === undefined) return undefined;
  // The size is in bytes when it is added to a copy pointer (an end pointer is computed from it).
  const counts = (unit: number): CopyCall => ({
    source,
    dest,
    bytes: (args) => {
      const n = args[size];
      return n === undefined ? undefined : n * unit;
    },
  });
  if (ends.has(pairKey(source, size)) || ends.has(pairKey(dest, size))) return counts(1);
  // The size argument is the end itself when a copy pointer is compared with it: L = end - that pointer.
  const from = compares.has(pairKey(dest, size)) ? dest : compares.has(pairKey(source, size)) ? source : undefined;
  if (from !== undefined) {
    return {
      source,
      dest,
      bytes: (args) => {
        const end = args[size];
        const start = args[from];
        return end === undefined || start === undefined ? undefined : (end - start) | 0;
      },
    };
  }
  // Else a count of units, stepped down by one amount: the store width over that amount, in bytes per unit.
  const width = stores.get(dest) ?? 0;
  const by = sortedKeys(steps.get(size) ?? new Set<number>());
  const k = by.length === 1 ? (by[0] ?? 0) : 0;
  return k > 0 && width % k === 0 ? counts(width / k) : undefined;
}

/** How the call to `target` copies: a BIOS stub (the `swi` of a copy call, then a return) or a copy loop. */
function calleeCall(target: Addr, v: AnalysisView): CopyCall | undefined {
  const swi = biosSwiAt(target, v);
  if (swi !== undefined)
    return contains(v.rom, target + 2, 2) && decodedAt(target + 2, 'thumb', v).flow.kind === 'return'
      ? biosCall(swi)
      : undefined;
  return loopCall(v.read(target, 'thumb'), v);
}

/** The copies of a Thumb reading: BIOS copy calls and calls of copy loops whose destination lies in IWRAM. */
function copiesOf(by: Addr, r: Reading, v: AnalysisView): Copy[] {
  if (r.mode !== 'thumb' || IWRAM === undefined) return [];
  const iwram = new Set(r.pools.filter((p) => inIwram(p.value)).map((p) => p.addr));
  if (iwram.size === 0 || !r.pools.some((p) => contains(v.rom, p.value & ~1))) return [];
  const { argInsns } = v.profile.ramCopy;
  const sites: { readonly at: Addr; readonly call: () => CopyCall | undefined }[] = [];
  for (const site of r.blSites) sites.push({ at: site.site, call: () => calleeCall(site.target, v) });
  for (const span of r.insns) {
    const swi = span.len === 2 ? biosSwiAt(span.addr, v) : undefined;
    if (swi !== undefined) sites.push({ at: span.addr, call: () => biosCall(swi) });
  }
  const out: Copy[] = [];
  for (const site of sites.sort((a, b) => compareNumbers(a.at, b.at))) {
    // The destination is an IWRAM pool literal loaded in the window: without one there is nothing to decode.
    const run = straightLineBefore(r, site.at, argInsns, v);
    if (
      !run.some((a) => {
        const literal = pcLoadLiteral(a, 'thumb', v);
        return literal !== undefined && iwram.has(literal);
      })
    )
      continue;
    // Only a call with an IWRAM address, a ROM address and a third known value among r0..r2 can copy code
    // to IWRAM: the callee is read only then.
    const args = constantsAlong(r, run, v);
    const known = [args[0], args[1], args[2]];
    if (
      !known.some((x) => x !== undefined && inIwram(x)) ||
      !known.some((x) => x !== undefined && contains(v.rom, x & ~1)) ||
      known.includes(undefined)
    )
      continue;
    const call = site.call();
    if (call === undefined) continue;
    const source = args[call.source];
    const dest = args[call.dest];
    const bytes = call.bytes(args);
    if (source === undefined || dest === undefined || bytes === undefined) continue;
    const start = source & ~1;
    if (!inIwram(dest) || bytes <= 0 || dest + bytes > IWRAM.start + IWRAM.size || !contains(v.rom, start, bytes))
      continue;
    out.push({ by, source: start, dest, bytes });
  }
  return out;
}

/** The register `bl target` jumps through when the target is a `bx rN` stub (libgcc's `_call_via_rN`). */
function stubRegister(target: Addr, v: AnalysisView): number | undefined {
  if (!contains(v.rom, target, 2)) return undefined;
  const f = decodedAt(target, 'thumb', v).flow;
  return f.kind === 'indirect' && f.via === 'bx' ? f.reg : undefined;
}

/** Thumb `bx rN`, `mov pc, rN` or the first half of a `bl`, from the raw halfword: what can end a jump search. */
function mayJump(h: number): boolean {
  return matches(h, THUMB_BX) || matches(h, THUMB_MOV_PC) || matches(h, THUMB_BL_PREFIX);
}

/** Whether the value loaded into `rd` at `load` is jumped through within `ramCopy.jumpInsns` straight-line instructions. */
function jumpsThrough(r: Reading, load: Addr, rd: number, v: AnalysisView): boolean {
  const { jumpInsns } = v.profile.ramCopy;
  if (r.mode === 'thumb') {
    // Most IWRAM loads address variables: without a jump in the window there is nothing to decode.
    let any = false;
    let steps = 0;
    for (let a = following(r, load); a !== undefined && steps < jumpInsns && !any; a = following(r, a), steps++)
      any = mayJump(u16(v.rom, a));
    if (!any) return false;
  }
  let live = 1 << rd;
  let steps = 0;
  for (let a = following(r, load); a !== undefined && steps < jumpInsns && live !== 0; a = following(r, a), steps++) {
    const x = insnAt(r, a, v);
    const g = x.flow;
    if (g.kind === 'indirect') return (g.via === 'bx' || g.via === 'mov-pc') && (live & (1 << g.reg)) !== 0;
    if (g.kind === 'call') {
      const reg = r.mode === 'thumb' ? stubRegister(g.target, v) : undefined;
      return reg !== undefined && (live & (1 << reg)) !== 0;
    }
    if (g.kind !== 'next' && g.kind !== 'pool-load') return false;
    const written = writtenRegister(x);
    const from = movedFrom(x);
    if (written !== undefined && from !== undefined && (live & (1 << from)) !== 0) live |= 1 << written;
    else live &= ~registerEffect(x).writes;
  }
  return false;
}

/** The IWRAM pointers a reading loads from its pool and jumps through within `ramCopy.jumpInsns` instructions. */
function jumpsOf(by: Addr, r: Reading, v: AnalysisView): Jump[] {
  const iwramPools = new Set(r.pools.filter((p) => inIwram(p.value)).map((p) => p.addr));
  if (iwramPools.size === 0) return [];
  const out: Jump[] = [];
  for (const span of [...r.insns].sort((a, b) => compareNumbers(a.addr, b.addr))) {
    const literal = pcLoadLiteral(span.addr, r.mode, v);
    if (literal === undefined || !iwramPools.has(literal) || !contains(v.rom, literal, 4)) continue;
    const f = insnAt(r, span.addr, v).flow;
    if (f.kind !== 'pool-load') continue;
    if (jumpsThrough(r, span.addr, f.rd, v)) out.push({ by, pointer: u32(v.rom, literal) });
  }
  return out;
}

/** Every copy made by an accepted function. */
function allCopies(v: AnalysisView): Copy[] {
  return v.functions().flatMap((e) => {
    const r = v.accepted(e);
    return r === undefined ? [] : copiesOf(e, r, v);
  });
}

/** Every jump through an IWRAM pointer made by an accepted function. */
function allJumps(v: AnalysisView): Jump[] {
  return v.functions().flatMap((e) => {
    const r = v.accepted(e);
    return r === undefined ? [] : jumpsOf(e, r, v);
  });
}

/** Whether the instruction is an unconditional exit: a return, a register jump or a branch. */
function exits(insn: Insn): boolean {
  const k = insn.flow.kind;
  return !isConditional(insn) && (k === 'return' || k === 'indirect' || k === 'branch');
}

/**
 * Whether `entry` opens a function of the copied block rather than continuing the code before it: it is
 * the block's first byte, the word before it is a literal pool (claimed as one, or by `isPool`: a pool of
 * the reading of another entry named in the block), or the instruction before it (in its mode) is an
 * unconditional exit. A pool word is data, so the instruction it would decode as says nothing. A pointer
 * into the middle of a run of code that falls through (hand-written ARM with several entries) names a
 * second entry, which the function that runs into it already holds; proposing it would split that
 * function at an entry its reading reaches.
 */
function opensFunction(entry: Addr, mode: Mode, copy: Copy, isPool: (word: Addr) => boolean, v: AnalysisView): boolean {
  const size = insnUnit(mode);
  const prev = entry - size;
  if (entry === copy.source || prev < copy.source) return true;
  if (contains(v.rom, prev, size) && exits(decodedAt(prev, mode, v))) return true;
  // A literal pool sits on the profile's pool alignment, so only an entry on it can follow one.
  const word = entry - 4;
  return (
    entry % v.profile.alignment.pool === 0 && word >= copy.source && (v.claimAt(word) === Claim.pool || isPool(word))
  );
}

/** The entry a jump names in a copied block, and its mode; undefined when it names none. */
function namedEntry(copy: Copy, jump: Jump): { readonly entry: Addr; readonly mode: Mode } | undefined {
  const run = jump.pointer & ~1;
  if (run <= copy.dest || run >= copy.dest + copy.bytes) return undefined;
  const mode: Mode = insnAligned('thumb', jump.pointer) ? 'arm' : 'thumb';
  const entry = copy.source + (run - copy.dest);
  if (mode === 'arm' && !insnAligned('arm', entry)) return undefined;
  return { entry, mode };
}

/** Whether the code at `entry` reads as a function: an ARM reading that decodes and returns, or a valid Thumb entry. */
function readsAsFunction(entry: Addr, mode: Mode, v: AnalysisView): boolean {
  if (mode === 'thumb') return v.valid(entry);
  const r = v.read(entry, 'arm');
  return r.insns.length > 0 && r.errors.length === 0 && r.returns > 0;
}

export default defineRule({
  meta: {
    id: 'seed.ram-copy',
    summary:
      'the entries of a code block copied from the ROM to IWRAM, at the load addresses of the IWRAM pointers accepted code jumps through',
    restsOn:
      'code that runs from IWRAM is copied there from its load image in the ROM by a call naming the source, the destination and the size (a BIOS CpuSet or CpuFastSet, or a routine that loads through one argument and stores through another), and the rest of the program reaches it only by jumping through its IWRAM addresses',
    recovers:
      'functions that run from IWRAM, linked at their load address, which no ROM address names (past the code end, or between unreferenced data)',
    reads: ['function-set', 'readings', 'rom', 'claims', 'validity'],
    adds: ['candidates'],
    origin: 'ram-copy',
  },
  kind: 'queue',
  queue(f, v) {
    const r = v.accepted(f.entry);
    if (r === undefined) return [];
    const own = copiesOf(f.entry, r, v);
    const jumps = jumpsOf(f.entry, r, v);
    if (own.length === 0 && jumps.length === 0) return [];
    // Every accepted jump, computed at most once per call: for the copies of `f`, and for the pool test.
    let every: readonly Jump[] | undefined;
    const everyJump = (): readonly Jump[] => (every ??= allJumps(v));
    const pairs: [Copy, Jump][] = [];
    if (own.length > 0) for (const j of everyJump()) for (const c of own) pairs.push([c, j]);
    if (jumps.length > 0) for (const c of allCopies(v)) if (c.by !== f.entry) for (const j of jumps) pairs.push([c, j]);
    const named = new Map<Addr, { readonly mode: Mode; readonly copy: Copy; readonly cites: readonly Addr[] }>();
    for (const [c, j] of pairs) {
      const e = namedEntry(c, j);
      if (e !== undefined && !named.has(e.entry)) named.set(e.entry, { mode: e.mode, copy: c, cites: [j.by, c.by] });
    }
    const out: Proposal[] = [];
    // The instructions of the entries proposed so far, ascending: a higher entry inside them is not proposed.
    const covered = new Set<Addr>();
    // The pool words of the readings of every entry the accepted jumps name in a copy, read only when an
    // entry follows no exit (each pair is proposed in its own call, so the entry whose pool it is may not
    // be accepted, and its pool not claimed, yet).
    const poolsOf = new Map<Copy, Set<Addr>>();
    const isPoolOf =
      (copy: Copy) =>
      (word: Addr): boolean => {
        let pools = poolsOf.get(copy);
        if (pools === undefined) {
          pools = new Set<Addr>();
          for (const j of everyJump()) {
            const e = namedEntry(copy, j);
            if (e !== undefined) for (const q of v.read(e.entry, e.mode).pools) pools.add(q.addr);
          }
          poolsOf.set(copy, pools);
        }
        return pools.has(word);
      };
    for (const entry of sortedKeys(named)) {
      const p = named.get(entry);
      if (p === undefined || covered.has(entry) || v.isFunction(entry) || v.claimAt(entry) !== Claim.free) continue;
      if (!opensFunction(entry, p.mode, p.copy, isPoolOf(p.copy), v) || !readsAsFunction(entry, p.mode, v)) continue;
      out.push({ entry, mode: p.mode, cites: p.cites });
      for (const i of v.read(entry, p.mode).insns) if (i.addr !== entry) covered.add(i.addr);
    }
    return out;
  },
});
