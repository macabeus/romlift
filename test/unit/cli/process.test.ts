// Runs the real entry point as a child process with stdin closed: it must never wait for input. A write to a reader
// that has gone (EPIPE on a pipe, ENOTCONN on macOS's socket-pair stdout) exits quietly; any other error is thrown.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { exitQuietlyOnEpipe } from '../../../src/cli/main.ts';

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

test('a reader that closes the pipe early is no error: generate --dry-run | head exits quietly, with no EPIPE trace', async () => {
  const { spawn, spawnSync } = await import('node:child_process');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { romWith, words } = await import('../../helpers/analysis.ts');
  // 4,096 Thumb pointers to `bx lr; nop` stubs: 4,096 functions, so one op line per chunk file, far more than a pipe buffer.
  const targets = Array.from({ length: 4096 }, (_, i) => 0x0801_0000 + 4 * i + 1);
  const stubs = new Uint8Array(4 * 4096);
  for (let i = 0; i < 4096; i++) stubs.set([0x70, 0x47, 0xc0, 0x46], 4 * i);
  const rom = romWith([{ at: 0x0800_1000, bytes: words(...targets) }, { at: 0x0801_0000, bytes: stubs }]);
  const dir = mkdtempSync(join(tmpdir(), 'romlift-epipe-'));
  try {
    writeFileSync(join(dir, 'baserom.gba'), rom.bytes);
    // ROMLIFT_CLI set: init skips the npm lock step, as a romlift checkout runs it.
    const env = { ...process.env, ROMLIFT_CLI: 'romlift' };
    const init = spawnSync(process.execPath, ['--conditions=source', join(ROOT, 'src/cli/main.ts'), 'init', 'baserom.gba', '--json'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stdout + init.stderr);
    const child = spawn(process.execPath, ['--conditions=source', join(ROOT, 'src/cli/main.ts'), 'generate', '--dry-run', '--json'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.stdout.once('data', () => child.stdout.destroy());
    const status = await new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
    assert.equal(status, 0, stderr);
    assert.doesNotMatch(stderr, /EPIPE|Error/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** An emitter's error event with errno `code`, as a stream raises it on a failed write. */
function writeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`write ${code}`), { code, errno: -1, syscall: 'write' });
}

for (const code of ['EPIPE', 'ENOTCONN']) {
  test(`a write that fails with ${code} (a reader that has gone) exits quietly (correctness-ci-1)`, () => {
    const stream = new EventEmitter();
    let exits = 0;
    exitQuietlyOnEpipe(stream, () => {
      exits++;
    });
    assert.doesNotThrow(() => stream.emit('error', writeError(code)));
    assert.equal(exits, 1);
  });
}

test('any other write error is thrown, and the process does not exit quietly', () => {
  const stream = new EventEmitter();
  let exits = 0;
  exitQuietlyOnEpipe(stream, () => {
    exits++;
  });
  for (const code of ['EIO', 'ENOSPC']) assert.throws(() => stream.emit('error', writeError(code)), new RegExp(`write ${code}`));
  assert.throws(() => stream.emit('error', new Error('no code')), /no code/);
  assert.equal(exits, 0);
});
