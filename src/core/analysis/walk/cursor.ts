// The walk cursor a WalkPolicy reads (architecture §4.1), and the reading queries several rule families
// share (D56): density, anchoring and frame balance. Rule files may import walk/, never each other, so
// the PoC's dense(), anchoredAtStart(), anchoredAtEnd() and popsCallersFrame() live here once.
import type { Flow, Insn } from '../../../foundation/isa/types.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../../foundation/rom/span.ts';
import type { BlSite, CompilerProfile, ReadingSummary } from '../../profile/types.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { toLoad } from '../address-map.ts';
import type { AddressMap } from '../address-map.ts';
import { codeEndOf, makeReading } from '../reading.ts';
import { InsnIndex } from './insn-index.ts';
import type { ReadingParts } from '../reading.ts';
import { Claim } from '../types.ts';
import type {
  AnalysisView,
  CallSite,
  Exit,
  InsnSpan,
  JumpTable,
  PoolWord,
  Reading,
  ReadingError,
  ReadingShape,
  WalkPolicy,
  WalkStep,
} from '../types.ts';

/** Where the walker is when it asks the walk slot; valid only during that call (the walker reuses it). */
export interface WalkCursor {
  readonly entry: Addr;
  readonly mode: Mode;
  readonly view: AnalysisView;
  /** 'insn': asked about a decoded instruction; 'stop': a Thumb path hit non-code after the run. */
  readonly phase: 'insn' | 'stop';
  /** Phase 'stop': an undecodable halfword, or a word this reading loaded as a pool; undefined in phase 'insn'. */
  readonly stop: 'invalid' | 'pool' | undefined;
  /** Phase 'insn': the instruction's address; phase 'stop': the non-code address. */
  readonly at: Addr;
  /** Thumb: the stack delta after the instruction (push negative, pop positive); ARM: 0. */
  readonly sp: number;
  /** The current path's straight-line run of instructions, the one asked about last. */
  readonly run: readonly Insn[];
  /** Thumb bcc, or an ARM condition other than AL. */
  readonly conditional: boolean;
  /** Whether `a` was already walked as an instruction of this reading. */
  walked(a: Addr): boolean;
}

/** The PoC's dense(): the reading's holes stay within max(minHoles, extent >> holeShift) bytes. */
export function isDense(r: Reading, profile: CompilerProfile): boolean {
  return r.holeBytes <= Math.max(profile.density.minHoles, (r.end - r.entry) >> profile.density.holeShift);
}

/** The PoC's popsCallersFrame(): some return or tail exit pops more than the function pushed. */
export function popsCallersFrame(r: Reading): boolean {
  return r.balance.some((b) => b > 0);
}

/** The reading ends within `slack` bytes before `end` (a hole filled). */
export function fillsTo(r: Reading, end: Addr, slack: number): boolean {
  const d = end - r.end;
  return d >= 0 && d <= slack;
}

function paddingAt(v: AnalysisView, a: Addr): boolean {
  return v.claimAt(a) === Claim.free && v.profile.idioms.isPadding(v.rom, a, undefined);
}

/** The PoC's anchoredAtStart(): claimed bytes end just before the entry, give or take anchorSlack padding bytes. */
export function anchoredAtStart(entry: Addr, v: AnalysisView): boolean {
  let k = entry - 1;
  while (k >= v.rom.base && entry - k <= v.profile.anchorSlack && paddingAt(v, k)) k--;
  return k >= v.rom.base && v.claimAt(k) !== Claim.free;
}

/** The PoC's anchoredAtEnd(): a function starts just after the extent, give or take anchorSlack padding bytes. */
export function anchoredAtEnd(r: Reading, v: AnalysisView): boolean {
  let k = r.end;
  while (k < v.rom.end && k - r.end < v.profile.anchorSlack && paddingAt(v, k)) k++;
  return k < v.rom.end && v.isFunction(k);
}

/** What the far-jump idiom reads of a caller. */
export function readingSummary(r: Reading, rom: Rom, profile: CompilerProfile): ReadingSummary {
  return { entry: r.entry, mode: r.mode, codeEnd: r.codeEnd, end: r.end, prologue: profile.idioms.isPrologue(rom, r.entry, r.mode) };
}

// ---------------------------------------------------------------------------------------------------
// The machinery both walkers share: the resolved walk slot and the record a walk fills.

/** A walk policy with its id, in pipeline.walk order. */
export interface ResolvedPolicy {
  readonly id: RuleId;
  readonly rule: WalkPolicy;
}

/** What a walk needs: the view, the walk slot, and the extent rule (claim.adjacent-pools' extentEnd). */
export interface WalkEnv {
  readonly view: AnalysisView;
  readonly policies: readonly ResolvedPolicy[];
  readonly extentEnd: (shape: ReadingShape) => Addr;
}

/** The cursor a walker fills in place before each ask; `run` is built only when a rule reads it. */
export type MutableCursor = { -readonly [K in Exclude<keyof WalkCursor, 'run'>]: WalkCursor[K] } & { readonly run: readonly Insn[] };

/** A cursor for one walk of `entry`; `run` decodes the current path's run on demand. */
export function walkCursor(view: AnalysisView, entry: Addr, mode: Mode, walked: (a: Addr) => boolean, run: () => readonly Insn[]): MutableCursor {
  return {
    entry,
    mode,
    view,
    phase: 'insn',
    stop: undefined,
    at: entry,
    sp: 0,
    conditional: false,
    walked,
    get run(): readonly Insn[] {
      return run();
    },
  };
}

