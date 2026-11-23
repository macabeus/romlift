#!/usr/bin/env -S node --max-old-space-size=1024
// The `romlift` entry point (architecture §2.1). `main` is the whole command line as a function: it
// prints usage or help, parses, runs the command and maps a thrown error to exit 70. It never reads
// stdin and never prompts. Run as the process's main module, it wires itself to the process. The first line is the
// `romlift` bin's launcher (dist/cli/main.js keeps it): Node runs every command with V8's old space capped at 1,024 MiB,
// the cap g3.large-rom measures under (D68 b, D69, D72: the owner's answer to Q7, which replaces Q6's 384;
// bench/src/large-rom.ts LARGE_ROM_MAX_OLD_SPACE_MIB).
import { IsaInvariantError } from '@match-kit/isa/armv4t';

import { RomliftInvariantError } from '../api/rom.ts';
import { packageVersion } from '../shell/project/read-inputs.ts';
import { parseArgs } from './args.ts';
import { COMMANDS } from './commands/index.ts';
import { ExitCode, isExitCode } from './exit-codes.ts';
import { HELP_FLAG, PROGRAM, commandHelp, usageText } from './registry.ts';
import type { CliIo, CommandSpec } from './registry.ts';

function isHelpToken(token: string | undefined): boolean {
  return token === `--${HELP_FLAG}` || token === '-h';
}

/** `romlift --version` (final-review end-to-end-user-12): the version of the package the bin runs from. */
function isVersionToken(token: string | undefined): boolean {
  return token === '--version' || token === '-V';
}

/**
 * One stderr line for an error nothing caught: a bug in romlift, reported without a stack. A broken invariant of the
 * instruction set (@match-kit/isa's IsaInvariantError, D121) is named as one, like romlift's own.
 */
function internalErrorLine(error: unknown): string {
  const invariant = error instanceof RomliftInvariantError || error instanceof IsaInvariantError;
  const kind = invariant ? 'invariant violated' : 'internal error';
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `${PROGRAM}: ${kind}: ${detail.replace(/\s*\n\s*/g, ' ')}\n`;
}

/** Runs one command line; the returned code is the process exit code. */
export async function main(
  argv: readonly string[],
  io: CliIo,
  commands: readonly CommandSpec[] = COMMANDS,
): Promise<ExitCode> {
  try {
    if (argv.length === 0 || isHelpToken(argv[0])) {
      io.stdout(usageText(commands));
      return ExitCode.ok;
    }
    if (argv.length === 1 && isVersionToken(argv[0])) {
      const version = await packageVersion();
      if (!version.ok) {
        io.stderr(`${PROGRAM}: ${version.diagnostic.message}\n`);
        return ExitCode.errors;
      }
      io.stdout(`${PROGRAM} ${version.value}\n`);
      return ExitCode.ok;
    }
    const parsed = parseArgs(argv, commands);
    if (!parsed.ok) {
      io.stderr(`${PROGRAM}: ${parsed.message}\n\n${usageText(commands)}`);
      return ExitCode.usage;
    }
    if (parsed.args.flags[HELP_FLAG] === true) {
      io.stdout(commandHelp(parsed.spec));
      return ExitCode.ok;
    }
    const code: unknown = await parsed.spec.run(parsed.args, io);
    if (!isExitCode(code))
      throw new RomliftInvariantError(`command '${parsed.spec.name}' returned ${String(code)}, not an exit code`);
    return code;
  } catch (error) {
    io.stderr(internalErrorLine(error));
    return ExitCode.internal;
  }
}

/**
 * The error codes of a write to a reader that has gone: EPIPE on a pipe, and ENOTCONN, which macOS can report
 * instead on a socket-pair stdout (Node's `spawn` with `stdio: 'pipe'`) closed by its reader (correctness-ci-1).
 */
const CLOSED_READER_CODES: ReadonlySet<string> = new Set(['EPIPE', 'ENOTCONN']);

/** The part of a stream exitQuietlyOnEpipe listens on. */
export interface ErrorEmitter {
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
}

/**
 * A reader that closes the pipe early (`romlift generate --dry-run --json | head`) is not an error of romlift: on
 * EPIPE or ENOTCONN the process exits quietly with the code it has so far (0 while the command still runs).
 * Any other error is thrown. `exit` is the process's own, replaced only by the unit test.
 */
export function exitQuietlyOnEpipe(stream: ErrorEmitter, exit: () => void = () => process.exit()): void {
  stream.on('error', (error) => {
    if (error.code === undefined || !CLOSED_READER_CODES.has(error.code)) throw error;
    exit();
  });
}

if (import.meta.main) {
  exitQuietlyOnEpipe(process.stdout);
  exitQuietlyOnEpipe(process.stderr);
  const io: CliIo = {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    drained: () =>
      process.stdout.writableNeedDrain
        ? new Promise((resolve) => process.stdout.once('drain', resolve))
        : Promise.resolve(),
    cwd: process.cwd(),
    env: process.env,
  };
  process.exitCode = await main(process.argv.slice(2), io);
}
