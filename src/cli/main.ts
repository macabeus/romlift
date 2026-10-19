#!/usr/bin/env -S node --max-old-space-size=384
// The `romlift` entry point (architecture §2.1). `main` is the whole command line as a function: it
// prints usage or help, parses, runs the command and maps a thrown error to exit 70. It never reads
// stdin and never prompts. Run as the process's main module, it wires itself to the process. The first line is the
// `romlift` bin's launcher (dist/cli/main.js keeps it): Node runs every command with V8's old space capped at 384 MiB,
// the cap g3.large-rom measures under (D68 b, D69: the owner's answer to Q6; bench/src/large-rom.ts
// LARGE_ROM_MAX_OLD_SPACE_MIB).
import { RomliftInvariantError } from '../api/rom.ts';
import { parseArgs } from './args.ts';
import { COMMANDS } from './commands/index.ts';
import { ExitCode, isExitCode } from './exit-codes.ts';
import { commandHelp, HELP_FLAG, PROGRAM, usageText } from './registry.ts';
import type { CliIo, CommandSpec } from './registry.ts';

function isHelpToken(token: string | undefined): boolean {
  return token === `--${HELP_FLAG}` || token === '-h';
}

/** One stderr line for an error nothing caught: a bug in romlift, reported without a stack. */
function internalErrorLine(error: unknown): string {
  const kind = error instanceof RomliftInvariantError ? 'invariant violated' : 'internal error';
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `${PROGRAM}: ${kind}: ${detail.replace(/\s*\n\s*/g, ' ')}\n`;
}

/** Runs one command line; the returned code is the process exit code. */
export async function main(argv: readonly string[], io: CliIo, commands: readonly CommandSpec[] = COMMANDS): Promise<ExitCode> {
  try {
    if (argv.length === 0 || isHelpToken(argv[0])) {
      io.stdout(usageText(commands));
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
    if (!isExitCode(code)) throw new RomliftInvariantError(`command '${parsed.spec.name}' returned ${String(code)}, not an exit code`);
    return code;
  } catch (error) {
    io.stderr(internalErrorLine(error));
    return ExitCode.internal;
  }
}

/**
 * A reader that closes the pipe early (`romlift analyze rom.gba | head`) is not an error of romlift: on
 * EPIPE the process exits quietly with the code it has so far (0 while the command still runs).
 */
function exitQuietlyOnEpipe(stream: NodeJS.WriteStream): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error;
    process.exit();
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
    cwd: process.cwd(),
    env: process.env,
  };
  process.exitCode = await main(process.argv.slice(2), io);
}
