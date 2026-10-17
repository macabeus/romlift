// The process exit codes of every command (architecture §2.1, D33). `errors` covers error-level
// diagnostics (a refused write, a locked project); `verifyFailed` a failed self-check or SHA-1;
// `internal` an invariant violation, which is a bug.
export const ExitCode = { ok: 0, errors: 1, usage: 2, verifyFailed: 3, internal: 70 } as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

// Helpers.

const EXIT_CODES: ReadonlySet<number> = new Set(Object.values(ExitCode));

/** Whether `value` is one of the five exit codes. */
export function isExitCode(value: unknown): value is ExitCode {
  return typeof value === 'number' && EXIT_CODES.has(value);
}

/** The outcome a command reports last: the summary object of NDJSON output and the text summary line. */
export interface RunSummary {
  readonly ok: boolean;
  readonly exitCode: ExitCode;
  readonly counts?: Readonly<Record<string, number>>;
}
