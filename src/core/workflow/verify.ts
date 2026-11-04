// The verify workflow (architecture §2.1, §6.4, D36, D49): which toolchain checks a run of the tree checks makes (the gates and the bench, D108), whether they
// run at all, the units each one is given, and the report the run prints. Pure: the shell's runner
// (shell/project/verify-run.ts) writes the tree, finds binutils and runs `as` and `ld` as this plan says, and
// decides nothing (final-review architecture-1: the composition used to live in the CLI, which D36 rejects).
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { assembleUnits, buildUnits } from '../model/paths.ts';
import type { AssembleUnit, BuildUnit } from '../model/paths.ts';
import { combineReports } from '../verify/report.ts';
import type { CheckId, CheckResult, VerifyReport } from '../verify/report.ts';
import type { GenerateResult } from './generate.ts';
import { writable } from './generate.ts';

/** The toolchain checks a run asks for: `--assemble` and `--link`. */
export interface ToolchainFlags {
  readonly assemble: boolean;
  readonly link: boolean;
}

/** What the toolchain part of a run adds: its checks and the linked image's SHA-1. */
export interface ToolchainOutcome {
  readonly checks: readonly CheckResult[];
  readonly sha1?: string;
}

/** The plan of a run's toolchain part: nothing to run, checks reported as not run, or the units to assemble and link. */
export type ToolchainPlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'not-run'; readonly outcome: ToolchainOutcome }
  | { readonly kind: 'run'; readonly ids: readonly CheckId[]; readonly assemble?: readonly AssembleUnit[]; readonly link?: readonly BuildUnit[] };

/** The toolchain checks a run asks for, in CHECK_IDS order. */
export function toolchainIds(flags: ToolchainFlags): readonly CheckId[] {
  return [...(flags.assemble ? (['assemble'] as const) : []), ...(flags.link ? (['link'] as const) : [])];
}

/** A check that did not run, with why. */
export function notRun(id: CheckId, detail: string, diagnostics: readonly Diagnostic[] = []): CheckResult {
  return { id, ok: false, detail, diagnostics };
}

/** Every one of `ids` reported as not run, with one detail and the diagnostics that stopped it. */
export function notRunOutcome(ids: readonly CheckId[], detail: string, diagnostics: readonly Diagnostic[] = []): ToolchainOutcome {
  return { checks: ids.map((id) => notRun(id, detail, diagnostics)) };
}

/**
 * The toolchain plan of a generate result: none asked for; not run while a self-check or the model fails (a write
 * follows a passing check pass, §6.4); else the model's units, in link order, for each check asked for.
 */
export function toolchainPlan(result: Pick<GenerateResult, 'model' | 'report' | 'diagnostics'>, flags: ToolchainFlags): ToolchainPlan {
  const ids = toolchainIds(flags);
  if (ids.length === 0) return { kind: 'none' };
  if (!writable(result)) return { kind: 'not-run', outcome: notRunOutcome(ids, 'not run: nothing is written while a self-check or the model fails') };
  return {
    kind: 'run',
    ids,
    ...(flags.assemble ? { assemble: assembleUnits(result.model) } : {}),
    ...(flags.link ? { link: buildUnits(result.model) } : {}),
  };
}

/** The report a run prints: the check pass's, then the toolchain checks, ok only when every toolchain check is. */
export function verifyReport(result: Pick<GenerateResult, 'report'>, toolchain: ToolchainOutcome): VerifyReport {
  return combineReports(result.report, { ok: toolchain.checks.every((c) => c.ok), checks: toolchain.checks });
}
