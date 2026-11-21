import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMMANDS } from '../../../src/cli/commands/index.ts';
import { commandHelp, findCommand, usageText } from '../../../src/cli/registry.ts';
import { FAKE_COMMANDS, scanFake } from './fake.ts';

test('findCommand finds by exact name', () => {
  assert.equal(findCommand(FAKE_COMMANDS, 'scan'), scanFake);
  assert.equal(findCommand(FAKE_COMMANDS, 'Scan'), undefined);
  assert.equal(findCommand(FAKE_COMMANDS, ''), undefined);
});

test('usageText lists commands sorted by name', () => {
  assert.equal(
    usageText(FAKE_COMMANDS),
    [
      'Usage: romlift <command> [options]',
      '',
      'Commands:',
      '  bogus       Returns a number that is not an exit code',
      '  check       Fails its self-check',
      '  crash       Throws a TypeError',
      '  fails       Reports error diagnostics',
      '  invariant   Throws RomliftInvariantError',
      '  scan        Scans a ROM',
      '  usage-fail  Rejects its positionals',
      '  zeta        Last by name',
      '',
      "Run 'romlift <command> --help' for the options of a command, 'romlift --version' for the version.",
      '',
    ].join('\n'),
  );
});

test('usageText with no commands', () => {
  assert.equal(
    usageText([]),
    "Usage: romlift <command> [options]\n\nCommands:\n  (none)\n\nRun 'romlift <command> --help' for the options of a command, 'romlift --version' for the version.\n",
  );
});

test('commandHelp shows the synopsis, summary and options in declared order', () => {
  assert.equal(
    commandHelp(scanFake),
    [
      'Usage: romlift scan [<rom>…] [--json] [--rom <path>] [--disable <rule>...]',
      '',
      'Scans a ROM',
      '',
      'Options:',
      '  --json            Prints NDJSON',
      '  --rom <path>      The ROM to read',
      '  --disable <rule>  Turns a rule off (repeatable)',
      '  --out <value>     Where to write',
      '  --help            Prints this help',
      '',
    ].join('\n'),
  );
});

test('the shipped command names are unique and declare neither help nor duplicate options', () => {
  const names = COMMANDS.map((spec) => spec.name);
  assert.equal(new Set(names).size, names.length);
  for (const spec of COMMANDS) {
    const options = spec.options.map((option) => option.name);
    assert.equal(new Set(options).size, options.length, spec.name);
    assert.ok(!options.includes('help'), spec.name);
  }
});
