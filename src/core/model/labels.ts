// The model's labels (architecture §5, §6.2 step 4, D15, D46): every address the printer names. A `func` label
// per listed function (its config name), a `data` label at each header, orphan and data chunk (the chunk's
// name) and at each symbol inside the ROM, a `pool` label `_<ADDR>` at every pool word, a `table` label at
// every jump table, a `local` label `_<ADDR>` at every branch, bl, adr and pool-load target and table target
// that has no other label and that an item can start at (D63: never an odd address in code, the second
// halfword of a bl, the inside of an ARM word or of a pool or table word, which the printer could not place,
// so the instruction naming it fails the printing rule and prints raw), and a `data` label `gUnk_<ADDR>` where a pool word or a table points into a data
// module. A label holds its run address (the load address outside runs_at).
//
// An adr target whose only labels are Thumb functions gets its local label too: an adr names a label that links to
// the target itself (resolver.ts adrResolverFor), never a Thumb function's, which links to the target plus one
// (the owner's answer to Q7 of phase 3, D72 c). Every other reference still names the function.
//
// Scope: a label is 'global' when something in another module references it (a call, a branch, an adr, a
// pool load, a pool word naming it, its Thumb form included, a table entry), else 'module'. A short Thumb
// branch into another module prints raw (items.ts), so it references nothing.
import { decode, isThumbBlPrefix, isThumbBlSuffix, thumbMayName } from '../../foundation/isa/decode.ts';
import type { Insn, SpecId } from '../../foundation/isa/types.ts';
import { contains, peek16, peek32 } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { insnAligned } from '../../foundation/rom/span.ts';
import { compareCodeUnits, compareNumbers, sortedEntries } from '../../foundation/util/sorted.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import type { FunctionConfig } from '../config/schema.ts';
import type { ChunkPlan } from './chunks.ts';
import type { Segments } from './segments.ts';
import { loadAddressOf, loadModuleAt, moduleIndexAt, runOffsetAt } from './modules.ts';
import { dataName, localName } from './names.ts';
import { compareLabels, isExactLabel, wordValueOf } from './resolver.ts';
import type { Label, LabelKind, ModelSymbol, Module } from './types.ts';

// ---------------------------------------------------------------------------------------------------
// References from code.

/** What an instruction names: a short Thumb branch, another branch, a bl, an adr or a pool load. */
export type CodeRefKind = 'short-branch' | 'branch' | 'bl' | 'adr' | 'pool-load';

/**
 * One reference from an instruction: its load address, the run address it names, and what items.ts needs to
 * classify it without decoding it again (its row, size, word and the run address it was decoded at).
 */
export interface CodeRef {
  readonly site: Addr;
  readonly target: Addr;
  readonly kind: CodeRefKind;
  readonly specId: SpecId;
  readonly size: 2 | 4;
  readonly word: number;
  readonly run: Addr;
}

function refOf(insn: Insn, site: Addr): CodeRef | undefined {
  const flow = insn.flow;
  const ref = (target: Addr, kind: CodeRefKind): CodeRef => ({ site, target, kind, specId: insn.specId, size: insn.size, word: insn.word, run: insn.addr });
  switch (flow.kind) {
    case 'branch':
      return ref(flow.target, insn.mode === 'thumb' && insn.size === 2 ? 'short-branch' : 'branch');
    case 'bl':
      return ref(flow.target, 'bl');
    case 'adr':
      return ref(flow.target, 'adr');
    case 'pool-load':
      return ref(flow.pool, 'pool-load');
    default:
      return undefined;
  }
}

/**
 * Every reference of the code segments, decoded at run addresses the way items.ts decodes them: a Thumb
 * segment instruction by instruction (a bl pair is one 4-byte instruction when both halves lie in the
 * segment), decoding only the halfwords that can name an address; an ARM segment word by word.
 */
