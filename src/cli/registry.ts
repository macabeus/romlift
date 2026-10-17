// The command contract every phase's command lists implement (architecture §2.1). These types are
// frozen in phase 1 because every later command list depends on them (D54); helpers that build or
// look up commands live beside them.
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
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** One implemented command. The registry lists only commands that exist; phases live in the gates (D29). */
export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly options: readonly OptionSpec[];
  run(args: ParsedArgs, io: CliIo): Promise<ExitCode>;
}
