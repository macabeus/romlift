// init's lock step (architecture §6.3, D55) against a stub npm: it runs `npm install --package-lock-only
// --ignore-scripts` in the project with stdin closed; npm's success is ok; a registry failure, npm missing from the
// PATH, a failure to start and the time limit are each W_LOCKFILE_DEFERRED (a warning) quoting what npm said.
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { NPM_LOCK_ARGS, npmMessage, writePackageLock } from '../../../../src/shell/toolchain/npm.ts';

const DIR = await mkdtemp(path.join(tmpdir(), 'romlift-npm-'));
after(() => rm(DIR, { recursive: true, force: true }));

/** A directory whose `npm` runs `body` (sh). */
async function stubNpm(name: string, body: string): Promise<string> {
  const bin = path.join(DIR, name);
  await mkdir(bin, { recursive: true });
  const npm = path.join(bin, 'npm');
  await writeFile(npm, `#!/bin/sh\n${body}\n`);
  await chmod(npm, 0o755);
  return bin;
}

test('npm exiting 0 writes the lock: ok; it ran in the project with the lock-only arguments and stdin closed', async () => {
  const bin = await stubNpm(
    'ok',
    'printf "%s\\n" "$@" > args.txt; pwd > cwd.txt; if read line; then echo "stdin had $line" > stdin.txt; fi; echo "{}" > package-lock.json; exit 0',
  );
  const project = await mkdtemp(path.join(DIR, 'project-'));
  const result = await writePackageLock(project, { env: { PATH: `${bin}${path.delimiter}/usr/bin:/bin` } });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual((await readFile(path.join(project, 'args.txt'), 'utf8')).trim().split('\n'), [...NPM_LOCK_ARGS]);
  assert.ok(NPM_LOCK_ARGS.includes('--package-lock-only') && NPM_LOCK_ARGS.includes('--ignore-scripts'));
  await assert.rejects(readFile(path.join(project, 'stdin.txt'), 'utf8'), 'stdin is closed, so nothing is read');
  assert.equal(await readFile(path.join(project, 'package-lock.json'), 'utf8'), '{}\n');
});

test("a registry failure is W_LOCKFILE_DEFERRED, a warning quoting npm's error lines", async () => {
  const bin = await stubNpm(
    'e404',
    'echo "npm error code E404" >&2; echo "npm error 404 Not Found - GET https://registry.npmjs.org/romlift" >&2; echo "npm error A complete log" >&2; exit 1',
  );
  const result = await writePackageLock(DIR, { env: { PATH: bin } });
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.diagnostic.code, 'W_LOCKFILE_DEFERRED');
  assert.equal(result.diagnostic.severity, 'warning');
  assert.equal(result.diagnostic.path, 'package-lock.json');
  assert.match(
    result.diagnostic.message,
    /exited 1 \(npm error code E404; npm error 404 Not Found - GET https:\/\/registry\.npmjs\.org\/romlift\); setup\.sh writes it on its first run that installs romlift with npm, and none does while ROMLIFT_CLI is set \(romlift is not on the npm registry until it is published\)$/,
  );
});

test('with ROMLIFT_CLI set, npm is not run and the lock is deferred saying so (final-review clean-clone-5)', async () => {
  const bin = await stubNpm('never', 'echo ran > "$0.ran"; exit 0');
  const result = await writePackageLock(DIR, { env: { PATH: bin, ROMLIFT_CLI: 'node /romlift/dist/cli/main.js' } });
  assert.ok(!result.ok);
  assert.equal(result.diagnostic.code, 'W_LOCKFILE_DEFERRED');
  assert.match(
    result.diagnostic.message,
    /^package-lock\.json not written: ROMLIFT_CLI is set, so npm was not asked; /,
  );
});

test('npm missing from the PATH, an npm that cannot start and the time limit are each deferred', async () => {
  const missing = await writePackageLock(DIR, { env: { PATH: path.join(DIR, 'nowhere') } });
  assert.ok(
    !missing.ok &&
      missing.diagnostic.code === 'W_LOCKFILE_DEFERRED' &&
      /npm is not on the PATH/.test(missing.diagnostic.message),
  );
  const absent = await writePackageLock(DIR, { env: {}, npm: path.join(DIR, 'no-such-npm') });
  assert.ok(!absent.ok && /npm did not start/.test(absent.diagnostic.message));
  const bin = await stubNpm('slow', 'sleep 5; exit 0');
  const started = Date.now();
  const slow = await writePackageLock(DIR, { env: { PATH: `${bin}${path.delimiter}/usr/bin:/bin` }, timeoutMs: 300 });
  assert.ok(
    !slow.ok && /took longer than 300 ms/.test(slow.diagnostic.message),
    slow.ok ? '' : slow.diagnostic.message,
  );
  assert.ok(Date.now() - started < 4000, 'the limit kills npm');
});

test('npmMessage: the first two npm error lines, else the output cut to its length', () => {
  assert.equal(
    npmMessage('npm warn x\nnpm error code ENOTFOUND\nnpm error network down\nnpm error more\n'),
    'npm error code ENOTFOUND; npm error network down',
  );
  assert.equal(npmMessage('  something\n  else  '), 'something else');
  assert.equal(npmMessage('x'.repeat(1000)).length, 301);
});
