// The `--json` reporter (architecture §2.1, §9.1): one canonical JSON object per line, keys sorted by
// code unit, each line ending in '\n'. A command prints its diagnostics, its own records (e.g. doctor's
// `{"type":"check",...}`) and, last, one summary object.
import { canonicalJson } from '../../api/formats.ts';
import type { JsonValue } from '../../api/formats.ts';
import { hexAddr, RomliftInvariantError } from '../../api/rom.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { RunSummary } from '../exit-codes.ts';

/** The members of one record, besides its `type`. */
export type RecordFields = { readonly [key: string]: JsonValue | undefined };

/** One NDJSON line: `{"type":<type>, ...fields}` in canonical JSON, then '\n'. */
export function recordLine(type: string, fields: RecordFields): string {
  if (Object.hasOwn(fields, 'type')) throw new RomliftInvariantError(`NDJSON record '${type}' has its own type field`);
  return `${[...canonicalJson({ ...fields, type })].join('')}\n`;
}

/** A diagnostic as a `diagnostic` record; addresses are `hexAddr` strings. */
export function diagnosticLine(d: Diagnostic): string {
  return recordLine('diagnostic', {
    code: d.code,
    severity: d.severity,
    message: d.message,
    addr: d.addr === undefined ? undefined : hexAddr(d.addr),
    span: d.span === undefined ? undefined : { start: hexAddr(d.span.start), end: hexAddr(d.span.end) },
    path: d.path,
    cites: d.cites?.map(hexAddr),
    rule: d.rule,
  });
}

/** The last line of a `--json` run. */
export function summaryLine(summary: RunSummary): string {
  return recordLine('summary', { ok: summary.ok, exitCode: summary.exitCode, counts: summary.counts });
}
