// Fault injection into the project lock (g4.checks-fail, architecture §6.4 step 4, §10, D17): withProjectLock
// (src/shell/project/lock.ts) on temporary project directories. A second run on a locked project is
// E_PROJECT_LOCKED, an error (a command exits `errors`, 1); a lock whose pid is gone on the same host is taken over
// with W_STALE_LOCK; a lock from another host is never taken. Each fault is a source mutant of lock.ts (mutant.ts),
// and the tests below are shown to catch it: a lock taken without O_EXCL, a stale check that ignores the host, a stale
// lock never taken over, and a takeover that does not warn.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { LOCK_PATH } from '../../../src/core/write-plan/types.ts';
import { ShellCodes } from '../../../src/shell/codes.ts';
import { lockText, parseLock, withProjectLock } from '../../../src/shell/project/lock.ts';
import { assertCaught, runUnderMutant, underMutation } from './mutant.ts';
import type { Mutant } from './mutant.ts';

const THIS_FILE = 'test/mutation/phase4/lock.test.ts';
const LOCK_SOURCE = 'src/shell/project/lock.ts';
const LOCK_URL = pathToFileURL(fileURLToPath(new URL('../../../src/shell/project/lock.ts', import.meta.url))).href;

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-mut-lock-'));
  roots.push(dir);
  return dir;
}

async function lockFile(dir: string): Promise<string | undefined> {
  return readFile(join(dir, LOCK_PATH), 'utf8').catch(() => undefined);
}

/** The pid of a process that has exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', '']);
  const pid = child.pid;
  await new Promise((resolve) => child.on('exit', resolve));
  assert.ok(pid !== undefined);
  return pid;
}

/** The exit code a command gives for these diagnostics (architecture §2.1: any error-level one is `errors`). */
function exitFor(diagnostics: readonly { readonly severity: string }[]): ExitCode {
  return diagnostics.some((d) => d.severity === 'error') ? ExitCode.errors : ExitCode.ok;
}

type Holder = ChildProcessByStdio<Writable, Readable, Readable>;

/** Another romlift run, in its own process, holding the lock of `dir` until its stdin closes. */
async function holder(dir: string): Promise<Holder> {
  const code = [
    `import { withProjectLock } from ${JSON.stringify(LOCK_URL)};`,
    `const held = await withProjectLock(${JSON.stringify(dir)}, () => new Promise((done) => {`,
    `  process.stdin.on('end', done);`,
    `  process.stdin.resume();`,
    `  process.stdout.write('held\\n');`,
    `}));`,
    `if (!held.ok) process.stdout.write('refused\\n');`,
  ].join('\n');
  const child = spawn(process.execPath, ['--conditions=source', '--input-type=module', '-e', code], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const first = await new Promise<string>((resolve) => {
    let out = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
      if (out.includes('\n')) resolve(out.trim());
    });
    child.on('close', () => resolve(out.trim()));
  });
  assert.equal(first, 'held', 'the other run took the lock');
  return child;
}

async function release(child: Holder): Promise<void> {
  const closed = new Promise<number | null>((resolve) => child.on('close', (c) => resolve(c)));
  child.stdin.end();
  assert.equal(await closed, 0);
}

const SECOND_RUN = 'a second run on a locked project is E_PROJECT_LOCKED, an error, and the holder keeps its lock';
const STALE = 'a lock whose pid is gone on the same host is taken over with W_STALE_LOCK';
const OTHER_HOST = 'a lock from another host is not taken, even when a process of its pid is gone here';
const RACE = 'two runs racing for a free lock: exactly one runs';

test(SECOND_RUN, async () => {
  const dir = await project();
  const other = await holder(dir);
  try {
    const held = await lockFile(dir);
    const holderLock = parseLock(held ?? '');
    assert.ok(holderLock !== undefined && holderLock.pid === other.pid && holderLock.host === hostname());
    let ran = false;
    const second = await withProjectLock(dir, async () => {
      ran = true;
    });
    assert.equal(second.ok, false);
    assert.equal(ran, false, 'the second run never runs its work');
    assert.deepEqual(
      second.diagnostics.map((d) => [d.code, d.severity]),
      [['E_PROJECT_LOCKED', 'error']],
    );
    assert.equal(ShellCodes.E_PROJECT_LOCKED.severity, 'error');
    assert.equal(exitFor(second.diagnostics), ExitCode.errors);
    assert.match(second.diagnostics[0]?.message ?? '', new RegExp(`held by pid ${other.pid} on `));
    assert.equal(await lockFile(dir), held, 'the refused run leaves the holder lock as it was');
  } finally {
    await release(other);
  }
  assert.equal(await lockFile(dir), undefined, 'the holder released its lock');
  const third = await withProjectLock(dir, async () => 'ran');
  assert.ok(third.ok);
  assert.deepEqual(third.diagnostics, [], 'a released lock is no stale lock');
});

