// The least extents of the unsized work-RAM symbols (D110): what the code proves about how far an object reaches, so a
// pool word inside it prints `name + offset` (resolver.ts wordNameOf) rather than as a number.
//
// A [symbols] entry without `size` names only its own address. When a Thumb function loads the entry's address from its
// pool into a register and reaches memory through that register at a displacement (`ldr r7, =gFoo` then
// `ldrb r0, [r7, #5]`, or `movs r1, #0x39` then `ldrb r0, [r7, r1]`), the object reaches at least to that displacement
// plus the access width: agbcc (GCC 2.95) has no section anchors, so it never reaches one object through another's
// address. The largest such end over every function is the entry's inferred size, cut at the next named start (another
// [symbols] entry, a function's run address, a runs_at range) and at the end of its region, so an inferred extent never
// crosses a name the project gave. It is a lower bound: an object larger than the code proves keeps its other words
// numeric, and W_POOL_WORD_PAST_SYMBOL names the ones a function also loads the entry beside.
//
// The pass is a straight-line constant propagation over each Thumb function's code, restarted at every branch target,
// jump-table target and code span, and after every instruction that does not fall through; a call or swi clobbers what
// its row says (r0-r3, r12 and lr for a bl), so a base agbcc keeps in a callee-saved register survives it. ARM code and the code of a runs_at range
// are not read. No byte changes: `name + offset` links to the same word.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { popcount } from '../../foundation/isa/bits.ts';
import { decode, isThumbBlPrefix, isThumbBlSuffix } from '../../foundation/isa/decode.ts';
import { registerEffect } from '../../foundation/isa/registers.ts';
import { rowOf } from '../../foundation/isa/rows.ts';
import type { Insn } from '../../foundation/isa/types.ts';
import { isRamAddress, regionOf } from '../../foundation/rom/memory-map.ts';
import { contains, peek16, peek32, u32 } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import { hexAddr, hexSize } from '../../foundation/util/hex.ts';
import { sortedKeys } from '../../foundation/util/sorted.ts';
import type { FunctionFact } from '../analysis/types.ts';
import { ModelCodes } from './codes.ts';
import type { ModelFunction, ModelSymbol, Module } from './types.ts';

/** What the pass reads of a function fact. */
export type ExtentFact = Pick<FunctionFact, 'entry' | 'mode' | 'runAt' | 'code' | 'pools' | 'farPools' | 'branchTargets' | 'tables'>;

/** A register's known value: `sym + n` when `sym` is set (an unsized RAM symbol's address), else the constant `n`. */
interface Value {
  readonly sym?: Addr;
  readonly n: number;
}

/** The bytes each Thumb load or store reaches from its address. */
const WIDTH: Readonly<Record<string, number>> = {
  'thumb.str_imm': 4,
  'thumb.ldr_imm': 4,
  'thumb.strb_imm': 1,
  'thumb.ldrb_imm': 1,
  'thumb.strh_imm': 2,
  'thumb.ldrh_imm': 2,
  'thumb.str_reg': 4,
  'thumb.ldr_reg': 4,
  'thumb.strb_reg': 1,
  'thumb.ldrb_reg': 1,
  'thumb.ldrsb_reg': 1,
  'thumb.strh_reg': 2,
  'thumb.ldrh_reg': 2,
  'thumb.ldrsh_reg': 2,
};

/** The flows after which the next instruction is reached only through a label. */
const ENDS_BLOCK = new Set(['return', 'indirect', 'invalid', 'mode-switch']);

function added(a: Value | undefined, k: number): Value | undefined {
  if (a === undefined) return undefined;
  return a.sym === undefined ? { n: (a.n + k) >>> 0 } : { sym: a.sym, n: a.n + k };
}

function sum(a: Value | undefined, b: Value | undefined): Value | undefined {
  if (a === undefined || b === undefined) return undefined;
  if (a.sym !== undefined && b.sym !== undefined) return undefined;
  const sym = a.sym ?? b.sym;
  return sym === undefined ? { n: (a.n + b.n) >>> 0 } : { sym, n: a.n + b.n };
}

