// The check of g2.poc-parity (architecture §4.5 milestone M1, §13), in one place: the gate runs it before
// phase 2 lands and after, when the gate is historical (gate.ts gateStep), so raising phase.json can only
// freeze a gate whose own check passes (gate-honesty-r2-1). It is pure: the committed
// evidence (bench/results.json `parity`), the committed digests (bench/baseline/poc-digests.json), the
// tuning datasets, the ROMs the owner scoped out and whether the evidence's commit is an ancestor of HEAD
// in, problems and notes out; test/unit/gates/poc-parity-check.test.ts tests it.
//
// Scope (D61 c): the owner's answer to Q1 of phase-2.md scopes tmc out ("Keep tmc as 99.94%. It's a
// benchmark row that we can improve later"): its M1 evidence cannot exist (the lockstep ran under the
// `poc-lifo` worklist, deleted in phase 2, before tmc was revealed). Every other tuning ROM is judged as
// before: parity digest equal to the PoC's, rows equal to the PoC baseline, every lockstep set followed. The
// scoping is bound to the ROM and ELF it was decided on (dataset-binding.ts): for another build of that
// name it is stale and fails, and the ROM is judged as without it.

import { bindingMismatch, byCodeUnit, TMC_AT_D61, type DatasetBinding } from './dataset-binding.ts';

export interface LockstepSet {
  readonly set: string;
  readonly queries: number;
  readonly matched: number;
  readonly skipped: number;
  readonly parityDigest: string | null;
  readonly divergence: { readonly seq: number; readonly kind: string; readonly detail: string } | null;
}

/** bench/results.json `parity` (romlift-bench/parity-evidence@1). */
export interface ParityEvidence {
  readonly schema: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly worklist: string;
  readonly pocSourceDigest: string;
  readonly roms: Readonly<Record<string, { readonly digest: string; readonly expected: string; readonly rowDiffs: number; readonly lockstep: readonly LockstepSet[] }>>;
}

/** bench/baseline/poc-digests.json. */
export interface PocDigests {
  readonly pocSourceDigest: string;
  readonly roms: Readonly<Record<string, string>>;
}

export const LOCKSTEP_SETS = ['driver', 'walk+bl+claim', 'seed+valid+accept', 'gap+region', 'all'] as const;

/**
 * Tuning ROMs the owner has scoped out of g2.poc-parity, each with the decision that did so: tmc, by the
 * owner's answer to Q1 of phase-2.md on 18 October 2026 (D61 c).
 */
export const SCOPED_OUT: Readonly<Record<string, ScopedOut>> = {
  tmc: {
    decision: 'D61 c',
    reason: 'not applicable, no M1 lockstep run (the owner\'s answer to Q1 on 2026-10-18, D61 c: "Keep tmc as 99.94%. It\'s a benchmark row that we can improve later")',
    rom: TMC_AT_D61,
  },
};

/** A tuning ROM scoped out of the gate: the decision, the line printed for it, the dataset it was decided on. */
export interface ScopedOut {
  readonly decision: string;
  readonly reason: string;
  readonly rom: DatasetBinding;
}

/** A tuning dataset as the check reads it. */
export interface TuningRom {
  readonly name: string;
  readonly sha1: string;
  readonly elfSha256?: string | undefined;
}

export interface ParityInput {
  readonly evidence: ParityEvidence | undefined;
  readonly digests: PocDigests;
  readonly tuning: readonly TuningRom[];
  readonly scopedOut: Readonly<Record<string, ScopedOut>>;
  /** Whether the evidence's commit is an ancestor of HEAD (`git merge-base --is-ancestor`). */
  readonly ancestor: boolean;
}

export interface ParityOutcome {
  readonly problems: readonly string[];
  /** One line per scoped-out ROM, `<rom>: <reason>`, printed every time. */
  readonly notApplicable: readonly string[];
  /** The ROMs judged, in input order. */
  readonly judged: readonly string[];
  /** The parity digest of each judged ROM, for the gate record. */
  readonly digests: Readonly<Record<string, string>>;
}

/** The whole check of g2.poc-parity on its scope: every tuning ROM the owner did not scope out. */
export function parityCheck(input: ParityInput): ParityOutcome {
  const { evidence: e, digests, tuning, scopedOut } = input;
  const problems: string[] = [];
  const notApplicable: string[] = [];
  const judged: string[] = [];
  const found: Record<string, string> = {};
  for (const name of Object.keys(scopedOut).sort(byCodeUnit)) {
    if (!tuning.some((t) => t.name === name)) problems.push(`${name} is scoped out but is not a tuning dataset (the scoping is stale)`);
  }
  if (e === undefined) return { problems: [...problems, 'bench/results.json holds no parity evidence'], notApplicable, judged, digests: found };
  if (e.schema !== 'romlift-bench/parity-evidence@1' || e.worklist !== 'poc-lifo') problems.push(`the parity evidence is ${e.schema} under ${e.worklist}`);
  if (!input.ancestor) problems.push(`the evidence names commit ${e.commit}, which is not an ancestor of HEAD`);
  if (e.pocSourceDigest !== digests.pocSourceDigest) problems.push(`the evidence pins PoC source ${e.pocSourceDigest}, poc-digests.json ${digests.pocSourceDigest}`);
  for (const dataset of tuning) {
    const name = dataset.name;
    const scoped = scopedOut[name];
    const unbound = scoped === undefined ? undefined : bindingMismatch(name, scoped.decision, scoped.rom, dataset);
    if (unbound !== undefined) problems.push(unbound);
    else if (scoped !== undefined) {
      notApplicable.push(`${name}: ${scoped.reason}`);
      continue;
    }
    judged.push(name);
    const rom = e.roms[name];
    const want = digests.roms[name];
    if (rom === undefined || want === undefined) {
      problems.push(`${name}: no ${[rom === undefined ? 'parity evidence' : undefined, want === undefined ? 'committed PoC digest' : undefined].filter((x) => x !== undefined).join(' and no ')}`);
      continue;
    }
    found[name] = rom.digest;
    if (rom.digest !== want || rom.expected !== want) problems.push(`${name}: parity digest ${rom.digest}, the PoC's is ${want}`);
    if (rom.rowDiffs !== 0) problems.push(`${name}: ${rom.rowDiffs} rows differed from the PoC baseline`);
    for (const set of LOCKSTEP_SETS) {
      const s = rom.lockstep.find((l) => l.set === set);
      if (s === undefined) problems.push(`${name}: no lockstep ${set}`);
      else if (s.divergence !== null) problems.push(`${name}: lockstep ${set} diverges at seq ${s.divergence.seq} (${s.divergence.kind}): ${s.divergence.detail}`);
      else if (s.parityDigest !== want || s.matched + s.skipped !== s.queries) problems.push(`${name}: lockstep ${set} ends at ${s.parityDigest ?? 'none'} with ${s.matched} + ${s.skipped} of ${s.queries} records`);
    }
  }
  return { problems, notApplicable, judged, digests: found };
}
