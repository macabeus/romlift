// The bench command line: usage errors exit 2 with the usage text, refused inputs exit 1 with the
// message, and the process entry maps an unknown command to exit 2 (the error paths of bench/src/cli.ts).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { main, usage, type BenchIo } from '../../../bench/src/cli.ts';
import { REPO_ROOT } from '../../../bench/src/context.ts';
import { withTempDir } from './fixtures.ts';

interface Captured extends BenchIo {
  readonly outLines: string[];
  readonly errLines: string[];
}

function capture(): Captured {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return { outLines, errLines, out: (l) => outLines.push(l), err: (l) => errLines.push(l) };
}

const CX = { repoRoot: REPO_ROOT, benchRoot: REPO_ROOT, pocRoot: REPO_ROOT };

test('no command and an unknown command print the usage and exit 2', async () => {
  const none = capture();
  assert.equal(await main([], CX, none), 2);
  assert.deepEqual(none.errLines, [usage()]);
  const unknown = capture();
  assert.equal(await main(['frobnicate'], CX, unknown), 2);
  assert.equal(unknown.errLines[0], `unknown command frobnicate\n${usage()}`);
});

test('a bad option or value is a usage error: exit 2 with the message and the usage', async () => {
  const cases: readonly (readonly [readonly string[], string])[] = [
    [['gates', '--tier', 'staging'], '--tier must be ci or real'],
    [['gates', '--require', 'one'], '--require must be a non-negative integer'],
    [['gates', '--require'], '--require needs a value'],
    [['poc-check', '--bogus'], 'unknown option --bogus'],
    [['run', 'extra'], 'unexpected argument extra'],
    [['baseline'], 'baseline needs a ROM name'],
    [['web', '--port', '-1'], '--port must be a non-negative integer'],
  ];
  for (const [argv, message] of cases) {
    const io = capture();
    assert.equal(await main(argv, CX, io), 2, argv.join(' '));
    assert.equal(io.errLines[0], `${message}\n${usage()}`, argv.join(' '));
  }
});

test('a refused input exits 1 with its message; an empty gates directory prints no gate records', async () => {
  await withTempDir('romlift-bench-cli-', async (root) => {
    const gates = join(root, 'gates');
    await mkdir(gates);
    await writeFile(join(gates, 'phase.json'), '{ "landed": 0 }\n');
    const cx = { repoRoot: root, benchRoot: root, pocRoot: root };
    const empty = capture();
    assert.equal(await main(['gates', '--dir', gates], cx, empty), 0);
    assert.deepEqual(empty.outLines, ['no gate records']);
    const real = capture();
    assert.equal(await main(['gates', '--tier', 'real', '--dir', gates], cx, real), 1);
    assert.match(real.errLines[0] ?? '', /results\.json does not exist: run npm run bench -- run first/);
  });
});

test('the process entry exits 2 on an unknown command and prints the usage on stderr', () => {
  const run = spawnSync(process.execPath, ['--conditions=source', join(REPO_ROOT, 'bench/src/cli.ts'), 'frobnicate'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /^unknown command frobnicate\nromlift benchmark: npm run bench -- <command>/);
});
