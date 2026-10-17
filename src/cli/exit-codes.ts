// The process exit codes of every command (architecture §2.1, D33). `errors` covers error-level
// diagnostics (a refused write, a locked project); `verifyFailed` a failed self-check or SHA-1;
// `internal` an invariant violation, which is a bug.
export const ExitCode = { ok: 0, errors: 1, usage: 2, verifyFailed: 3, internal: 70 } as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
