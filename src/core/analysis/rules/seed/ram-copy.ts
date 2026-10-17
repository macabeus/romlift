// seed.ram-copy (D60 e): code that is copied from the ROM to IWRAM before it runs, found at its load
// address. Accepted Thumb code that calls a routine with a ROM address S in r0, an IWRAM address D in r1
// and a byte count L in r2, each built from pool literals (a memcpy(S, D, L) of its own block), names
// [S, S + L) as the load image of code that runs at D. An IWRAM pointer P in [D, D + L) that accepted
// code loads from its pool and jumps through (`bx`, `mov pc`, or `bl` to a `bx rN` stub of the same
// register, libgcc's `_call_via_rN`) names the entry S + (P - D) of that image: Thumb when P is odd, ARM
// otherwise. A pointer equal to D names the start of the block, which the copy itself already names:
// it is no evidence of an entry the gap scan cannot reach once the block is inside the code, so it
// proposes nothing.
//
// The rule is a queue rule and keeps no state: when the copying function is accepted it maps the jumps
// of every accepted function; when a function that jumps through an IWRAM pointer is accepted it maps
// that jump against the copies of every accepted function; each pair is proposed when the later of the
// two is accepted. Targets are proposed ascending, and a target inside the code of a lower one is not
// proposed (the validity a trusted queue skips); a claimed target, an ARM target that does not decode
// or never returns, and an invalid Thumb target are not proposed either.
import { decode, isConditional, thumbWordAt } from '../../../../foundation/isa/decode.ts';
import { registerEffect } from '../../../../foundation/isa/registers.ts';
import type { Insn } from '../../../../foundation/isa/types.ts';
import { regionOf } from '../../../../foundation/rom/memory-map.ts';
import { contains, u16, u32 } from '../../../../foundation/rom/rom.ts';
import type { Addr, Mode } from '../../../../foundation/rom/span.ts';
import { compareNumbers, sortedKeys } from '../../../../foundation/util/sorted.ts';
import type { AnalysisView, Proposal, Reading } from '../../types.ts';
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

/** One copy of a code block from the ROM to IWRAM, by the call at `site` of the accepted function `by`. */
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

function inIwram(a: number): boolean {
  return regionOf(a)?.name === 'iwram';
}

/** The decoded instructions of a reading, ascending by address. */
function decoded(r: Reading, v: AnalysisView): Insn[] {
  return [...r.insns]
    .sort((a, b) => compareNumbers(a.addr, b.addr))
    .filter((i) => contains(v.rom, i.addr, i.len))
    .map((i) => (r.mode === 'thumb' ? decode('thumb', thumbWordAt(v.rom, i.addr), i.addr) : decode('arm', u32(v.rom, i.addr), i.addr)));
}

/** Rows that copy one register into another unchanged. */
function movedFrom(insn: Insn): number | undefined {
  const plain = insn.specId === 'thumb.movs_reg' || insn.specId === 'thumb.mov_hi' || (insn.specId === 'thumb.add_imm3' && insn.fields['imm'] === 0);
  const from = registerEffect(insn).from;
  return plain && from.length === 1 ? from[0] : undefined;
}

/** The single register a row writes, or undefined. */
function writtenRegister(insn: Insn): number | undefined {
  const w = registerEffect(insn).writes;
  return w !== 0 && (w & (w - 1)) === 0 ? 31 - Math.clz32(w) : undefined;
}

/**
 * The constant values of r0..r15 before `insns[at]`, from the straight-line run of at most `window`
 * instructions before it: pool literals, `movs rd, #imm`, register copies, `adds rd, rn, #imm` and
 * `subs rd, rn, rm` of known values; any other write forgets the register.
 */
