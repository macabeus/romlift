import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { atomicWrite, listDir, readBytes } from '../../../src/shell/fs.ts';

let dir = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'romlift-fs-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('listDir sorts mixed-case and non-ASCII names by code unit', async () => {
  const sub = join(dir, 'list');
  await mkdir(sub);
  // No two names differ only by case, so the test holds on case-insensitive file systems too.
  const names = ['beta', 'Alpha', 'zeta', 'Delta', 'é', 'e2', '_x', '10', '9'];
  for (const name of names) await writeFile(join(sub, name), name);
  const listed = await listDir(sub);
  assert.ok(listed.ok);
  assert.deepEqual(listed.value, ['10', '9', 'Alpha', 'Delta', '_x', 'beta', 'e2', 'zeta', 'é']);
});

test('listDir and readBytes report E_IO_READ with the path', async () => {
  const missing = join(dir, 'missing');
  const listed = await listDir(missing);
  assert.ok(!listed.ok);
  assert.equal(listed.diagnostic.code, 'E_IO_READ');
  assert.equal(listed.diagnostic.severity, 'error');
  assert.equal(listed.diagnostic.path, missing);
  const read = await readBytes(join(dir, 'missing.bin'));
  assert.ok(!read.ok);
  assert.equal(read.diagnostic.code, 'E_IO_READ');
  assert.match(read.diagnostic.message, /ENOENT/);
  assert.doesNotMatch(read.diagnostic.message, /ENOENT: ENOENT/, 'the code is named once');
});

test('readBytes returns the file contents', async () => {
  const path = join(dir, 'bytes.bin');
  await writeFile(path, new Uint8Array([1, 2, 3, 255]));
  const read = await readBytes(path);
  assert.ok(read.ok);
  assert.deepEqual([...read.value], [1, 2, 3, 255]);
});

test('atomicWrite writes strings, bytes and chunk streams, replaces the file and leaves no temp file', async () => {
  const sub = join(dir, 'write');
  await mkdir(sub);
  const path = join(sub, 'out.json');
  assert.deepEqual(await atomicWrite(path, 'first'), { ok: true, value: undefined });
  assert.equal(await readFile(path, 'utf8'), 'first');
  assert.ok((await atomicWrite(path, new Uint8Array([0x68, 0x69]))).ok);
  assert.equal(await readFile(path, 'utf8'), 'hi');
  function* chunks(): Generator<string> {
    for (let i = 0; i < 300_000; i++) yield `${i % 10}`;
  }
  assert.ok((await atomicWrite(path, chunks())).ok);
  const written = await readFile(path, 'utf8');
  assert.equal(written.length, 300_000);
  assert.equal(written.slice(0, 12), '012345678901');
  assert.deepEqual(await readdir(sub), ['out.json']);
});

test('atomicWrite keeps the old file when the data stream fails, and removes its temp file', async () => {
  const sub = join(dir, 'fail');
  await mkdir(sub);
  const path = join(sub, 'keep.txt');
  await writeFile(path, 'old');
  function* broken(): Generator<string> {
    yield 'partial';
    throw new Error('stream broke');
  }
  const result = await atomicWrite(path, broken());
  assert.ok(!result.ok);
  assert.equal(result.diagnostic.code, 'E_IO_WRITE');
  assert.equal(result.diagnostic.path, path);
  assert.equal(await readFile(path, 'utf8'), 'old');
  assert.deepEqual(await readdir(sub), ['keep.txt']);
});

test('atomicWrite into a missing directory reports E_IO_WRITE', async () => {
  const result = await atomicWrite(join(dir, 'nope', 'file.txt'), 'x');
  assert.ok(!result.ok);
  assert.equal(result.diagnostic.code, 'E_IO_WRITE');
});
