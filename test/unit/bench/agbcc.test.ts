// The checkout's agbcc (bench/src/agbcc.ts, D120): the repository's pin and its submodule agree, and checkoutAgbcc
// builds tools/agbcc in place once per pin, with a fake process runner standing for git, build.sh and install.sh.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { readAgbccPin } from 'romlift/node';

import {
  AGBCC_PIN_STAMP,
  type AgbccRunner,
  agbccPinProblem,
  checkoutAgbcc,
  checkoutAgbccPath,
  pinText,
} from '../../../bench/src/agbcc.ts';
import type { BenchContext } from '../../../bench/src/context.ts';
import { withTempDir } from './fixtures.ts';

const REPO = join(import.meta.dirname, '..', '..', '..');
const git = (...args: string[]): string => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();

test('templates/agbcc.json pins the commit and the URL the tools/agbcc submodule records, shallow and ignoring a built tree', async () => {
  const pin = await readAgbccPin(REPO);
  assert.ok(pin.ok);
  // The gitlink as the index holds it: `160000 <commit> 0\ttools/agbcc`.
  const stage = git('ls-files', '--stage', '--', 'tools/agbcc');
  assert.match(stage, /^160000 [0-9a-f]{40} 0\ttools\/agbcc$/, 'tools/agbcc is a submodule');
  assert.equal(stage.split(' ')[1], pin.value.commit, 'the gitlink is the pinned commit');
  const config = (key: string): string => git('config', '-f', '.gitmodules', '--get', `submodule.tools/agbcc.${key}`);
  assert.equal(config('path'), 'tools/agbcc');
  assert.equal(config('url'), pin.value.url, '.gitmodules and templates/agbcc.json name one repository');
  assert.match(pin.value.url, /^https:\/\//, 'cloned over HTTPS, which needs no SSH key');
  assert.equal(config('shallow'), 'true');
  assert.equal(config('ignore'), 'dirty', 'the build inside the submodule leaves the superproject clean');
});

const PIN = {
  url: 'https://github.com/macabeus/agbcc.git',
  commit: 'a0f70c956e8f982ee2a1f67f9fbead46cbaef339',
} as const;

/** A repository holding templates/agbcc.json and, unless `checkedOut` is false, tools/agbcc's build.sh. */
async function checkout(root: string, checkedOut = true): Promise<BenchContext> {
  const repoRoot = join(root, 'repo');
  await mkdir(join(repoRoot, 'templates'), { recursive: true });
  await writeFile(join(repoRoot, 'templates', 'agbcc.json'), `${JSON.stringify(PIN)}\n`);
  if (checkedOut) {
    await mkdir(join(repoRoot, 'tools', 'agbcc'), { recursive: true });
    await writeFile(join(repoRoot, 'tools', 'agbcc', 'build.sh'), '');
  }
  return { repoRoot, benchRoot: join(root, 'bench'), pocRoot: join(root, 'poc') };
}

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

/** git at `head`, and agbcc's build.sh and install.sh: install.sh lays out <root>/tools/agbcc as the real one does. */
function fakeAgbcc(
  calls: Call[],
  options: { readonly head?: string; readonly buildFails?: boolean } = {},
): AgbccRunner {
  return async (command, args, opts) => {
    calls.push({ command, args, cwd: opts.cwd });
    if (command === 'git') return { code: 0, stdout: `${options.head ?? PIN.commit}\n`, stderr: '' };
    if (command === './build.sh' && options.buildFails === true) return { code: 2, stdout: '', stderr: 'gcc: error' };
    if (command === './install.sh') {
      const dir = join(args[0] ?? '', 'tools', 'agbcc');
      for (const sub of ['bin', 'include', 'lib']) await mkdir(join(dir, sub), { recursive: true });
      for (const bin of ['agbcc', 'old_agbcc', 'agbcc_arm']) await writeFile(join(dir, 'bin', bin), bin);
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

test('checkoutAgbcc builds tools/agbcc in place once, then reuses it while its stamp names the pin', async () => {
  await withTempDir('romlift-agbcc-build-', async (root) => {
    const cx = await checkout(root);
    const calls: Call[] = [];
    const lines: string[] = [];
    const deps = { run: fakeAgbcc(calls), log: (l: string) => lines.push(l) };
    const dir = await checkoutAgbcc(cx, deps);
    assert.equal(dir, checkoutAgbccPath(cx));
    assert.equal(dir, join(cx.repoRoot, 'tools', 'agbcc'));
    assert.deepEqual((await readdir(join(dir, 'bin'))).sort(), ['agbcc', 'agbcc_arm', 'old_agbcc']);
    assert.equal(await readFile(join(dir, AGBCC_PIN_STAMP), 'utf8'), pinText(PIN));
    assert.deepEqual(
      calls.map((c) => [c.command, ...c.args]),
      [['git', '-C', dir, 'rev-parse', 'HEAD'], ['./build.sh'], ['./install.sh', cx.repoRoot]],
    );
    assert.ok(
      calls.slice(1).every((c) => c.cwd === dir),
      'build.sh and install.sh run in tools/agbcc',
    );
    assert.equal(lines.length, 1);
    // Built at the pin: only the commit is checked.
    calls.length = 0;
    assert.equal(await checkoutAgbcc(cx, deps), dir);
    assert.deepEqual(
      calls.map((c) => c.command),
      ['git'],
    );
    // A build without its stamp, or with another pin's, is built again.
    await rm(join(dir, AGBCC_PIN_STAMP));
    calls.length = 0;
    await checkoutAgbcc(cx, deps);
    assert.ok(
      calls.some((c) => c.command === './build.sh'),
      'an unstamped build is rebuilt',
    );
    await writeFile(join(dir, AGBCC_PIN_STAMP), pinText({ ...PIN, commit: 'a'.repeat(40) }));
    calls.length = 0;
    await checkoutAgbcc(cx, deps);
    assert.ok(
      calls.some((c) => c.command === './build.sh'),
      'a build of another pin is rebuilt',
    );
    assert.equal(await agbccPinProblem(dir, PIN), undefined);
  });
});

test('checkoutAgbcc refuses a submodule that is not checked out, or is checked out at another commit than the pin', async () => {
  await withTempDir('romlift-agbcc-refuse-', async (root) => {
    const absent = await checkout(join(root, 'absent'), false);
    await assert.rejects(
      checkoutAgbcc(absent, { run: fakeAgbcc([]), log: () => {} }),
      /tools\/agbcc is not checked out: run `git submodule update --init tools\/agbcc`/,
    );
    const elsewhere = await checkout(join(root, 'elsewhere'));
    const calls: Call[] = [];
    await assert.rejects(
      checkoutAgbcc(elsewhere, { run: fakeAgbcc(calls, { head: 'b'.repeat(40) }), log: () => {} }),
      new RegExp(
        `is at b{40}, but templates/agbcc\\.json pins ${PIN.commit}: run \`git submodule update tools/agbcc\``,
      ),
    );
    assert.ok(!calls.some((c) => c.command === './build.sh'), 'nothing is built at the wrong commit');
  });
});

test('checkoutAgbcc: a failing build throws with its output and stamps nothing', async () => {
  await withTempDir('romlift-agbcc-fail-', async (root) => {
    const cx = await checkout(root);
    await assert.rejects(
      checkoutAgbcc(cx, { run: fakeAgbcc([], { buildFails: true }), log: () => {} }),
      /agbcc: build\.sh exited 2:\ngcc: error/,
    );
    assert.match((await agbccPinProblem(checkoutAgbccPath(cx), PIN)) ?? '', /records no pin/);
  });
});

test('agbccPinProblem: a build stamped with the pin may be used; no stamp, or another pin, may not', async () => {
  await withTempDir('romlift-agbcc-stamp-', async (dir) => {
    assert.match((await agbccPinProblem(dir, PIN)) ?? '', /records no pin \(no romlift-agbcc-pin\.json\)/);
    await writeFile(join(dir, AGBCC_PIN_STAMP), pinText(PIN));
    assert.equal(await agbccPinProblem(dir, PIN), undefined);
    assert.match(
      (await agbccPinProblem(dir, { ...PIN, commit: 'a'.repeat(40) })) ?? '',
      /was built at .*, not at templates\/agbcc\.json's .*aaaa/,
    );
  });
});
