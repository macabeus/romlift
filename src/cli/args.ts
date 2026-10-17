// The command-line parser (architecture §2.1). The first token that is not an option names the
// command; every other token is read against that command's `OptionSpec` list: boolean flags
// (`--json`), string options (`--rom <path>` or `--rom=<path>`), repeatable options (`--disable <rule>`,
// kept in order) and positionals; `--` ends the options. `--help` (or `-h`) is accepted by every
// command and sets `flags.help`. Parsing never throws: a bad command line is a precise message.
import { findCommand, HELP_FLAG } from './registry.ts';
import type { CommandSpec, OptionSpec, ParsedArgs } from './registry.ts';

/** The parser's answer: the command and its arguments, or why the command line is not usable. */
export type ParseOutcome =
  | { readonly ok: true; readonly spec: CommandSpec; readonly args: ParsedArgs }
  | { readonly ok: false; readonly message: string };

const TERMINATOR = '--';

function isOptionToken(token: string): boolean {
  return token.startsWith('-') && token !== '-';
}

function fail(message: string): ParseOutcome {
  return { ok: false, message };
}

/** Parses `argv` (the process arguments after the script) against the implemented `commands`. */
export function parseArgs(argv: readonly string[], commands: readonly CommandSpec[]): ParseOutcome {
  const commandIndex = argv.findIndex((token) => !isOptionToken(token));
  const terminatorIndex = argv.indexOf(TERMINATOR);
  if (commandIndex < 0 || (terminatorIndex >= 0 && terminatorIndex < commandIndex)) return fail('no command given');
  const name = argv[commandIndex] ?? '';
  const spec = findCommand(commands, name);
  if (spec === undefined) return fail(`unknown command '${name}'`);

  const byName = new Map<string, OptionSpec>();
  for (const option of spec.options) byName.set(option.name, option);
  const flags: Record<string, boolean> = { [HELP_FLAG]: false };
  const options: Record<string, string> = {};
  const repeated: Record<string, string[]> = {};
  for (const option of spec.options) {
    if (option.kind === 'boolean') flags[option.name] = false;
    if (option.kind === 'repeat') repeated[option.name] = [];
  }
  const positionals: string[] = [];

  const rest = argv.filter((_, index) => index !== commandIndex);
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] ?? '';
    if (token === TERMINATOR) {
      positionals.push(...rest.slice(i + 1));
      break;
    }
    if (!isOptionToken(token)) {
      positionals.push(token);
      continue;
    }
    if (token === '-h' || token === `--${HELP_FLAG}`) {
      flags[HELP_FLAG] = true;
      continue;
    }
    if (!token.startsWith('--')) return fail(`unknown option '${token}' for command '${name}'`);
    const equals = token.indexOf('=');
    const optionName = equals < 0 ? token.slice(2) : token.slice(2, equals);
    const option = byName.get(optionName);
    if (option === undefined) return fail(`unknown option '--${optionName}' for command '${name}'`);
    if (option.kind === 'boolean') {
      if (equals >= 0) return fail(`option '--${optionName}' takes no value`);
      flags[optionName] = true;
      continue;
    }
    let value: string;
    if (equals >= 0) {
      value = token.slice(equals + 1);
    } else {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return fail(`option '--${optionName}' needs a value ${option.value ?? '<value>'}`);
      }
      value = next;
      i++;
    }
    if (value === '') return fail(`option '--${optionName}' needs a value ${option.value ?? '<value>'}`);
    if (option.kind === 'string') {
      if (options[optionName] !== undefined) return fail(`option '--${optionName}' given more than once`);
      options[optionName] = value;
    } else {
      (repeated[optionName] ??= []).push(value);
    }
  }

  return { ok: true, spec, args: { command: spec.name, positionals, flags, options, repeated } };
}
