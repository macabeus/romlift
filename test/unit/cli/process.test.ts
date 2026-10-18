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

test('a reader that closes the pipe early is no error: analyze | head exits quietly, with no EPIPE trace', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { romWith, words } = await import('../../helpers/analysis.ts');
  // 4,096 Thumb pointers to undecodable halfwords: one rejection line each, far more than a pipe buffer.
  const targets = Array.from({ length: 4096 }, (_, i) => 0x0801_0000 + 4 * i + 1);
  const rom = romWith([{ at: 0x0800_1000, bytes: words(...targets) }, { at: 0x0801_0000, bytes: new Uint8Array(4 * 4096).fill(0xff) }]);
  const dir = mkdtempSync(join(tmpdir(), 'romlift-epipe-'));
  try {
    const path = join(dir, 'many.gba');
    writeFileSync(path, rom.bytes);
    const child = spawn(process.execPath, ['--conditions=source', 'src/cli/main.ts', 'analyze', path, '--json'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
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
