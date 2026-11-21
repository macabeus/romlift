// Child processes for the bench: git, node --test and the PoC's tsx (binutils run through romlift/node). Never throws for
// a nonzero exit; 127 when the command cannot start.
import { spawn } from 'node:child_process';

export interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Copies the child's stderr to ours as it arrives (long PoC runs). */
  readonly echoStderr?: boolean;
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const env: Record<string, string | undefined> = { ...process.env, ...options.env };
    // An undefined value removes the variable from the child's environment.
    for (const [key, value] of Object.entries(options.env ?? {})) if (value === undefined) delete env[key];
    const child = spawn(command, [...args], { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (code: number, extra: string): void => {
      if (settled) return;
      settled = true;
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8') + extra,
      });
    };
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      if (options.echoStderr) process.stderr.write(chunk);
    });
    child.on('error', (error) => finish(127, `${error.message}\n`));
    child.on('close', (code, signal) => finish(code ?? 128, signal ? `killed by ${signal}\n` : ''));
  });
}
