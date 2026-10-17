// The diagnostic mechanism (D45): the Diagnostic shape, code tables and the one error core may throw.
// The codes themselves live in each raising module's codes.ts, never here.
import type { Addr, Span } from '../rom/span.ts';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic<C extends string = string> {
  readonly code: C;
  readonly severity: Severity;
  readonly addr?: Addr;
  readonly span?: Span;
  readonly path?: string;
  readonly message: string;
  /** The addresses the decision read. */
  readonly cites?: readonly Addr[];
  /** The RuleId that raised it, as text. */
  readonly rule?: string;
}

/** One entry of a module's code table: its fixed severity and a one-line meaning. */
export interface CodeSpec {
  readonly severity: Severity;
  readonly meaning: string;
}

/** The optional location and provenance fields of a diagnostic. */
export interface DiagnosticExtra {
  readonly addr?: Addr;
  readonly span?: Span;
  readonly path?: string;
  readonly cites?: readonly Addr[];
  readonly rule?: string;
}

/** Declares a module's code table; the identity function, kept for the literal types it infers. */
export function defineCodes<const T extends Record<string, CodeSpec>>(codes: T): T {
  return codes;
}

/** Builds a diagnostic whose severity is the one its code table fixes for `code`. */
export function diagnostic<C extends string>(
  codes: Readonly<Record<C, CodeSpec>>,
  code: NoInfer<C>,
  message: string,
  extra: DiagnosticExtra = {},
): Diagnostic<C> {
  const spec: CodeSpec = codes[code];
  return {
    code,
    severity: spec.severity,
    message,
    ...(extra.addr === undefined ? {} : { addr: extra.addr }),
    ...(extra.span === undefined ? {} : { span: { start: extra.span.start, end: extra.span.end } }),
    ...(extra.path === undefined ? {} : { path: extra.path }),
    ...(extra.cites === undefined ? {} : { cites: [...extra.cites] }),
    ...(extra.rule === undefined ? {} : { rule: extra.rule }),
  };
}

/** A broken internal invariant: a bug in romlift, never a property of the input (exit code 70). */
export class RomliftInvariantError extends Error {
  override readonly name = 'RomliftInvariantError';
}
