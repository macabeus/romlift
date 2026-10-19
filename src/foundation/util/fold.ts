// The key two paths share where a case-insensitive file system (macOS and Windows by default) takes them for one
// file. The paths check (core/verify/paths.ts) refuses two such paths in one tree; the write plan
// (core/write-plan/plan-writes.ts) orders a case-only rename between runs so the delete of the old spelling
// cannot remove the new one.

/** The folded key of a project path (ASCII case: generated paths are ASCII). */
export function foldPath(path: string): string {
  return path.toLowerCase();
}