function constantsBefore(insns: readonly Insn[], at: number, window: number, v: AnalysisView): (number | undefined)[] {
  let first = at;
  while (first > 0 && at - first < window) {
    const prev = insns[first - 1];
    const cur = insns[first];
    if (prev === undefined || cur === undefined || prev.addr + prev.size !== cur.addr) break;
    first--;
  }
  const regs: (number | undefined)[] = new Array<number | undefined>(16).fill(undefined);
  for (let k = first; k < at; k++) {
    const insn = insns[k];
    if (insn === undefined) continue;
    const f = insn.flow;
    if (f.kind === 'pool-load') {
      regs[f.rd] = contains(v.rom, f.pool, 4) ? u32(v.rom, f.pool) : undefined;
      continue;
    }
    const rd = writtenRegister(insn);
    const from = movedFrom(insn);
    if (rd !== undefined && from !== undefined) regs[rd] = regs[from];
    else if (rd !== undefined && insn.specId === 'thumb.mov_imm') regs[rd] = insn.fields['imm'];
    else if (rd !== undefined && insn.specId === 'thumb.add_imm3') {
      const base = regs[insn.fields['rn'] ?? 16];
      regs[rd] = base === undefined ? undefined : (base + (insn.fields['imm'] ?? 0)) >>> 0;
    } else if (rd !== undefined && insn.specId === 'thumb.sub_reg') {
      const a = regs[insn.fields['rn'] ?? 16];
      const b = regs[insn.fields['rm'] ?? 16];
      regs[rd] = a === undefined || b === undefined ? undefined : (a - b) >>> 0;
    } else {
      const writes = registerEffect(insn).writes;
      for (let r = 0; r < 16; r++) if ((writes & (1 << r)) !== 0) regs[r] = undefined;
    }
  }
  return regs;
}

/** The copies of a Thumb reading: calls whose r0, r1 and r2 hold a ROM source, an IWRAM destination and a size. */
function copiesOf(by: Addr, r: Reading, v: AnalysisView): Copy[] {
  if (r.mode !== 'thumb' || !r.pools.some((p) => inIwram(p.value))) return [];
  const { argInsns, maxBytes } = v.profile.ramCopy;
  const insns = decoded(r, v);
  const out: Copy[] = [];
  insns.forEach((insn, k) => {
    if (insn.flow.kind !== 'bl') return;
    const [source, dest, bytes] = constantsBefore(insns, k, argInsns, v);
    if (source === undefined || dest === undefined || bytes === undefined) return;
    const start = source & ~1;
    if (!inIwram(dest) || bytes <= 0 || bytes > maxBytes || !contains(v.rom, start, bytes)) return;
    out.push({ by, source: start, dest, bytes });
  });
  return out;
}

/** The register `bl target` jumps through when the target is a `bx rN` stub (libgcc's `_call_via_rN`). */
function stubRegister(target: Addr, v: AnalysisView): number | undefined {
  if (!contains(v.rom, target, 2)) return undefined;
  const f = decode('thumb', thumbWordAt(v.rom, target), target).flow;
  return f.kind === 'indirect' && f.via === 'bx' ? f.reg : undefined;
}

