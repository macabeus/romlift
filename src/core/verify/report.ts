// The verify report (architecture §2.1, §6.4, D49, D62): one result per self-check, and the report
// the gates read and `generate` gates on. The checks themselves are p3-data-verify's (wave 2), with these
// signatures:
//
//   verifyModel(rom: Rom, model: Model): VerifyReport
//     core/verify/{tiling,reencode,module-size}.ts: every byte in exactly one item (E_SELF_CHECK_TILING),
//     every mnemonic round-trips (E_SELF_CHECK_REENCODE), each module's items add up to its span
//     (E_MODULE_SIZE); one CheckResult each, ids 'tiling', 'reencode', 'module-size'.
//   checkEntries(rom: Rom, model: Model, entries: Iterable<FileEntry>): VerifyReport
//     core/verify/text-layout.ts: the text-layout check of a streamed emission, one entry at a time
//     (E_SELF_CHECK_TEXT with path, line and address), so the check pass keeps no tree, and the paths check of the
//     same pass; the 'text-layout' and 'paths' CheckResults.
//   checkPaths(paths: Iterable<string>): readonly Diagnostic[]
//     core/verify/paths.ts: duplicates and case-folded collisions among the stream's paths
//     (E_PATH_CASE_COLLISION); the 'paths' CheckResult.
//
// 'assemble' and 'link' are the shell's toolchain checks (runToolchainChecks' assemble and link).
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';

export type CheckId = 'tiling' | 'reencode' | 'module-size' | 'text-layout' | 'paths' | 'assemble' | 'link';

/** Every check, in the order a report lists them. */
export const CHECK_IDS: readonly CheckId[] = ['tiling', 'reencode', 'module-size', 'text-layout', 'paths', 'assemble', 'link'];

export interface CheckResult {
  readonly id: CheckId;
  /** No error-severity diagnostic. */
  readonly ok: boolean;
  /** One line for people: what was checked, or the first failure. */
  readonly detail: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface VerifyReport {
  /** Every check ok. */
  readonly ok: boolean;
  /** At most one per id, in CHECK_IDS order. */
  readonly checks: readonly CheckResult[];
}

/** A check's result from its diagnostics: ok when none is an error; `detail` describes it either way. */
export function checkResult(id: CheckId, diagnostics: readonly Diagnostic[], detail: string): CheckResult {
  return { id, ok: !diagnostics.some((d) => d.severity === 'error'), detail, diagnostics };
}

function merge(results: readonly CheckResult[]): CheckResult | undefined {
  const [first, ...rest] = results;
  if (first === undefined) return undefined;
  if (rest.length === 0) return first;
  const failed = results.filter((r) => !r.ok);
  return {
    id: first.id,
    ok: failed.length === 0,
    detail: (failed.length > 0 ? failed : results).map((r) => r.detail).join('; '),
    diagnostics: results.flatMap((r) => r.diagnostics),
  };
}

/**
 * One report from several (the model checks, the streamed text-layout and paths checks, the toolchain
 * checks): checks in CHECK_IDS order; two results of one id merge (ok only if both are, their diagnostics
 * concatenated in argument order, the failing details joined).
 */
export function combineReports(...reports: readonly VerifyReport[]): VerifyReport {
  const all = reports.flatMap((r) => r.checks);
  const checks: CheckResult[] = [];
  for (const id of CHECK_IDS) {
    const merged = merge(all.filter((c) => c.id === id));
    if (merged !== undefined) checks.push(merged);
  }
  return { ok: checks.every((c) => c.ok), checks };
}
