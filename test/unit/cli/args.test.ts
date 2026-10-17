import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseArgs } from '../../../src/cli/args.ts';
import type { ParseOutcome } from '../../../src/cli/args.ts';
import type { ParsedArgs } from '../../../src/cli/registry.ts';
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
  const outcome = parseArgs(['analyze'], FAKE_COMMANDS);
  assert.ok(outcome.ok);
  assert.equal(outcome.spec.name, 'analyze');
  assert.deepEqual(outcome.args, {
    command: 'analyze',
    positionals: [],
    flags: { help: false, json: false },
    options: {},
    repeated: { disable: [] },
  });
});

test('boolean flags, string options in both spellings, repeats in order, positionals', () => {
  assert.deepEqual(
    parsed(['analyze', 'a.gba', '--json', '--rom', 'r.gba', '--disable', 'b', 'b.gba', '--disable=a', '--out=o', '--disable', 'b']),
    {
      command: 'analyze',
      positionals: ['a.gba', 'b.gba'],
      flags: { help: false, json: true },
      options: { rom: 'r.gba', out: 'o' },
      repeated: { disable: ['b', 'a', 'b'] },
    },
  );
});

test('flags before the command are read against the command', () => {
  assert.deepEqual(parsed(['--json', 'analyze', 'x']).flags, { help: false, json: true });
  assert.deepEqual(parsed(['--json', 'analyze', 'x']).positionals, ['x']);
});

test('--rom=<value> keeps every later = sign; a lone - is a positional', () => {
  assert.deepEqual(parsed(['analyze', '--rom=a=b', '-']).options, { rom: 'a=b' });
  assert.deepEqual(parsed(['analyze', '--rom=a=b', '-']).positionals, ['-']);
});

test('-- ends the options: later tokens are positionals even when they look like options', () => {
  const args = parsed(['analyze', 'a', '--', '--json', '--nope', '--']);
  assert.deepEqual(args.positionals, ['a', '--json', '--nope', '--']);
  assert.equal(args.flags['json'], false);
});

test('a value may start with a single dash', () => {
  assert.deepEqual(parsed(['analyze', '--rom', '-x.gba']).options, { rom: '-x.gba' });
});

test('--help and -h set flags.help for any command', () => {
  assert.equal(parsed(['analyze', '--help'])['flags']['help'], true);
  assert.equal(parsed(['zeta', '-h'])['flags']['help'], true);
  assert.equal(parsed(['zeta'])['flags']['help'], false);
});

test('every parse error has a precise message', () => {
  assert.equal(message([]), 'no command given');
  assert.equal(message(['--json']), 'no command given');
  assert.equal(message(['--', 'analyze']), 'no command given');
  assert.equal(message(['nope']), "unknown command 'nope'");
  assert.equal(message(['--rom', 'x.gba', 'analyze']), "unknown command 'x.gba'");
  assert.equal(message(['analyze', '--nope']), "unknown option '--nope' for command 'analyze'");
  assert.equal(message(['analyze', '--nope=1']), "unknown option '--nope' for command 'analyze'");
  assert.equal(message(['analyze', '-x']), "unknown option '-x' for command 'analyze'");
  assert.equal(message(['zeta', '--json']), "unknown option '--json' for command 'zeta'");
  assert.equal(message(['analyze', '--json=true']), "option '--json' takes no value");
  assert.equal(message(['analyze', '--rom']), "option '--rom' needs a value <path>");
  assert.equal(message(['analyze', '--rom', '--json']), "option '--rom' needs a value <path>");
  assert.equal(message(['analyze', '--rom=']), "option '--rom' needs a value <path>");
  assert.equal(message(['analyze', '--out']), "option '--out' needs a value <value>");
  assert.equal(message(['analyze', '--disable']), "option '--disable' needs a value <rule>");
  assert.equal(message(['analyze', '--rom', 'a', '--rom=b']), "option '--rom' given more than once");
});

test('a boolean flag given twice stays true', () => {
  assert.equal(parsed(['analyze', '--json', '--json']).flags['json'], true);
});

test('parsing does not mutate argv', () => {
  const argv = Object.freeze(['analyze', '--disable', 'x', 'a']);
  parsed(argv);
  assert.deepEqual(argv, ['analyze', '--disable', 'x', 'a']);
});