/** The IWRAM pointers a reading loads from its pool and jumps through within `argInsns` instructions. */
function jumpsOf(by: Addr, r: Reading, v: AnalysisView): Jump[] {
  if (!r.pools.some((p) => inIwram(p.value))) return [];
  const window = v.profile.ramCopy.argInsns;
  const insns = decoded(r, v);
  const out: Jump[] = [];
  insns.forEach((insn, k) => {
    const f = insn.flow;
    if (f.kind !== 'pool-load' || !contains(v.rom, f.pool, 4)) return;
    const pointer = u32(v.rom, f.pool);
    if (!inIwram(pointer)) return;
    let live = 1 << f.rd;
    for (let j = k + 1; j < insns.length && j <= k + window && live !== 0; j++) {
      const x = insns[j];
      const prev = insns[j - 1];
      if (x === undefined || prev === undefined || prev.addr + prev.size !== x.addr) break;
      const g = x.flow;
      if (g.kind === 'indirect') {
        if ((g.via === 'bx' || g.via === 'mov-pc') && (live & (1 << g.reg)) !== 0) out.push({ by, pointer });
        break;
      }
      if (g.kind === 'bl') {
        const reg = r.mode === 'thumb' ? stubRegister(g.target, v) : undefined;
        if (reg !== undefined && (live & (1 << reg)) !== 0) out.push({ by, pointer });
        break;
      }
      if (g.kind !== 'next' && g.kind !== 'pool-load') break;
      const rd = writtenRegister(x);
      const from = movedFrom(x);
      if (rd !== undefined && from !== undefined && (live & (1 << from)) !== 0) live |= 1 << rd;
      else live &= ~registerEffect(x).writes;
    }
  });
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
 * the block's first byte, or the instruction before it (in its mode) is an unconditional exit. A pointer
 * into the middle of a run of code that falls through (hand-written ARM with several entries) names a
 * second entry, which the function that runs into it already holds; proposing it would split that
 * function at an entry its reading reaches.
 */
function opensFunction(entry: Addr, mode: Mode, copy: Copy, v: AnalysisView): boolean {
  const size = mode === 'arm' ? 4 : 2;
  const prev = entry - size;
  if (entry === copy.source || prev < copy.source) return true;
  if (!contains(v.rom, prev, size)) return false;
  return exits(mode === 'arm' ? decode('arm', u32(v.rom, prev), prev) : decode('thumb', u16(v.rom, prev), prev));
}

/** The entry a jump names in a copied block, or undefined when it names none. */
function entryOf(copy: Copy, jump: Jump, v: AnalysisView): Proposal | undefined {
  const run = jump.pointer & ~1;
  if (run <= copy.dest || run >= copy.dest + copy.bytes) return undefined;
  const mode: Mode = (jump.pointer & 1) === 1 ? 'thumb' : 'arm';
  const entry = copy.source + (run - copy.dest);
  if (mode === 'arm' && (entry & 3) !== 0) return undefined;
  if (v.isFunction(entry) || v.claimAt(entry) !== Claim.free || !opensFunction(entry, mode, copy, v)) return undefined;
  if (mode === 'arm') {
    const r = v.read(entry, 'arm');
    if (r.insns.length === 0 || r.errors.length > 0 || r.returns === 0) return undefined;
  } else if (!v.valid(entry)) return undefined;
  return { entry, mode, cites: [jump.by, copy.by] };
}

export default defineRule({
  meta: {
    id: 'seed.ram-copy',
    summary: 'the entries of a code block copied from the ROM to IWRAM, at the load addresses of the IWRAM pointers accepted code jumps through',
    restsOn:
      'code that runs from IWRAM is copied there from its load image in the ROM by a call naming the source, the destination and the size, and the rest of the program reaches it only by jumping through its IWRAM addresses',
    recovers: 'functions that run from IWRAM, linked at their load address, which no ROM address names (past the code end, or between unreferenced data)',
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
    const pairs: [Copy, Jump][] = [];
    if (own.length > 0) for (const j of allJumps(v)) for (const c of own) pairs.push([c, j]);
    if (jumps.length > 0) for (const c of allCopies(v)) if (c.by !== f.entry) for (const j of jumps) pairs.push([c, j]);
    const byEntry = new Map<Addr, Proposal>();
    for (const [c, j] of pairs) {
      const p = entryOf(c, j, v);
      if (p !== undefined && !byEntry.has(p.entry)) byEntry.set(p.entry, p);
    }
    const out: Proposal[] = [];
    const covered = new Set<Addr>();
    for (const entry of sortedKeys(byEntry)) {
      const p = byEntry.get(entry);
      if (p === undefined || covered.has(entry)) continue;
      out.push(p);
      for (const i of v.read(entry, p.mode).insns) if (i.addr !== entry) covered.add(i.addr);
    }
    return out;
  },
});
