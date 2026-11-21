// The lock step of `init` (architecture §6.3 "The scaffold", D55): package.json pins the exact romlift version, and
// `npm install --package-lock-only --ignore-scripts` writes package-lock.json from the registry without installing
// anything or running a script. It runs with stdin closed and a time limit. When npm is missing, the registry cannot
// be reached (offline, a mirror down, a version not published), npm fails or the limit passes, the lock is deferred:
// W_LOCKFILE_DEFERRED, and setup.sh writes it on its first run that installs romlift with npm (`npm install` while no
// lock exists); with ROMLIFT_CLI set npm is not run at all, since setup.sh then installs nothing. Mechanical: it
// runs npm and reports; it never decides what the lock holds.
import { spawn } from 'node:child_process';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { ShellCodes } from '../codes.ts';
import type { ShellCode } from '../codes.ts';
import { findExecutable } from './binutils.ts';

/** The arguments of the lock step: the lock only, no scripts, no audit or funding requests. */
export const NPM_LOCK_ARGS: readonly string[] = [
  'install',
  '--package-lock-only',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
];

/** How long the lock step may take before it is deferred. */
export const NPM_LOCK_TIME_LIMIT_MS = 60_000;

/** How many characters of npm's output a deferral quotes. */
const QUOTED_OUTPUT = 300;
/** How much of npm's output is kept for the message (its first lines say what failed). */
const OUTPUT_KEPT = 16 * 1024;

export interface NpmLockOptions {
  /** The environment npm runs in and is looked up on (its PATH); default process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The npm executable; default `npm` on the PATH of `env`. */
  readonly npm?: string;
  /** Default NPM_LOCK_TIME_LIMIT_MS. */
  readonly timeoutMs?: number;
}

/** The lock written, or why not (W_LOCKFILE_DEFERRED). */
export type NpmLockResult = { readonly ok: true } | { readonly ok: false; readonly diagnostic: Diagnostic<ShellCode> };

function deferred(message: string): NpmLockResult {
  return {
    ok: false,
    diagnostic: diagnostic(
      ShellCodes,
      'W_LOCKFILE_DEFERRED',
      `package-lock.json not written: ${message}; setup.sh writes it on its first run that installs romlift with npm, and none does while ROMLIFT_CLI is set (romlift is not on the npm registry until it is published)`,
      { path: 'package-lock.json' },
    ),
  };
}

/**
 * What npm said, short: its first two `npm error` (or `npm ERR!`) lines, else the last QUOTED_OUTPUT characters of its
 * output, on one line.
 */
export function npmMessage(output: string): string {
  const errors = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^npm (error|ERR!) \S/.test(line));
  const text = (errors.length > 0 ? errors.slice(0, 2).join('; ') : output).replace(/\s+/g, ' ').trim();
  return text.length > QUOTED_OUTPUT ? `${text.slice(0, QUOTED_OUTPUT)}…` : text;
}

/** What one npm run gave: its exit code (null when it was killed) or the error that kept it from starting. */
type NpmRun =
  | { readonly kind: 'exited'; readonly code: number | null; readonly output: string; readonly timedOut: boolean }
  | { readonly kind: 'failed'; readonly reason: string };

/** Kills npm and every process it started (its process group); one already gone is fine. */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

function runNpm(
  npm: string,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs: number,
): Promise<NpmRun> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const settle = (run: NpmRun): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    // Its own process group, so the time limit kills the scripts and fetchers npm started too.
    const child = spawn(npm, [...NPM_LOCK_ARGS], {
      cwd,
      env: { ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const keep = (chunk: Buffer): void => {
      if (output.length < OUTPUT_KEPT) output += chunk.toString('utf8');
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      killGroup(child.pid);
      settle({ kind: 'exited', code: null, output, timedOut: true });
    }, timeoutMs);
    child.once('error', (error) => settle({ kind: 'failed', reason: error.message }));
    child.once('close', (code) => settle({ kind: 'exited', code, output, timedOut: false }));
  });
}

/** Runs the lock step in the project directory `dir`; never throws. */
export async function writePackageLock(dir: string, options: NpmLockOptions = {}): Promise<NpmLockResult> {
  const env = options.env ?? process.env;
  // final-review clean-clone-5, end-to-end-user-13: with ROMLIFT_CLI set romlift runs from a checkout, so the registry
  // is not asked for a package it does not hold.
  const cli = env['ROMLIFT_CLI'];
  if (cli !== undefined && cli !== '') return deferred('ROMLIFT_CLI is set, so npm was not asked');
  const npm = options.npm ?? findExecutable('npm', env);
  if (npm === undefined) return deferred('npm is not on the PATH');
  const timeoutMs = options.timeoutMs ?? NPM_LOCK_TIME_LIMIT_MS;
  const run = await runNpm(npm, dir, env, timeoutMs);
  if (run.kind === 'failed') return deferred(`npm did not start (${run.reason})`);
  if (run.timedOut) return deferred(`npm ${NPM_LOCK_ARGS.join(' ')} took longer than ${timeoutMs} ms`);
  if (run.code !== 0)
    return deferred(`npm ${NPM_LOCK_ARGS.join(' ')} exited ${run.code ?? 'on a signal'} (${npmMessage(run.output)})`);
  return { ok: true };
}