test(STALE, async () => {
  const dir = await project();
  await mkdir(join(dir, '.romlift'));
  const pid = await deadPid();
  await writeFile(join(dir, LOCK_PATH), lockText({ pid, host: hostname() }));
  const outcome = await withProjectLock(dir, async () => parseLock((await lockFile(dir)) ?? ''));
  assert.ok(outcome.ok, JSON.stringify(outcome.diagnostics));
  assert.deepEqual(outcome.value, { pid: process.pid, host: hostname() }, 'the run holds the lock it took over');
  assert.deepEqual(
    outcome.diagnostics.map((d) => [d.code, d.severity]),
    [['W_STALE_LOCK', 'warning']],
  );
  assert.match(
    outcome.diagnostics[0]?.message ?? '',
    new RegExp(`pid ${pid} on ${hostname().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  assert.equal(exitFor(outcome.diagnostics), ExitCode.ok, 'a warning does not fail the command');
  assert.equal(await lockFile(dir), undefined);
});

test(OTHER_HOST, async () => {
  const dir = await project();
  await mkdir(join(dir, '.romlift'));
  const text = lockText({ pid: await deadPid(), host: `${hostname()}.elsewhere` });
  await writeFile(join(dir, LOCK_PATH), text);
  let ran = false;
  const outcome = await withProjectLock(dir, async () => {
    ran = true;
  });
  assert.equal(outcome.ok, false);
  assert.equal(ran, false);
  assert.deepEqual(
    outcome.diagnostics.map((d) => [d.code, d.severity]),
    [['E_PROJECT_LOCKED', 'error']],
  );
  assert.equal(exitFor(outcome.diagnostics), ExitCode.errors);
  assert.equal(await lockFile(dir), text, 'the other host keeps its lock');
});

test(RACE, async () => {
  const dir = await project();
  await mkdir(join(dir, '.romlift'));
  let running = 0;
  let most = 0;
  const work = async (): Promise<void> => {
    running++;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, 20));
    running--;
  };
  const outcomes = await Promise.all([
    withProjectLock(dir, work),
    withProjectLock(dir, work),
    withProjectLock(dir, work),
  ]);
  assert.equal(most, 1, 'never two runs at once');
  assert.equal(outcomes.filter((o) => o.ok).length, 1);
  for (const o of outcomes.filter((x) => !x.ok))
    assert.deepEqual(
      o.diagnostics.map((d) => d.code),
      ['E_PROJECT_LOCKED'],
    );
  assert.equal(await lockFile(dir), undefined);
});

const MUTANTS: readonly Mutant[] = [
  {
    name: 'the lock is taken without O_EXCL',
    mutations: [{ file: LOCK_SOURCE, from: "handle = await open(file, 'wx');", to: "handle = await open(file, 'w');" }],
    caughtBy: [SECOND_RUN, RACE],
  },
  {
    name: 'the stale check ignores the host',
    mutations: [
      {
        file: LOCK_SOURCE,
        from: 'if (holder.host !== self?.host || processAlive(holder.pid)) {',
        to: 'if (processAlive(holder.pid)) {',
      },
    ],
    caughtBy: [OTHER_HOST],
  },
  {
    name: 'a stale lock is never taken over',
    mutations: [
      {
        file: LOCK_SOURCE,
        from: 'if (holder.host !== self?.host || processAlive(holder.pid)) {',
        to: 'if (holder.host !== self?.host || processAlive(holder.pid) || true) {',
      },
    ],
    caughtBy: [STALE],
  },
  {
    name: 'a stale lock is taken over without W_STALE_LOCK',
    // The diagnostic is built and dropped: pushed onto a throwaway array (a call, so the argument list's trailing comma
    // stays legal).
    mutations: [{ file: LOCK_SOURCE, from: 'notes.push(', to: 'void [].push(' }],
    caughtBy: [STALE],
  },
];

test(
  'control: the tests pass with lock.ts loaded through the mutant harness unchanged',
  { skip: underMutation() },
  async () => {
    const from = "handle = await open(file, 'wx');";
    const run = await runUnderMutant(THIS_FILE, {
      name: 'identity',
      mutations: [{ file: LOCK_SOURCE, from, to: from }],
      caughtBy: [],
    });
    assert.equal(run.code, 0, run.output.split('\n').slice(-40).join('\n'));
    assert.deepEqual(run.failed, []);
  },
);

for (const mutant of MUTANTS) {
  test(`mutant caught: ${mutant.name}`, { skip: underMutation() }, async (t) => {
    const failed = await assertCaught(THIS_FILE, mutant);
    t.diagnostic(`mutant killed (expected) by: ${failed.join('; ')}`);
  });
}
