// The mutable record of one walk (both walkers fill it), turned into an immutable Reading by finish().
import type { Addr, Mode, Span } from '../../../foundation/rom/span.ts';
import type { BlSite } from '../../profile/types.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { LIMITS } from '../limits.ts';
import { codeEndOf, makeReading } from '../reading.ts';
import type {
  CallSite,
  Exit,
  InsnSpan,
  JumpTable,
  PoolWord,
  Reading,
  ReadingError,
  ReadingShape,
  WalkDecision,
  WalkStep,
} from '../types.ts';
import type { WalkEnv } from './cursor.ts';
import { InsnIndex } from './insn-index.ts';

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
  readonly steps: WalkDecision[] = [];
  readonly entry: Addr;
  readonly mode: Mode;
  private readonly trace: boolean;
  returns = 0;
  tailExits = 0;

  constructor(entry: Addr, mode: Mode, trace = false) {
    this.entry = entry;
    this.mode = mode;
    this.trace = trace;
  }

  /** Records a walk-slot answer the walk applies at `at` (only when traced). */
  step(at: Addr, rule: RuleId, step: WalkStep): void {
    if (this.trace) this.steps.push({ at, rule, step: step.step });
  }

  /**
   * Whether the walk stops at `at`: a 'zero-run' error when the current path has run over more than
   * LIMITS.zeroRun consecutive zero instructions (the path ends), a 'walk-limit' error when the walk has
   * recorded LIMITS.walkInsns instructions (the walk ends).
   */
  limited(at: Addr, zeros: number): 'path' | 'walk' | undefined {
    if (zeros > LIMITS.zeroRun) {
      this.errors.push({ reason: 'zero-run', at });
      return 'path';
    }
    if (this.order.length < LIMITS.walkInsns) return undefined;
    this.errors.push({ reason: 'walk-limit', at });
    return 'walk';
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

  /** The immutable reading (the settle loop adds its verdicts with reading.ts's withVerdicts). */
  finish(env: WalkEnv): Reading {
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
        steps: this.steps,
        end: env.extentEnd(shape),
      },
      env.view.rom,
      this.insns,
    );
  }
}