/** The value an instruction writes to `rd`, for the rows the pass follows; undefined for every other write. */
function written(insn: Insn, ops: Readonly<Record<string, number>>, regs: readonly (Value | undefined)[], rom: Rom, candidates: ReadonlySet<Addr>): Value | undefined {
  const r = (name: string): Value | undefined => regs[ops[name] ?? -1];
  const k = (name: string): number => ops[name] ?? 0;
  switch (insn.specId) {
    case 'thumb.ldr_pc': {
      if (insn.flow.kind !== 'pool-load' || !contains(rom, insn.flow.pool, 4)) return undefined;
      const word = u32(rom, insn.flow.pool);
      return candidates.has(word) ? { sym: word, n: 0 } : { n: word };
    }
    case 'thumb.mov_imm':
      return { n: k('imm') };
    case 'thumb.movs_reg':
    case 'thumb.mov_hi':
      return r('rm');
    case 'thumb.lsl_imm': {
      const v = r('rm');
      return v === undefined || v.sym !== undefined ? undefined : { n: (v.n << k('imm')) >>> 0 };
    }
    case 'thumb.add_imm3':
      return added(r('rn'), k('imm'));
    case 'thumb.sub_imm3':
      return added(r('rn'), -k('imm'));
    case 'thumb.add_imm8':
      return added(r('rd'), k('imm'));
    case 'thumb.sub_imm8':
      return added(r('rd'), -k('imm'));
    case 'thumb.add_reg':
      return sum(r('rn'), r('rm'));
    case 'thumb.add_hi':
      return sum(r('rd'), r('rm'));
    default:
      return undefined;
  }
}

/** The span of a symbol-relative access `insn` makes, as [sym, end offset), or undefined. */
function accessOf(insn: Insn, ops: Readonly<Record<string, number>>, regs: readonly (Value | undefined)[]): { readonly sym: Addr; readonly start: number; readonly end: number } | undefined {
  const r = (name: string): Value | undefined => regs[ops[name] ?? -1];
  let at: Value | undefined;
  let width: number;
  if (insn.specId === 'thumb.ldmia' || insn.specId === 'thumb.stmia') {
    at = r('rn');
    width = 4 * popcount((ops['list'] ?? 0) & 0xff);
  } else {
    const w = WIDTH[insn.specId];
    if (w === undefined) return undefined;
    width = w;
    at = insn.specId.endsWith('_imm') ? added(r('rn'), ops['imm'] ?? 0) : sum(r('rn'), r('rm'));
  }
  if (at?.sym === undefined || at.n < 0 || width === 0) return undefined;
  return { sym: at.sym, start: at.n, end: at.n + width };
}

/** Decodes the Thumb instruction at `a` inside [a, end): a bl pair as one 4-byte instruction. */
function thumbAt(rom: Rom, a: Addr, end: Addr): Insn {
  const hw = peek16(rom, a);
  if (isThumbBlPrefix(hw) && a + 4 <= end && isThumbBlSuffix(peek16(rom, a + 2))) return decode('thumb', peek32(rom, a), a);
  return decode('thumb', hw, a);
}

/** Records into `reach` the largest end of every symbol-relative access of one Thumb function. */
function readFunction(rom: Rom, f: ExtentFact, candidates: ReadonlySet<Addr>, reach: Map<Addr, number>): void {
  const restarts = new Set<Addr>([f.entry, ...f.branchTargets]);
  for (const t of f.tables) for (const target of t.targets) restarts.add(target);
  for (const span of f.code) {
    let regs: (Value | undefined)[] = [];
    for (let a = span.start; a + 2 <= span.end; ) {
      if (restarts.has(a)) regs = [];
      const insn = thumbAt(rom, a, span.end);
      const ops = rowOf(insn.specId).toOps(insn.fields, insn.addr);
      const access = accessOf(insn, ops, regs);
      if (access !== undefined) reach.set(access.sym, Math.max(reach.get(access.sym) ?? 0, access.end));
      const value = written(insn, ops, regs, rom, candidates);
      const writes = registerEffect(insn).writes;
      for (let reg = 0; reg < 15; reg++) {
        if ((writes & (1 << reg)) === 0) continue;
        regs[reg] = reg === ops['rd'] ? value : undefined;
      }
      const flow = insn.flow;
      if (ENDS_BLOCK.has(flow.kind) || (flow.kind === 'branch' && !flow.conditional)) regs = [];
      a += insn.size;
    }
  }
}

/** The pool words of a function, by value. */
function poolWords(rom: Rom, f: ExtentFact): number[] {
  return [...f.pools, ...f.farPools].filter((p) => contains(rom, p, 4)).map((p) => u32(rom, p));
}

export interface InferredExtents {
  /** The model's symbols, an unsized work-RAM entry the code reaches into carrying its inferredSize. */
  readonly symbols: readonly ModelSymbol[];
  /** W_POOL_WORD_PAST_SYMBOL, one per symbol. */
  readonly diagnostics: readonly Diagnostic[];
}

