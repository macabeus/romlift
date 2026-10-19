// What a project path is (architecture §6.4): every path a tree emits, a manifest or journal names, or an op
// writes must be one, so no write can leave the project directory. The write plan refuses any other path
// (core/write-plan), and the paths check (core/verify/paths.ts) refuses a tree that emits one, so a tree that
// passes its checks never reaches that refusal.

/**
 * Whether `path` is a normalised project-relative path: '/'-separated, not absolute, no empty, '.' or '..'
 * segment, no backslash or NUL.
 */
export function isProjectPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}
