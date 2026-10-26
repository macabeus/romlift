// The command contract every phase's command lists implement (architecture §2.1). These types are
// frozen in phase 1 because every later command list depends on them (D54); helpers that build or
// look up commands live beside them.
import { compareCodeUnits } from '../api/rom.ts';
import type { ExitCode } from './exit-codes.ts';

/** One `--option` a command accepts. */
export interface OptionSpec {
  /** The option name without the leading `--`. */
  readonly name: string;
  /** `boolean` takes no value; `string` takes one; `repeat` may be given several times. */
  readonly kind: 'boolean' | 'string' | 'repeat';
  readonly summary: string;
  /** The placeholder shown in usage text for the value, e.g. `<rule>`. */
  readonly value?: string;
}

/** One positional argument a command takes, in order. */
export interface PositionalSpec {
  /** The placeholder shown in usage text, e.g. `<rom>`. */
  readonly name: string;
  /** May be left out; only the last positionals may be optional. */
  readonly optional?: boolean;
}

/** The command line after parsing: the command name, its positionals and its options by kind. */
export interface ParsedArgs {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, boolean>>;
  readonly options: Readonly<Record<string, string>>;
  readonly repeated: Readonly<Record<string, readonly string[]>>;
}

/** What a command may touch of its process: output streams, the working directory, the environment. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  /**
   * Resolves once what stdout holds unwritten has drained (a pipe to a slow reader); a command that streams many
   * lines awaits it between batches, so the queue never holds its whole output (D69, D72: the bin's heap cap).
   * Absent: stdout never queues (the tests' fakes).
   */
  readonly drained?: () => Promise<void>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** One implemented command. The registry lists only commands that exist; phases live in the gates (D29). */
export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  /** The positionals the command takes; the parser rejects a missing or an extra one. */
  readonly positionals: readonly PositionalSpec[];
  readonly options: readonly OptionSpec[];
  run(args: ParsedArgs, io: CliIo): Promise<ExitCode>;
}

// Helpers. `usage` is read as the synopsis that follows the program name, starting with the command
// name (e.g. `analyze <rom> [--json]`). Every command accepts `--help`, which the parser records as
// `flags.help`; a command never declares it.

/** The program name printed in usage text. */
export const PROGRAM = 'romlift';

/** The flag every command accepts; `main` answers it with the command's help. */
export const HELP_FLAG = 'help';

/** The command called `name`, if it is implemented. */
export function findCommand(commands: readonly CommandSpec[], name: string): CommandSpec | undefined {
  return commands.find((spec) => spec.name === name);
}

/** Two-column rows, the left column padded to its widest cell plus two spaces. */
function table(rows: readonly (readonly [string, string])[]): string[] {
  const width = rows.reduce((max, [left]) => Math.max(max, left.length), 0);
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd());
}

/** The program's usage: its synopsis and every command with its summary, sorted by name. */
export function usageText(commands: readonly CommandSpec[]): string {
  const sorted = [...commands].sort((a, b) => compareCodeUnits(a.name, b.name));
  const rows = sorted.map((spec): [string, string] => [spec.name, spec.summary]);
  return [
    `Usage: ${PROGRAM} <command> [options]`,
    '',
    'Commands:',
    ...(rows.length === 0 ? ['  (none)'] : table(rows)),
    '',
    `Run '${PROGRAM} <command> --help' for the options of a command, '${PROGRAM} --version' for the version.`,
    '',
  ].join('\n');
}

function optionLabel(option: OptionSpec): string {
  if (option.kind === 'boolean') return `--${option.name}`;
  return `--${option.name} ${option.value ?? '<value>'}`;
}

function optionSummary(option: OptionSpec): string {
  return option.kind === 'repeat' ? `${option.summary} (repeatable)` : option.summary;
}

/** The help of one command: its synopsis, summary and options in the order the command declares them. */
export function commandHelp(spec: CommandSpec): string {
  const rows = spec.options.map((option): [string, string] => [optionLabel(option), optionSummary(option)]);
  rows.push([`--${HELP_FLAG}`, 'Prints this help']);
  return [`Usage: ${PROGRAM} ${spec.usage}`, '', spec.summary, '', 'Options:', ...table(rows), ''].join('\n');
}
