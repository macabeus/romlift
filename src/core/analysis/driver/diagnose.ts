// Why a known function was missed (the PoC's diagnoseMiss, romlift-poc/src/score.ts), asked at the
// final state of a run: inside claimed bytes (with the claim kind and the owner); an ARM routine nothing
// reached; the first failing validity rule; or valid but unanchored, with the anchor evidence.
import type { Rom } from '../../../foundation/rom/rom.ts';
import type { Addr, Mode } from '../../../foundation/rom/span.ts';
import { hexAddr } from '../../../foundation/util/hex.ts';
import type { CompilerProfile } from '../../profile/types.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import type { TrailSink } from '../../provenance/trail.ts';
import type { MissReason } from '../../provenance/vocabulary.ts';
import { pointersTo } from '../pointers.ts';
import { Claim } from '../types.ts';
import type { AnalysisOptions, AnalysisResult, AnalysisTuning, ClaimKind, RuleRegistry } from '../types.ts';
import { anchoredAtEnd, anchoredAtStart } from '../walk/predicates.ts';
import { RULES } from './rules.ts';
import { ownerOf } from './facts.ts';
import { resultOf, runDriver } from './run.ts';
import { settle } from './settle.ts';
import { claimAt, createDriver } from './state.ts';
import type { DriverState } from './state.ts';
import { whyInvalid } from './validity.ts';

/** A function the run missed, as the caller knows it (from an ELF). */
export interface MissQuery {
  readonly addr: Addr;
  readonly mode: Mode;
}

export interface MissDiagnosis {
  readonly addr: Addr;
  readonly mode: Mode;
  readonly reason: MissReason;
  /** The rule that decided it, when one did. */
  readonly rule?: RuleId;
  readonly claim?: ClaimKind;
  readonly owner?: Addr;
  readonly detail: string;
}

/** How a diagnosis names the claimed bytes a miss lies in; total over the claim kinds, so a new kind fails to typecheck here. */
const CLAIMED_AS: Readonly<Record<ClaimKind, string>> = {
  [Claim.free]: 'free bytes',
  [Claim.code]: 'code',
  [Claim.pool]: 'a literal pool',
  [Claim.table]: 'a jump table',
  [Claim.dead]: 'dead bytes',
  [Claim.padding]: 'padding',
  [Claim.data]: 'data',
};

/** The id of the first rule of the run that emits `reason`. */
function ruleFor(s: DriverState, reason: MissReason): RuleId | undefined {
  const valid = s.rules.validity.find((v) => v.rule.reason === reason);
  if (valid !== undefined) return valid.id;
  const { thumb, arm, after } = s.rules.gap.forward;
  const gap = [thumb, arm, ...after].find((g) => g?.rule.reason === reason);
  if (gap !== undefined) return gap.id;
  return s.rules.veto.find((v) => v.rule.reason === reason)?.id;
}

/** The diagnosis of one miss at the final state of `s`. */
export function diagnoseMiss(s: DriverState, miss: MissQuery): MissDiagnosis {
  const { addr, mode } = miss;
  const c = claimAt(s, addr);
  const base = { addr, mode };
  const rule = (reason: MissReason): { readonly rule?: RuleId } => {
    const id = ruleFor(s, reason);
    return id === undefined ? {} : { rule: id };
  };
  if (c !== Claim.free) {
    const owner = ownerOf(s, addr);
    return {
      ...base,
      reason: 'inside-code',
      ...rule('inside-code'),
      claim: c,
      ...(owner === undefined ? {} : { owner }),
      detail: owner === undefined ? `inside ${CLAIMED_AS[c]} no accepted function owns` : `inside ${CLAIMED_AS[c]} of the accepted function at ${hexAddr(owner)}`,
    };
  }
  if (mode === 'arm') {
    return { ...base, reason: 'arm-unreached', ...rule('arm-unreached'), detail: 'ARM routine never reached: not a bl, adr or veneer target of accepted code, and no ARM gap scan took it' };
  }
  const failure = whyInvalid(s, addr);
  if (failure !== undefined) return { ...base, reason: failure.reason, rule: failure.rule, detail: `fails validity: ${failure.detail}` };
  const r = settle(s, addr);
  const refs = pointersTo(s.pointers, addr).length;
  const evidence = [
    anchoredAtStart(addr, s.view) ? 'anchored at start' : 'not anchored at start',
    s.profile.idioms.isPrologue(s.rom, addr, 'thumb') ? 'has push {.., lr}' : 'no push {.., lr}',
    anchoredAtEnd(r, s.view) ? 'anchored at end' : 'not anchored at end',
    refs > 0 ? `${refs} data word(s) point at it` : 'nothing points at it',
  ];
  // A gap candidate an accept veto rejected names that veto (its rejection is recorded under the veto's id).
  const vetoed = s.rejections.get(`${addr}:${mode}`);
  const veto = vetoed !== undefined && s.rules.veto.some((v) => v.id === vetoed.rule) ? vetoed : undefined;
  if (veto !== undefined) return { ...base, reason: 'unanchored', rule: veto.rule, detail: `valid but vetoed by ${veto.rule}: ${veto.detail}; ${evidence.join(', ')}` };
  return { ...base, reason: 'unanchored', detail: `valid but not accepted: ${evidence.join(', ')}` };
}

/**
 * Runs the analysis, then diagnoses each miss at its final state (internal: the bench's scoring). The
 * result is the one analyzeTuned returns; the diagnoses follow `misses` in order.
 */
export function diagnoseMisses(
  rom: Rom,
  profile: CompilerProfile,
  options: AnalysisOptions,
  tuning: AnalysisTuning,
  misses: readonly MissQuery[],
  rules: RuleRegistry = RULES,
  sink?: TrailSink,
): { readonly result: AnalysisResult; readonly diagnoses: readonly MissDiagnosis[] } {
  const s = createDriver(rom, profile, options, tuning, rules, sink);
  const result = resultOf(s, runDriver(s));
  return { result, diagnoses: misses.map((m) => diagnoseMiss(s, m)) };
}
