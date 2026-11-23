import { rowOf } from '@match-kit/isa/armv4t';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { commandHelp, usageText } from '../../../src/cli/registry.ts';
import type { CommandSpec } from '../../../src/cli/registry.ts';
import { FAKE_COMMANDS, capturingIo, scanFake } from './fake.ts';

test('no arguments, --help and -h print usage to stdout and exit 0', async () => {
  for (const argv of [[], ['--help'], ['-h'], ['--help', 'scan']]) {
    const io = capturingIo();
    assert.equal(await main(argv, io, FAKE_COMMANDS), ExitCode.ok);
    assert.deepEqual(io.out, [usageText(FAKE_COMMANDS)]);
    assert.deepEqual(io.err, []);
  }
});

test('<command> --help prints that command help and does not run it', async () => {
  const io = capturingIo();
  assert.equal(await main(['scan', 'x.gba', '--help'], io, FAKE_COMMANDS), ExitCode.ok);
  assert.deepEqual(io.out, [commandHelp(scanFake)]);
  assert.deepEqual(io.calls, []);
});

test('a parse error prints the message and usage to stderr and exits 2', async () => {
  const io = capturingIo();
  assert.equal(await main(['nope'], io, FAKE_COMMANDS), ExitCode.usage);
  assert.deepEqual(io.out, []);
  assert.deepEqual(io.err, [`romlift: unknown command 'nope'\n\n${usageText(FAKE_COMMANDS)}`]);
  const io2 = capturingIo();
  assert.equal(await main(['scan', '--rom'], io2, FAKE_COMMANDS), ExitCode.usage);
  assert.match(io2.err[0] ?? '', /^romlift: option '--rom' needs a value <path>\n\nUsage: romlift /);
});

test('the command runs with its parsed arguments and the io', async () => {
  const io = capturingIo();
  assert.equal(await main(['scan', 'a.gba', '--disable', 'r'], io, FAKE_COMMANDS), ExitCode.ok);
  assert.deepEqual(io.out, ['scanned a.gba\n']);
  assert.equal(io.calls.length, 1);
  assert.deepEqual(io.calls[0]?.repeated, { disable: ['r'] });
});

test('exit codes 0, 1, 2 and 3 propagate from the command', async () => {
  const cases: readonly (readonly [string, ExitCode])[] = [
    ['zeta', ExitCode.ok],
    ['fails', ExitCode.errors],
    ['usage-fail', ExitCode.usage],
    ['check', ExitCode.verifyFailed],
  ];
  for (const [name, code] of cases) {
    const io = capturingIo();
    assert.equal(await main([name], io, FAKE_COMMANDS), code, name);
    assert.equal(io.calls.length, 1, name);
    assert.deepEqual(io.err, [], name);
  }
});

test('a thrown RomliftInvariantError prints one stderr line and exits 70', async () => {
  const io = capturingIo();
  assert.equal(await main(['invariant'], io, FAKE_COMMANDS), ExitCode.internal);
  assert.deepEqual(io.out, []);
  assert.deepEqual(io.err, [
    'romlift: invariant violated: RomliftInvariantError: the tiling has a hole at 0x08000000\n',
  ]);
});

test("a broken invariant of the instruction set (IsaInvariantError, D121) is reported as romlift's own are", async () => {
  const io = capturingIo();
  const command: CommandSpec = {
    name: 'isa-invariant',
    summary: "Throws the instruction set's IsaInvariantError",
    usage: 'isa-invariant',
    positionals: [],
    options: [],
    run: async () => {
      rowOf('thumb.no_such_row');
      return ExitCode.ok;
    },
  };
  assert.equal(await main(['isa-invariant'], io, [command]), ExitCode.internal);
  assert.deepEqual(io.out, []);
  assert.deepEqual(io.err, [
    "romlift: invariant violated: IsaInvariantError: unknown instruction spec 'thumb.no_such_row'\n",
  ]);
});

test('any other throw, and a return that is not an exit code, exit 70 with one line', async () => {
  const io = capturingIo();
  assert.equal(await main(['crash'], io, FAKE_COMMANDS), ExitCode.internal);
  assert.deepEqual(io.err, ['romlift: internal error: TypeError: x is undefined\n']);
  const io2 = capturingIo();
  assert.equal(await main(['bogus'], io2, FAKE_COMMANDS), ExitCode.internal);
  assert.deepEqual(io2.err, [
    "romlift: invariant violated: RomliftInvariantError: command 'bogus' returned 42, not an exit code\n",
  ]);
});

test('main defaults to the shipped COMMANDS', async () => {
  const io = capturingIo();
  assert.equal(await main(['--help'], io), ExitCode.ok);
  assert.match(io.out.join(''), /^Usage: romlift <command> \[options\]\n/);
});
