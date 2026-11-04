import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseArgs } from '../../../src/cli/args.ts';
import type { ParseOutcome } from '../../../src/cli/args.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import type { CommandSpec, ParsedArgs } from '../../../src/cli/registry.ts';
import { FAKE_COMMANDS } from './fake.ts';

function parsed(argv: readonly string[]): ParsedArgs {
  const outcome = parseArgs(argv, FAKE_COMMANDS);
  assert.ok(outcome.ok, outcome.ok ? '' : outcome.message);
  return outcome.args;
}

function message(argv: readonly string[]): string {
  const outcome: ParseOutcome = parseArgs(argv, FAKE_COMMANDS);
  assert.ok(!outcome.ok, 'expected a parse error');
  return outcome.message;
}

test('a bare command gets every declared option at its default', () => {
  const outcome = parseArgs(['scan'], FAKE_COMMANDS);
  assert.ok(outcome.ok);
  assert.equal(outcome.spec.name, 'scan');
  assert.deepEqual(outcome.args, {
    command: 'scan',
    positionals: [],
    flags: { help: false, json: false },
    options: {},
    repeated: { disable: [] },
  });
});

test('boolean flags, string options in both spellings, repeats in order, positionals', () => {
  assert.deepEqual(
    parsed(['scan', 'a.gba', '--json', '--rom', 'r.gba', '--disable', 'b', 'b.gba', '--disable=a', '--out=o', '--disable', 'b']),
    {
      command: 'scan',
      positionals: ['a.gba', 'b.gba'],
      flags: { help: false, json: true },
      options: { rom: 'r.gba', out: 'o' },
      repeated: { disable: ['b', 'a', 'b'] },
    },
  );
});

test('flags before the command are read against the command', () => {
  assert.deepEqual(parsed(['--json', 'scan', 'x']).flags, { help: false, json: true });
  assert.deepEqual(parsed(['--json', 'scan', 'x']).positionals, ['x']);
});

test('--rom=<value> keeps every later = sign; a lone - is a positional', () => {
  assert.deepEqual(parsed(['scan', '--rom=a=b', '-']).options, { rom: 'a=b' });
  assert.deepEqual(parsed(['scan', '--rom=a=b', '-']).positionals, ['-']);
});

test('-- ends the options: later tokens are positionals even when they look like options', () => {
  const args = parsed(['scan', 'a', '--', '--json', '--nope', '--']);
  assert.deepEqual(args.positionals, ['a', '--json', '--nope', '--']);
  assert.equal(args.flags['json'], false);
});

test('a value may start with a single dash', () => {
  assert.deepEqual(parsed(['scan', '--rom', '-x.gba']).options, { rom: '-x.gba' });
});

test('--help and -h set flags.help for any command', () => {
  assert.equal(parsed(['scan', '--help'])['flags']['help'], true);
  assert.equal(parsed(['zeta', '-h'])['flags']['help'], true);
  assert.equal(parsed(['zeta'])['flags']['help'], false);
});

test('every parse error has a precise message', () => {
  assert.equal(message([]), 'no command given');
  assert.equal(message(['--json']), 'no command given');
  assert.equal(message(['--', 'scan']), 'no command given');
  assert.equal(message(['nope']), "unknown command 'nope'");
  assert.equal(message(['--rom', 'x.gba', 'scan']), "unknown command 'x.gba'");
  assert.equal(message(['scan', '--nope']), "unknown option '--nope' for command 'scan'");
  assert.equal(message(['scan', '--nope=1']), "unknown option '--nope' for command 'scan'");
  assert.equal(message(['scan', '-x']), "unknown option '-x' for command 'scan'");
  assert.equal(message(['zeta', '--json']), "unknown option '--json' for command 'zeta'");
  assert.equal(message(['scan', '--json=true']), "option '--json' takes no value");
  assert.equal(message(['scan', '--rom']), "option '--rom' needs a value <path>");
  assert.equal(message(['scan', '--rom', '--json']), "option '--rom' needs a value <path>");
  assert.equal(message(['scan', '--rom=']), "option '--rom' needs a value <path>");
  assert.equal(message(['scan', '--out']), "option '--out' needs a value <value>");
  assert.equal(message(['scan', '--disable']), "option '--disable' needs a value <rule>");
  assert.equal(message(['scan', '--rom', 'a', '--rom=b']), "option '--rom' given more than once");
});

test('a boolean flag given twice stays true', () => {
  assert.equal(parsed(['scan', '--json', '--json']).flags['json'], true);
});

test('parsing does not mutate argv', () => {
  const argv = Object.freeze(['scan', '--disable', 'x', 'a']);
  parsed(argv);
  assert.deepEqual(argv, ['scan', '--disable', 'x', 'a']);
});

test('positionals are checked against the declared ones: an extra or a missing one is a usage error', () => {
  assert.equal(message(['zeta', 'extra']), "unexpected argument 'extra' for command 'zeta'");
  assert.equal(message(['scan', 'a', 'b', 'c', 'd', 'e']), "unexpected argument 'e' for command 'scan'");
  const needsRom: CommandSpec = { name: 'needs', summary: 'Needs a ROM', usage: 'needs <rom> [<dir>]', positionals: [{ name: '<rom>' }, { name: '<dir>', optional: true }], options: [], run: async () => ExitCode.ok };
  const outcome = parseArgs(['needs'], [needsRom]);
  assert.ok(!outcome.ok);
  assert.equal(outcome.message, "command 'needs' needs <rom>");
  assert.ok(parseArgs(['needs', 'a.gba'], [needsRom]).ok);
  assert.ok(parseArgs(['needs', 'a.gba', 'out'], [needsRom]).ok);
  assert.ok(!parseArgs(['needs', 'a.gba', 'out', 'x'], [needsRom]).ok);
  assert.ok(parseArgs(['needs', '--help'], [needsRom]).ok, '--help needs no positionals');
});
