// The paths check of the text-layout pass (architecture §6.2, §6.4, D49): no two entries of the emission
// stream are the same file, exactly or on a case-insensitive file system (macOS and Windows by default),
// where `asm/nonmatchings/main/VBlankCB.s` and `.../VblankCB.s` are one file and the second write would
// replace the first; and no component of a path is longer than a file system stores (255 bytes per name), so
// the write cannot fail part-way. One pass over the paths, holding one folded key per path; every collision is
// E_PATH_CASE_COLLISION naming both paths, every overlong component E_PATH_TOO_LONG.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { foldPath } from '../../foundation/util/fold.ts';
import { checkResult } from './report.ts';
import type { CheckResult } from './report.ts';
import { VerifyCodes } from './codes.ts';

export { foldPath } from '../../foundation/util/fold.ts';

/** The most bytes a file system stores in one file or directory name (ext4, APFS, NTFS in UTF-16 units). */
export const MAX_NAME_BYTES = 255;

const utf8 = new TextEncoder();

/** The first component of `path` longer than MAX_NAME_BYTES in UTF-8, with its length, or undefined. */
function overlongComponent(path: string): { readonly name: string; readonly bytes: number } | undefined {
  for (const name of path.split('/')) {
    const bytes = name.length > MAX_NAME_BYTES / 3 ? utf8.encode(name).length : name.length;
    if (bytes > MAX_NAME_BYTES) return { name, bytes };
  }
  return undefined;
}

function scan(paths: Iterable<string>): { readonly diagnostics: readonly Diagnostic[]; readonly count: number } {
  const seen = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  let count = 0;
  for (const path of paths) {
    count++;
    const long = overlongComponent(path);
    if (long !== undefined) {
      diagnostics.push(diagnostic(VerifyCodes, 'E_PATH_TOO_LONG', `${path}: the name ${long.name.slice(0, 32)}… is ${long.bytes} bytes, more than the ${MAX_NAME_BYTES} a file system stores`, { path }));
    }
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

/** Every duplicate and case-folded collision among `paths` (the later path of each pair) and every overlong name, in stream order. */
export function checkPaths(paths: Iterable<string>): readonly Diagnostic[] {
  return scan(paths).diagnostics;
}

/** The 'paths' CheckResult of a stream's paths. */
export function pathsCheck(paths: Iterable<string>): CheckResult {
  const { diagnostics, count } = scan(paths);
  const detail = diagnostics[0]?.message ?? `${count} paths, no two of them one file`;
  return checkResult('paths', diagnostics, diagnostics.length > 1 ? `${detail} (${diagnostics.length} problems in all)` : detail);
}