/** The named starts in work RAM an inferred extent stops at: every symbol, every function's run address, every runs_at range. */
function namedStarts(symbols: readonly ModelSymbol[], functions: readonly ModelFunction[], relocated: readonly Module[]): Addr[] {
  const starts = [...symbols.map((s) => s.addr), ...functions.flatMap((f) => (f.runAt === undefined ? [] : [f.runAt])), ...relocated.flatMap((m) => (m.runAt === undefined ? [] : [m.runAt]))];
  return sortedKeys(new Set(starts.filter(isRamAddress)));
}

/** How far the entry at `addr` may reach: the next named start above it, or the end of its region. */
function capOf(addr: Addr, starts: readonly Addr[]): number {
  const region = regionOf(addr);
  const regionEnd = region === undefined ? addr : region.start + region.size;
  const next = starts[lowerBound(starts, addr + 1, (s) => s)];
  return Math.min(next ?? regionEnd, regionEnd) - addr;
}

const LISTED = 8;

/** The least extents of the unsized work-RAM symbols, and W_POOL_WORD_PAST_SYMBOL. */
export function inferSymbolExtents(
  rom: Rom,
  analysis: { readonly functions: readonly ExtentFact[] },
  symbols: readonly ModelSymbol[],
  functions: readonly ModelFunction[],
  relocated: readonly Module[],
): InferredExtents {
  const runRanges = relocated.flatMap((m) => (m.runAt === undefined ? [] : [{ start: m.runAt, end: m.runAt + (m.span.end - m.span.start) }]));
  const unsized = symbols.filter((s) => s.size === undefined && isRamAddress(s.addr) && !runRanges.some((r) => s.addr >= r.start && s.addr < r.end));
  if (unsized.length === 0) return { symbols, diagnostics: [] };
  const candidates = new Set(unsized.map((s) => s.addr));
  const starts = namedStarts(symbols, functions, relocated);

  const thumb = analysis.functions.filter((f) => f.mode === 'thumb' && f.runAt === undefined);
  const words = thumb.map((f) => poolWords(rom, f));
  const reach = new Map<Addr, number>();
  thumb.forEach((f, i) => {
    if (words[i]?.some((w) => candidates.has(w)) === true) readFunction(rom, f, candidates, reach);
  });

  const sizes = new Map<Addr, number>();
  for (const s of unsized) {
    const size = Math.min(reach.get(s.addr) ?? 0, capOf(s.addr, starts));
    if (size > 0) sizes.set(s.addr, size);
  }
  const out = symbols.map((s): ModelSymbol => {
    const size = sizes.get(s.addr);
    return size === undefined || !candidates.has(s.addr) ? s : { ...s, inferredSize: size };
  });

  // The words a function's pool holds beside the entry's own address, past what the entry covers and before the next
  // named start: the same object spelt by name and as a number, unless the project gives the entry a size.
  const past = new Map<Addr, { readonly words: Set<number>; readonly functions: Set<Addr> }>();
  thumb.forEach((f, i) => {
    const pool = words[i] ?? [];
    for (const addr of sortedKeys(new Set(pool.filter((w) => candidates.has(w))))) {
      const covered = addr + (sizes.get(addr) ?? 1);
      const end = addr + capOf(addr, starts);
      const inside = pool.filter((w) => w >= covered && w < end);
      if (inside.length === 0) continue;
      const entry = past.get(addr) ?? { words: new Set<number>(), functions: new Set<Addr>() };
      for (const w of inside) entry.words.add(w);
      entry.functions.add(f.entry);
      past.set(addr, entry);
    }
  });
  const diagnostics = unsized.flatMap((s): Diagnostic[] => {
    const entry = past.get(s.addr);
    if (entry === undefined) return [];
    const offsets = sortedKeys(entry.words).map((w) => `${hexAddr(w)} (+${hexSize(w - s.addr)})`);
    const listed = offsets.length > LISTED ? `${offsets.slice(0, LISTED).join(', ')} and ${offsets.length - LISTED} more` : offsets.join(', ');
    const inferred = sizes.get(s.addr);
    const known = inferred === undefined ? 'has no size' : `has no size (its accesses prove at least ${hexSize(inferred)} bytes)`;
    const fns = entry.functions.size;
    return [
      diagnostic(
        ModelCodes,
        'W_POOL_WORD_PAST_SYMBOL',
        `the [symbols] entry ${s.name} at ${hexAddr(s.addr)} ${known}, and ${fns} function${fns === 1 ? '' : 's'} that load it also load ${listed}, which print as numbers; if they lie inside ${s.name}, give it a size (\`${hexAddr(s.addr)} = { name = "${s.name}", size = ... }\`) and they print as ${s.name} + offset`,
        { addr: s.addr },
      ),
    ];
  });
  return { symbols: out, diagnostics };
}
