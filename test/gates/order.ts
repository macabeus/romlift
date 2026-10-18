// The one code-unit order of the gates (AGENTS.md, Determinism): every gate file and verdict module sorts
// names with it; gate.ts re-exports it for the gate files.

/** Code-unit order of two strings, never localeCompare. */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
