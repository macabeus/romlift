// The walk cursor a WalkPolicy reads (architecture §4.1), the environment both walkers share (the view,
// the resolved walk slot, the extent rule), and asking the walk slot.
import type { Flow, Insn } from '../../../foundation/isa/types.ts';
import type { Addr, Mode } from '../../../foundation/rom/span.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { toLoad } from '../address-map.ts';
import type { AddressMap } from '../address-map.ts';
import type { AnalysisView, ReadingShape, WalkPolicy, WalkStep } from '../types.ts';

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
  /** The current path's straight-line run of instructions, the one asked about last (decoded when read). */
  readonly run: readonly Insn[];
  /** The k-th instruction before the last of the run (0: the last), decoding only that one. */
  back(k: number): Insn | undefined;
  /** Thumb bcc, or an ARM condition other than AL. */
  readonly conditional: boolean;
  /** Whether `a` was already walked as an instruction of this reading. */
  walked(a: Addr): boolean;
}

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
  /** Record the walk slot's answers in Reading.steps (a trail is on); off, the walk records none. */
  readonly trace?: boolean;
}

/** The cursor a walker fills in place before each ask; `run` is built only when a rule reads it. */
export type MutableCursor = { -readonly [K in Exclude<keyof WalkCursor, 'run' | 'back'>]: WalkCursor[K] } & Pick<WalkCursor, 'run' | 'back'>;

/** A cursor for one walk of `entry`; `run` and `back` decode the current path's run (its addresses, `runAddrs()`) on demand. */
export function walkCursor(view: AnalysisView, entry: Addr, mode: Mode, walked: (a: Addr) => boolean, runAddrs: () => readonly Addr[], decodeAt: (a: Addr) => Insn): MutableCursor {
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
      return runAddrs().map(decodeAt);
    },
    back(k) {
      const addrs = runAddrs();
      const a = addrs[addrs.length - 1 - k];
      return a === undefined ? undefined : decodeAt(a);
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

