// The human-readable reporter: one line per diagnostic and one summary line, with addresses spelt by
// `hexAddr` like every other output.
import { compareCodeUnits, hexAddr } from '../../api/rom.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { RunSummary } from '../exit-codes.ts';

/** `code severity [addr] [start..end] [path]: message`, the location parts present only when set. */
export function formatDiagnosticText(d: Diagnostic): string {
  const parts: string[] = [d.code, d.severity];
  if (d.addr !== undefined) parts.push(hexAddr(d.addr));
  if (d.span !== undefined) parts.push(`${hexAddr(d.span.start)}..${hexAddr(d.span.end)}`);
  if (d.path !== undefined) parts.push(d.path);
  return `${parts.join(' ')}: ${d.message}`;
}

/** `ok (exit 0)` or `failed (exit N)`, then the counts sorted by key: `failed (exit 1): error 2, warning 1`. */
export function formatSummaryText(summary: RunSummary): string {
  const head = `${summary.ok ? 'ok' : 'failed'} (exit ${summary.exitCode})`;
  if (summary.counts === undefined) return head;
  const counts = summary.counts;
  const keys = Object.keys(counts).sort(compareCodeUnits);
  if (keys.length === 0) return head;
  return `${head}: ${keys.map((key) => `${key} ${counts[key] ?? 0}`).join(', ')}`;
}

/** Rows of cells as lines, every column but the last padded to its widest cell plus two spaces. */
export function columns(rows: readonly (readonly string[])[], indent = ''): string {
  return [...columnLines(rows.length, (k) => rows[k] ?? [], indent)].join('');
}

/**
 * columns' lines one at a time, for a table too large to hold whole: row `k` of `count` is built by `rowAt(k)` twice,
 * once for the column widths and once to print it, so no more than one row is ever held.
 */
export function* columnLines(count: number, rowAt: (k: number) => readonly string[], indent = ''): Generator<string> {
  const widths: number[] = [];
  for (let k = 0; k < count; k++) rowAt(k).forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  for (let k = 0; k < count; k++) {
    const row = rowAt(k);
    yield `${indent}${row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  ')}`.trimEnd() +
      '\n';
  }
}
