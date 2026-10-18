// withProjectLock (architecture §6.4 step 4, D17): O_EXCL `.romlift/lock` with the pid and host; a second
// holder is refused with E_PROJECT_LOCKED; a lock whose process is gone on this host is taken over with
// W_STALE_LOCK; the lock is released when the function returns and when it throws.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { LOCK_PATH } from '../../../../src/core/write-plan/types.ts';
import { lockText, parseLock, processAlive, removeStale, withProjectLock } from '../../../../src/shell/project/lock.ts';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-lock-'));
  roots.push(dir);
  return dir;
}

async function lockExists(dir: string): Promise<boolean> {
  return (await readdir(join(dir, '.romlift'))).includes('lock');
}

/** The pid of a process that has exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', '']);
  const pid = child.pid;
  await new Promise((resolve) => child.on('exit', resolve));
  assert.ok(pid !== undefined);
  return pid;
}

test('the lock holds this pid and host while the function runs, and is released after', async () => {
  const dir = await tempDir();
  const outcome = await withProjectLock(dir, async () => parseLock(await readFile(join(dir, LOCK_PATH), 'utf8')));
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.value, { pid: process.pid, host: hostname() });
  assert.deepEqual(outcome.diagnostics, []);
  assert.equal(await lockExists(dir), false);
});

test('a second holder is refused with E_PROJECT_LOCKED and the first keeps its lock', async () => {
  const dir = await tempDir();
  const outer = await withProjectLock(dir, async () => {
    let ran = false;
    const inner = await withProjectLock(dir, async () => {
      ran = true;
    });
    return { inner, ran, held: await lockExists(dir) };
  });
  assert.ok(outer.ok);
  const { inner, ran, held } = outer.value;
  assert.equal(ran, false);
  assert.equal(inner.ok, false);
  assert.deepEqual(inner.diagnostics.map((d) => [d.code, d.severity]), [['E_PROJECT_LOCKED', 'error']]);
  assert.match(inner.diagnostics[0]?.message ?? '', new RegExp(`pid ${process.pid}`));
  assert.equal(held, true, 'the refused run did not remove the holder lock');
  assert.equal(await lockExists(dir), false);
});

test('a lock held by a live process, or one on another host, is refused', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, '.romlift'));
  await writeFile(join(dir, LOCK_PATH), lockText({ pid: process.ppid, host: hostname() }));
  const live = await withProjectLock(dir, async () => 1);
  assert.deepEqual(live.diagnostics.map((d) => d.code), ['E_PROJECT_LOCKED']);
  await writeFile(join(dir, LOCK_PATH), lockText({ pid: await deadPid(), host: `${hostname()}-elsewhere` }));
  const remote = await withProjectLock(dir, async () => 1);
  assert.deepEqual(remote.diagnostics.map((d) => d.code), ['E_PROJECT_LOCKED']);
  assert.equal(await lockExists(dir), true, 'a refused run never removes a lock it does not hold');
});

test('an empty or damaged lock is refused, never taken over', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, '.romlift'));
  for (const text of ['', '{', '{"pid":"1","host":"h"}', '{"pid":0,"host":"h"}']) {
    await writeFile(join(dir, LOCK_PATH), text);
    const outcome = await withProjectLock(dir, async () => 1);
    assert.equal(outcome.ok, false, JSON.stringify(text));
    assert.deepEqual(outcome.diagnostics.map((d) => d.code), ['E_PROJECT_LOCKED']);
    assert.match(outcome.diagnostics[0]?.message ?? '', /remove it/);
  }
});

test('a lock whose process is gone on this host is taken over with W_STALE_LOCK', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, '.romlift'));
  const pid = await deadPid();
  assert.equal(processAlive(pid), false);
  await writeFile(join(dir, LOCK_PATH), lockText({ pid, host: hostname() }));
  const outcome = await withProjectLock(dir, async () => parseLock(await readFile(join(dir, LOCK_PATH), 'utf8')));
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.value, { pid: process.pid, host: hostname() });
  assert.deepEqual(outcome.diagnostics.map((d) => [d.code, d.severity]), [['W_STALE_LOCK', 'warning']]);
  assert.match(outcome.diagnostics[0]?.message ?? '', new RegExp(`pid ${pid}`));
  assert.equal(await lockExists(dir), false);
  assert.deepEqual((await readdir(join(dir, '.romlift'))).filter((n) => n.endsWith('.stale')), []);
});

test('the lock is released when the function throws, and the error propagates', async () => {
  const dir = await tempDir();
  await assert.rejects(
    withProjectLock(dir, async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(await lockExists(dir), false);
  const again = await withProjectLock(dir, async () => 'next');
  assert.ok(again.ok);
  assert.equal(again.value, 'next');
});

test('a lock text round-trips and processAlive sees this process', () => {
  assert.deepEqual(parseLock(lockText({ pid: 42, host: 'h' })), { pid: 42, host: 'h' });
  assert.equal(lockText({ pid: 42, host: 'h' }), '{"host":"h","pid":42}\n');
  assert.equal(processAlive(process.pid), true);
});

test('two runs taking over one stale lock at once: one takes it with W_STALE_LOCK, the other is refused (architecture-11)', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, '.romlift'));
  await writeFile(join(dir, LOCK_PATH), lockText({ pid: await deadPid(), host: hostname() }));
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withProjectLock(dir, async () => held);
  const second = withProjectLock(dir, async () => 'second ran');
  const refused = await second;
  release();
  const taken = await first;
  const outcomes = [taken, refused];
  assert.equal(outcomes.filter((o) => o.ok).length, 1, 'exactly one run holds the lock');
  const loser = outcomes.find((o) => !o.ok);
  assert.ok(loser !== undefined);
  assert.equal(loser.diagnostics[0]?.code, 'E_PROJECT_LOCKED');
  assert.ok(outcomes.find((o) => o.ok)?.diagnostics.some((d) => d.code === 'W_STALE_LOCK'));
  assert.equal(await lockExists(dir), false);
  assert.deepEqual((await readdir(join(dir, '.romlift'))).filter((n) => n.endsWith('.stale')), []);
});

test('a lock that cannot be read after a create found it (a directory there) is retried, then refused', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, LOCK_PATH), { recursive: true });
  const outcome = await withProjectLock(dir, async () => 'ran');
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.diagnostics.map((d) => d.code), ['E_PROJECT_LOCKED']);
  assert.match(outcome.diagnostics[0]?.message ?? '', /could not be taken/);
});

test('removeStale moves only the stale lock: a lock another run just took is put back, a missing one is not taken', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, '.romlift'));
  const file = join(dir, LOCK_PATH);
  const stale = lockText({ pid: 1, host: 'gone' });
  const fresh = lockText({ pid: process.pid, host: hostname() });
  await writeFile(file, fresh);
  assert.equal(await removeStale(file, stale), false);
  assert.equal(await readFile(file, 'utf8'), fresh, 'the other run keeps its lock');
  await rm(file);
  assert.equal(await removeStale(file, stale), false, 'nothing to move');
  await writeFile(file, stale);
  assert.equal(await removeStale(file, stale), true);
  assert.equal(await lockExists(dir), false);
  assert.deepEqual((await readdir(join(dir, '.romlift'))).filter((n) => n.endsWith('.stale')), []);
});