/** The first policy's answer, with its id. */
export function askWalk(env: WalkEnv, insn: Insn, cursor: WalkCursor): { readonly id: RuleId; readonly step: WalkStep } | undefined {
  for (const p of env.policies) {
    const step = p.rule.onInsn(insn, cursor);
    if (step !== undefined) return { id: p.id, step };
  }
  return undefined;
}

/** The flow kinds the walk slot is asked about; the rest follow the decoder's Flow without asking. */
export function asksWalk(flow: Flow): boolean {
  return flow.kind === 'pool-load' || flow.kind === 'branch' || flow.kind === 'return' || flow.kind === 'indirect' || flow.kind === 'mode-switch';
}

/** The decoded instruction with its Flow's targets mapped from run space back to load addresses (D46). */
export function toLoadInsn(insn: Insn, addresses: AddressMap, load: Addr): Insn {
  const back = (a: Addr): Addr => toLoad(addresses, a) ?? a;
  const f = insn.flow;
  let flow: Flow = f;
  if (f.kind === 'branch') flow = { ...f, target: back(f.target) };
  else if (f.kind === 'bl' || f.kind === 'adr' || f.kind === 'mode-switch') flow = { ...f, target: back(f.target) };
  else if (f.kind === 'pool-load') flow = { ...f, pool: back(f.pool) };
  return flow === f && insn.addr === load ? insn : { ...insn, addr: load, flow };
}

/** The mutable record of one walk, turned into a Reading by finish(). */
export class WalkRecord {
  /** Instruction length by address; `order` and `lens` list the addresses and lengths as they were first walked. */
  readonly insns = new InsnIndex();
  private readonly order: Addr[] = [];
  private readonly lens: number[] = [];
  /** Whether an instruction was dropped (trailing padding): `order` may then name addresses `insns` lacks. */
  private dropped = false;
  readonly pools = new Map<Addr, number>();
  readonly poolOrder: PoolWord[] = [];
  readonly tables: JumpTable[] = [];
  readonly calls: CallSite[] = [];
  readonly blSites: BlSite[] = [];
  readonly deadEnd: Addr[] = [];
  readonly balance: number[] = [];
  readonly errors: ReadingError[] = [];
  readonly veneers: Addr[] = [];
  readonly adrs: Addr[] = [];
  readonly tails: Addr[] = [];
  readonly exits: Exit[] = [];
  readonly branchTargets: Addr[] = [];
  readonly armTails: Span[] = [];
  readonly entry: Addr;
  readonly mode: Mode;
  returns = 0;
  tailExits = 0;

  constructor(entry: Addr, mode: Mode) {
    this.entry = entry;
    this.mode = mode;
  }

  /** Records an instruction. */
  insn(addr: Addr, len: number): void {
    this.insns.set(addr, len);
    this.order.push(addr);
    this.lens.push(len);
  }

  /** Drops a recorded instruction (trailing padding at a stop). */
  drop(addr: Addr): void {
    this.insns.delete(addr);
    this.dropped = true;
  }

  /** The instructions still recorded (padding may have been dropped), sorted by address. */
  private sortedInsns(): InsnSpan[] {
    const order = this.order;
    let ascending = !this.dropped;
    for (let i = 1; ascending && i < order.length; i++) if ((order[i] as Addr) <= (order[i - 1] as Addr)) ascending = false;
    // A single straight path walks in ascending order with nothing dropped: the walk order is the answer.
    if (ascending) return order.map((addr, i) => ({ addr, len: this.lens[i] ?? 0 }));
    const addrs = order.filter((a) => this.insns.has(a)).sort((a, b) => a - b);
    const out: InsnSpan[] = [];
    for (let i = 0; i < addrs.length; i++) {
      const addr = addrs[i] as Addr;
      if (i > 0 && addrs[i - 1] === addr) continue;
      out.push({ addr, len: this.insns.get(addr) ?? 0 });
    }
    return out;
  }

  /** Records a pool word once, keeping the first load's position (the PoC's Map.set). */
  pool(addr: Addr, value: number): void {
    if (this.pools.has(addr)) return;
    this.pools.set(addr, value);
    this.poolOrder.push({ addr, value });
  }

  exit(at: Addr, kind: Exit['kind'], rule: RuleId): void {
    this.exits.push({ at, kind, rule });
  }

  /** The immutable reading; `extra` adds what the settle loop decided. */
  finish(env: WalkEnv, extra: Pick<ReadingParts, 'far' | 'noret' | 'blVerdicts'> = {}): Reading {
    const insns = this.sortedInsns();
    const shape: ReadingShape = { entry: this.entry, codeEnd: codeEndOf(this.entry, insns), pools: this.poolOrder.map((p) => p.addr), tables: this.tables, armTails: this.armTails };
    return makeReading(
      {
        entry: this.entry,
        mode: this.mode,
        insns,
        pools: this.poolOrder,
        tables: this.tables,
        calls: this.calls,
        blSites: this.blSites,
        deadEnd: this.deadEnd,
        balance: this.balance,
        returns: this.returns,
        errors: this.errors,
        veneers: this.veneers,
        adrs: this.adrs,
        tails: this.tails,
        tailExits: this.tailExits,
        exits: this.exits,
        branchTargets: this.branchTargets,
        armTails: this.armTails,
        ...extra,
        end: env.extentEnd(shape),
      },
      env.view.rom,
      this.insns,
    );
  }
}
