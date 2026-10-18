// The paths check of the text-layout pass (architecture §6.2, §6.4, D49): no two entries of the emission
// stream are the same file, exactly or on a case-insensitive file system (macOS and Windows by default),
// where `asm/nonmatchings/main/VBlankCB.s` and `.../VblankCB.s` are one file and the second write would
// replace the first. One pass over the paths, holding one folded key per path; every collision is
// E_PATH_CASE_COLLISION naming both paths.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { checkResult } from './report.ts';
import type { CheckResult } from './report.ts';
import { VerifyCodes } from './codes.ts';

/** The key two paths share when a case-insensitive file system takes them for one file. */
export function foldPath(path: string): string {
  return path.toLowerCase();
}

function scan(paths: Iterable<string>): { readonly diagnostics: readonly Diagnostic[]; readonly count: number } {
  const seen = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  let count = 0;
  for (const path of paths) {
    count++;
    const key = foldPath(path);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, path);
      continue;
    }
    const message =
      first === path ? `the stream emits ${path} twice` : `${first} and ${path} are one file on a case-insensitive file system`;
    diagnostics.push(diagnostic(VerifyCodes, 'E_PATH_CASE_COLLISION', message, { path }));
  }
  return { diagnostics, count };
}

/** Every duplicate and case-folded collision among `paths`, in stream order (the later path of each pair). */
export function checkPaths(paths: Iterable<string>): readonly Diagnostic[] {
  return scan(paths).diagnostics;
}

/** The 'paths' CheckResult of a stream's paths. */
export function pathsCheck(paths: Iterable<string>): CheckResult {
  const { diagnostics, count } = scan(paths);
  const detail = diagnostics[0]?.message ?? `${count} paths, no two of them one file`;
  return checkResult('paths', diagnostics, diagnostics.length > 1 ? `${detail} (${diagnostics.length} collisions in all)` : detail);
}
