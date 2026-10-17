// Runs the real entry point as a child process with stdin closed: it must never wait for input.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function run(args: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, ['--conditions=source', 'src/cli/main.ts', ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('romlift --help exits 0 with usage on stdout and nothing on stderr', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: romlift <command> \[options\]\n/);
  assert.equal(result.stderr, '');
});

test('romlift with no arguments exits 0 with usage', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: romlift /);
});

test('an unknown command exits 2 with the message on stderr', () => {
  const result = run(['no-such-command']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^romlift: unknown command 'no-such-command'\n\nUsage: romlift /);
});

test('importing main.ts does not run it', async () => {
  const module = await import('../../../src/cli/main.ts');
  assert.equal(typeof module.main, 'function');
});
