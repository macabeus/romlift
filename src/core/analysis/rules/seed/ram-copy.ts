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

/** The instruction of reading `r` at `a` (one of its instructions), decoded. */
function insnAt(r: Reading, a: Addr, v: AnalysisView): Insn {
  return r.mode === 'thumb' ? decode('thumb', thumbWordAt(v.rom, a), a) : decode('arm', u32(v.rom, a), a);
}

/** The instruction of `r` right before `a` in the straight line (it ends at `a`), or undefined. */
function previous(r: Reading, a: Addr): Addr | undefined {
  if (r.mode === 'arm') return r.insnAt.get(a - 4) === 4 ? a - 4 : undefined;
  if (r.insnAt.get(a - 2) === 2) return a - 2;
  return r.insnAt.get(a - 4) === 4 ? a - 4 : undefined;
}

/** The instruction of `r` right after the one at `a` in the straight line, or undefined. */
function following(r: Reading, a: Addr): Addr | undefined {
  const len = r.insnAt.get(a);
  return len !== undefined && r.insnAt.has(a + len) ? a + len : undefined;
}

/** The literal a Thumb `ldr rd, [pc, #imm]` or ARM `ldr rd, [pc, #+-imm]` at `a` loads, read from the raw bits without a decode; undefined for anything else. */
function pcLoadLiteral(a: Addr, mode: Mode, v: AnalysisView): Addr | undefined {
  if (mode === 'thumb') {
    const h = u16(v.rom, a);
    return (h & 0xf800) === 0x4800 ? ((a + 4) & ~3) + (h & 0xff) * 4 : undefined;
  }
  const w = u32(v.rom, a);
  if ((w & 0x0f7f0000) !== 0x051f0000) return undefined;
  const off = w & 0xfff;
  return a + 8 + ((w & 0x00800000) !== 0 ? off : -off);
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
 * The constant values of r0..r15 before the instruction at `at`, from the straight-line run of at most
 * `window` instructions before it: pool literals, `movs rd, #imm`, register copies, `adds rd, rn, #imm`
 * and `subs rd, rn, rm` of known values; any other write forgets the register.
 */
function constantsBefore(r: Reading, at: Addr, window: number, v: AnalysisView): (number | undefined)[] {
  const run: Addr[] = [];
  for (let a = previous(r, at); a !== undefined && run.length < window; a = previous(r, a)) run.push(a);
  const regs: (number | undefined)[] = new Array<number | undefined>(16).fill(undefined);
  for (const a of run.reverse()) {
    const insn = insnAt(r, a, v);
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
      const x = regs[insn.fields['rn'] ?? 16];
      const y = regs[insn.fields['rm'] ?? 16];
      regs[rd] = x === undefined || y === undefined ? undefined : (x - y) >>> 0;
    } else {
      const writes = registerEffect(insn).writes;
      for (let k = 0; k < 16; k++) if ((writes & (1 << k)) !== 0) regs[k] = undefined;
    }
  }
  return regs;
}

/** The copies of a Thumb reading: calls whose r0, r1 and r2 hold a ROM source, an IWRAM destination and a size. */
function copiesOf(by: Addr, r: Reading, v: AnalysisView): Copy[] {
  if (r.mode !== 'thumb' || r.blSites.length === 0) return [];
  const iwram = new Set(r.pools.filter((p) => inIwram(p.value)).map((p) => p.addr));
  if (iwram.size === 0 || !r.pools.some((p) => contains(v.rom, p.value & ~1))) return [];
  const { argInsns, maxBytes } = v.profile.ramCopy;
  const out: Copy[] = [];
  for (const site of [...r.blSites].sort((a, b) => compareNumbers(a.site, b.site))) {
    // The destination is an IWRAM pool literal loaded in the window: without one there is nothing to decode.
    let loadsIwram = false;
    let steps = 0;
    for (let a = previous(r, site.site); a !== undefined && steps < argInsns && !loadsIwram; a = previous(r, a), steps++) {
      const literal = pcLoadLiteral(a, 'thumb', v);
      loadsIwram = literal !== undefined && iwram.has(literal);
    }
    if (!loadsIwram) continue;
    const [source, dest, bytes] = constantsBefore(r, site.site, argInsns, v);
    if (source === undefined || dest === undefined || bytes === undefined) continue;
    const start = source & ~1;
    if (!inIwram(dest) || bytes <= 0 || bytes > maxBytes || !contains(v.rom, start, bytes)) continue;
    out.push({ by, source: start, dest, bytes });
  }
  return out;
}

/** The register `bl target` jumps through when the target is a `bx rN` stub (libgcc's `_call_via_rN`). */
function stubRegister(target: Addr, v: AnalysisView): number | undefined {
  if (!contains(v.rom, target, 2)) return undefined;
  const f = decode('thumb', thumbWordAt(v.rom, target), target).flow;
  return f.kind === 'indirect' && f.via === 'bx' ? f.reg : undefined;
}

/** Thumb `bx rN`, `mov pc, rN` or the first half of a `bl`, from the raw halfword: what can end a jump search. */
function mayJump(h: number): boolean {
  return (h & 0xff87) === 0x4700 || (h & 0xff87) === 0x4687 || (h & 0xf800) === 0xf000;
}

/** Whether the value loaded into `rd` at `load` is jumped through within `argInsns` straight-line instructions. */
function jumpsThrough(r: Reading, load: Addr, rd: number, v: AnalysisView): boolean {
  if (r.mode === 'thumb') {
    // Most IWRAM loads address variables: without a jump in the window there is nothing to decode.
    let any = false;
    let steps = 0;
    for (let a = following(r, load); a !== undefined && steps < v.profile.ramCopy.argInsns && !any; a = following(r, a), steps++) any = mayJump(u16(v.rom, a));
    if (!any) return false;
  }
  let live = 1 << rd;
  let steps = 0;
  for (let a = following(r, load); a !== undefined && steps < v.profile.ramCopy.argInsns && live !== 0; a = following(r, a), steps++) {
    const x = insnAt(r, a, v);
    const g = x.flow;
    if (g.kind === 'indirect') return (g.via === 'bx' || g.via === 'mov-pc') && (live & (1 << g.reg)) !== 0;
    if (g.kind === 'bl') {
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

/** The IWRAM pointers a reading loads from its pool and jumps through within `argInsns` instructions. */
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