export function codeRefs(rom: Rom, segments: Segments, relocated: readonly Module[]): CodeRef[] {
  const out: CodeRef[] = [];
  for (const s of segments.concrete) {
    if (s.kind !== 'code') continue;
    const offset = runOffsetAt(relocated, s.start);
    if (s.mode === 'arm') {
      for (let a = s.start; a + 4 <= s.end; a += 4) {
        const ref = refOf(decode('arm', peek32(rom, a), a + offset), a);
        if (ref !== undefined) out.push(ref);
      }
      continue;
    }
    for (let a = s.start; a + 2 <= s.end; ) {
      const hw = peek16(rom, a);
      if (isThumbBlPrefix(hw) && a + 4 <= s.end && isThumbBlSuffix(peek16(rom, a + 2))) {
        const ref = refOf(decode('thumb', peek32(rom, a), a + offset), a);
        if (ref !== undefined) out.push(ref);
        a += 4;
        continue;
      }
      if (thumbMayName(hw)) {
        const ref = refOf(decode('thumb', hw, a + offset), a);
        if (ref !== undefined) out.push(ref);
      }
      a += 2;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Labels.

export interface LabelInputs {
  readonly rom: Rom;
  /** In ROM order. */
  readonly modules: readonly Module[];
  /** The modules with a runAt. */
  readonly relocated: readonly Module[];
  readonly chunks: readonly ChunkPlan[];
  /** Every listed function inside the ROM. */
  readonly functions: ReadonlyMap<Addr, FunctionConfig>;
  /**
   * Every symbol of the config: one inside the ROM is a data label of the file that holds its bytes; one outside
   * (RAM, I/O, an absolute address) is a global label no file places, which symbols.ld defines, so a pool word
   * equal to its address prints as its name (§5: `ldr r0, _08001A3C @ =gFoo`).
   */
  readonly symbols: readonly ModelSymbol[];
  readonly segments: Segments;
  readonly refs: readonly CodeRef[];
}

export interface LabelsResult {
  /** Sorted by address, then name. */
  readonly labels: readonly Label[];
  /**
   * The [symbols] entries inside the ROM that got no label: their address lies inside an instruction, a pool
   * word or a table entry, where no file can define a label (D63 d), so nothing may print their name.
   */
  readonly unplaced: readonly ModelSymbol[];
  /** The func label of each listed function, by load address. */
  readonly functions: ReadonlyMap<Addr, Label>;
  /** The load addresses of the labels, ascending and unique. */
  readonly starts: readonly Addr[];
}

interface Candidate {
  /** Its load address (the label's own address is the run address, buildLabels). */
  readonly load: Addr;
  readonly name: string;
  readonly kind: LabelKind;
  readonly thumb: boolean;
}

/** Candidates in compareLabels' order, by load address. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return compareLabels({ addr: a.load, kind: a.kind, name: a.name }, { addr: b.load, kind: b.kind, name: b.name });
}

/** Whether a candidate links to its own address: every label but a Thumb function's (resolver.ts isExactLabel). */
function isExact(c: Candidate): boolean {
  return isExactLabel({ addr: c.load, kind: c.kind, thumb: c.thumb });
}

/**
 * The candidates of one address, without a local or default data label another label there replaces, one per
 * name. A local label is replaced only by a label that links to the address itself, so an adr target that has only
 * Thumb function labels keeps it (candidatesOf adds one there for an adr alone).
 */
function keep(group: readonly Candidate[]): Candidate[] {
  const hasOther = group.some((c) => c.kind !== 'local' && isExact(c));
  const namedData = group.some((c) => c.kind === 'data' && c.name !== dataName(c.load));
  const out: Candidate[] = [];
  for (const c of group) {
    if (c.kind === 'local' && hasOther) continue;
    if (c.kind === 'data' && c.name === dataName(c.load) && namedData) continue;
    if (out.some((o) => o.name === c.name)) continue;
    out.push(c);
  }
  return out;
}

/** The first index of `segments` whose end lies above `a`. */
function segmentIndexAt(segments: readonly Segments['concrete'][number][], a: Addr): number {
  return lowerBound(segments, a + 1, (s) => s.end);
}

/**
 * Whether no item can start at load address `a`: inside a code segment, an odd address, an ARM address off its
 * word, or the second halfword of a 4-byte instruction that names an address (a bl); inside a pool or table
 * segment, anything but its start (D63).
 */
function insideAnItem(segments: Segments, refs: readonly CodeRef[]): (a: Addr) => boolean {
  const secondHalves = new Set<Addr>();
  for (const r of refs) if (r.size === 4) secondHalves.add(r.site + 2);
  return (a) => {
    const s = segments.concrete[segmentIndexAt(segments.concrete, a)];
    if (s === undefined || a < s.start) return false;
    switch (s.kind) {
      case 'code':
        return !insnAligned('thumb', a) || !insnAligned(s.mode, a - s.start) || secondHalves.has(a);
      case 'pool':
      case 'table':
        return a !== s.start;
      default:
        return false;
    }
  };
}

/** Every label candidate, in load address order, and the symbols inside the ROM no label can stand for. */
function candidatesOf(inputs: LabelInputs): { readonly candidates: Candidate[]; readonly unplaced: readonly ModelSymbol[] } {
  const { rom, modules, segments } = inputs;
  const out: Candidate[] = [];
  const unplaced: ModelSymbol[] = [];
  const inside = insideAnItem(segments, inputs.refs);
  const named = new Set<Addr>();
  const add = (c: Candidate): void => {
    out.push(c);
    named.add(c.load);
  };
  for (const [entry, f] of sortedEntries(inputs.functions)) add({ load: entry, name: f.name, kind: 'func', thumb: f.mode === 'thumb' });
  for (const c of inputs.chunks) if (c.entry === undefined) add({ load: c.span.start, name: c.name, kind: 'data', thumb: false });
  for (const s of inputs.symbols) {
    if (contains(rom, s.addr) && inside(s.addr)) unplaced.push(s);
    else add({ load: s.addr, name: s.name, kind: 'data', thumb: false });
  }
  const isData = (a: Addr): boolean => contains(rom, a) && modules[loadModuleAt(modules, a)]?.kind === 'data';
  const data: Addr[] = [];
  const targets: Addr[] = [];
  for (const s of segments.concrete) {
    if (s.kind === 'pool') {
      add({ load: s.start, name: localName(s.start), kind: 'pool', thumb: false });
      if (isData(s.value)) data.push(s.value);
    } else if (s.kind === 'table') {
      if (s.first) add({ load: s.start, name: localName(s.start), kind: 'table', thumb: false });
      if (isData(s.target)) data.push(s.target);
      else targets.push(s.target);
    }
  }
  const adrs: Addr[] = [];
  for (const r of inputs.refs) {
    const load = loadAddressOf(inputs.relocated, r.target);
    targets.push(load);
    if (r.kind === 'adr') adrs.push(load);
  }
  // A data or local label only where no other label names the address yet, once per address.
  for (const a of data) if (!named.has(a)) add({ load: a, name: dataName(a), kind: 'data', thumb: false });
  for (const a of targets) if (!named.has(a) && contains(rom, a) && !inside(a)) add({ load: a, name: localName(a), kind: 'local', thumb: false });
  // An adr target named only by Thumb functions: its local label too, which the adr names.
  const exact = new Set(out.filter(isExact).map((c) => c.load));
  for (const a of adrs) {
    if (exact.has(a) || !contains(rom, a) || inside(a)) continue;
    add({ load: a, name: localName(a), kind: 'local', thumb: false });
    exact.add(a);
  }
  return { candidates: out.sort(compareCandidates), unplaced };
}

/** The labels at each run address, preferred first (resolver.ts compareLabels: LABEL_KIND_ORDER, then name). */
interface LabelIndex {
  /** Sorted by address, then preference. */
  readonly byAddr: Label[];
}

function firstAt(labels: readonly Label[], addr: Addr): number {
  return lowerBound(labels, addr, (l) => l.addr);
}

/** The index in index.byAddr of the preferred label at run address `addr` that `match` accepts, or -1. */
function preferredAt(index: LabelIndex, addr: Addr, match: (l: Label) => boolean): number {
  for (let i = firstAt(index.byAddr, addr); i < index.byAddr.length; i++) {
    const l = index.byAddr[i];
    if (l === undefined || l.addr !== addr) break;
    if (match(l)) return i;
  }
  return -1;
}

/** Marks global every label something in another module references. */
function scopes(inputs: LabelInputs, index: LabelIndex): boolean[] {
  const { modules, segments } = inputs;
  const global = index.byAddr.map(() => false);
  const reference = (site: Addr, i: number): void => {
    const label = index.byAddr[i];
    if (label === undefined || global[i] === true) return;
    if (loadModuleAt(modules, site) !== moduleIndexAt(modules, label.addr, inputs.relocated)) global[i] = true;
  };
  const exact = (site: Addr, run: Addr): void => reference(site, preferredAt(index, run, () => true));
  const word = (site: Addr, value: number): void => {
    const matches = (l: Label): boolean => wordValueOf(l) === value;
    const at = preferredAt(index, value, matches);
    reference(site, at >= 0 || insnAligned('thumb', value) ? at : preferredAt(index, value - 1, matches));
  };
  for (const r of inputs.refs) {
    if (r.kind === 'short-branch' && loadModuleAt(modules, r.site) !== moduleIndexAt(modules, r.target, inputs.relocated)) continue;
    if (r.kind === 'adr') reference(r.site, preferredAt(index, r.target, isExactLabel));
    else exact(r.site, r.target);
  }
  for (const s of segments.concrete) {
    if (s.kind === 'pool') word(s.start, s.value);
    else if (s.kind === 'table') exact(s.start, s.target + runOffsetAt(inputs.relocated, s.target));
  }
  return global;
}

/** The labels of the model. */
export function buildLabels(inputs: LabelInputs): LabelsResult {
  const { candidates, unplaced } = candidatesOf(inputs);
  const kept: Candidate[] = [];
  for (let i = 0; i < candidates.length; ) {
    let j = i;
    while (j < candidates.length && candidates[j]?.load === candidates[i]?.load) j++;
    kept.push(...keep(candidates.slice(i, j)));
    i = j;
  }
  const pairs = kept.map((c) => ({ load: c.load, label: { addr: c.load + runOffsetAt(inputs.relocated, c.load), name: c.name, kind: c.kind, thumb: c.thumb, scope: 'module' } satisfies Label }));
  // The candidates are in (load address, kind, name) order, which is compareLabels' order unless a run address moved.
  if (inputs.relocated.length > 0) pairs.sort((a, b) => compareLabels(a.label, b.label));
  const index: LabelIndex = { byAddr: pairs.map((p) => p.label) };
  const global = scopes(inputs, index);
  const functions = new Map<Addr, Label>();
  const labels = pairs.map((p, i): Label => {
    const label: Label = global[i] === true || !contains(inputs.rom, p.load) ? { ...p.label, scope: 'global' } : p.label;
    if (label.kind === 'func' && inputs.functions.get(p.load)?.name === label.name) functions.set(p.load, label);
    return label;
  });
  labels.sort((a, b) => compareNumbers(a.addr, b.addr) || compareCodeUnits(a.name, b.name));
  const starts = kept
    .map((c) => c.load)
    .filter((a, i, all) => contains(inputs.rom, a) && (i === 0 || all[i - 1] !== a));
  return { labels, unplaced, functions, starts };
}
