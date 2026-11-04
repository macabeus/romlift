// Fake commands and a capturing CliIo for the CLI tests: nothing here touches the process.
import { RomliftInvariantError } from '../../../src/api/rom.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import type { CliIo, CommandSpec, ParsedArgs } from '../../../src/cli/registry.ts';

export interface CapturedIo extends CliIo {
  readonly out: string[];
  readonly err: string[];
  readonly calls: ParsedArgs[];
}

export function capturingIo(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    calls: [],
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    cwd: '/fake/cwd',
    env: {},
  };
}

/** A command that records its arguments in `io.calls` and returns `code`. */
function recording(name: string, code: ExitCode, summary: string): CommandSpec {
  return {
    name,
    summary,
    usage: name,
    positionals: [],
    options: [],
    run: async (args, io) => {
      (io as CapturedIo).calls.push(args);
      return code;
    },
  };
}

export const scanFake: CommandSpec = {
  name: 'scan',
  summary: 'Scans a ROM',
  usage: 'scan [<rom>…] [--json] [--rom <path>] [--disable <rule>...]',
  positionals: ['<rom>', '<rom2>', '<rom3>', '<rom4>'].map((name) => ({ name, optional: true })),
  options: [
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON' },
    { name: 'rom', kind: 'string', summary: 'The ROM to read', value: '<path>' },
    { name: 'disable', kind: 'repeat', summary: 'Turns a rule off', value: '<rule>' },
    { name: 'out', kind: 'string', summary: 'Where to write' },
  ],
  run: async (args, io) => {
    (io as CapturedIo).calls.push(args);
    io.stdout(`scanned ${args.positionals.join(',')}\n`);
    return ExitCode.ok;
  },
};

export const FAKE_COMMANDS: readonly CommandSpec[] = [
  recording('zeta', ExitCode.ok, 'Last by name'),
  scanFake,
  recording('fails', ExitCode.errors, 'Reports error diagnostics'),
  recording('check', ExitCode.verifyFailed, 'Fails its self-check'),
  recording('usage-fail', ExitCode.usage, 'Rejects its positionals'),
  {
    name: 'invariant',
    summary: 'Throws RomliftInvariantError',
    usage: 'invariant',
    positionals: [],
    options: [],
    run: async () => {
      throw new RomliftInvariantError('the tiling has a hole\nat 0x08000000');
    },
  },
  {
    name: 'crash',
    summary: 'Throws a TypeError',
    usage: 'crash',
    positionals: [],
    options: [],
    run: async () => {
      throw new TypeError('x is undefined');
    },
  },
  {
    name: 'bogus',
    summary: 'Returns a number that is not an exit code',
    usage: 'bogus',
    positionals: [],
    options: [],
    run: async () => 42 as unknown as ExitCode,
  },
];
