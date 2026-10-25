import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { atomicWrite, isDirectory, isRegularFile, listDir, readBytes, readJson } from '../../../src/shell/fs.ts';

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

test('atomicWrite with inPlaceWhenAbsent and not durable creates an absent file in place, replaces an existing one, and removes a partial one', async () => {
  const sub = join(dir, 'in-place');
  await mkdir(sub);
  const path = join(sub, 'gen.s');
  const fast = { durable: false, inPlaceWhenAbsent: true } as const;
  assert.deepEqual(await atomicWrite(path, 'first', fast), { ok: true, value: undefined });
  assert.equal(await readFile(path, 'utf8'), 'first');
  function* chunks(): Generator<string> {
    for (let i = 0; i < 300_000; i++) yield `${i % 10}`;
  }
  assert.ok((await atomicWrite(path, chunks(), fast)).ok, 'an existing file goes through a temporary file');
  assert.equal((await readFile(path, 'utf8')).length, 300_000);
  const fresh = join(sub, 'stream.s');
  assert.ok((await atomicWrite(fresh, chunks(), fast)).ok);
  assert.equal((await readFile(fresh, 'utf8')).slice(0, 12), '012345678901');
  function* broken(): Generator<string> {
    yield 'partial';
    throw new Error('stream broke');
  }
  const failed = await atomicWrite(join(sub, 'broken.s'), broken(), fast);
  assert.ok(!failed.ok);
  assert.equal(failed.diagnostic.code, 'E_IO_WRITE');
  assert.deepEqual(await readdir(sub), ['gen.s', 'stream.s']);
});

// Fix round 5 (architecture-b0-6): a failure other than ENOENT/ENOTDIR is reported, never read as absent.
test('isDirectory: absent and a file are false; a path it cannot examine is E_IO_READ', { skip: process.getuid?.() === 0 ? 'root reads through mode 000' : false }, async () => {
  await mkdir(join(dir, 'is-dir', 'locked', 'inner'), { recursive: true });
  await writeFile(join(dir, 'is-dir', 'file'), 'x');
  assert.deepEqual(await isDirectory(join(dir, 'is-dir', 'locked')), { ok: true, value: true });
  assert.deepEqual(await isDirectory(join(dir, 'is-dir', 'absent')), { ok: true, value: false });
  assert.deepEqual(await isDirectory(join(dir, 'is-dir', 'file')), { ok: true, value: false });
  assert.deepEqual(await isDirectory(join(dir, 'is-dir', 'file', 'below')), { ok: true, value: false }, 'ENOTDIR');
  await chmod(join(dir, 'is-dir', 'locked'), 0o000);
  try {
    const locked = await isDirectory(join(dir, 'is-dir', 'locked', 'inner'));
    assert.equal(locked.ok, false);
    assert.ok(!locked.ok && locked.diagnostic.code === 'E_IO_READ');
  } finally {
    await chmod(join(dir, 'is-dir', 'locked'), 0o755);
  }
});

// Fix round 2 (architecture-r1-4): isRegularFile and readJson, beside isDirectory.
test('isRegularFile: a file and a link to one are true; absent, ENOTDIR and a directory false; a path it cannot examine is E_IO_READ', { skip: process.getuid?.() === 0 ? 'root reads through mode 000' : false }, async () => {
  await mkdir(join(dir, 'is-file', 'locked'), { recursive: true });
  await writeFile(join(dir, 'is-file', 'file'), 'x');
  await writeFile(join(dir, 'is-file', 'locked', 'inner'), 'x');
  await symlink(join(dir, 'is-file', 'file'), join(dir, 'is-file', 'link'));
  assert.deepEqual(await isRegularFile(join(dir, 'is-file', 'file')), { ok: true, value: true });
  assert.deepEqual(await isRegularFile(join(dir, 'is-file', 'link')), { ok: true, value: true });
  assert.deepEqual(await isRegularFile(join(dir, 'is-file', 'absent')), { ok: true, value: false });
  assert.deepEqual(await isRegularFile(join(dir, 'is-file', 'file', 'below')), { ok: true, value: false }, 'ENOTDIR');
  assert.deepEqual(await isRegularFile(join(dir, 'is-file', 'locked')), { ok: true, value: false }, 'a directory');
  await chmod(join(dir, 'is-file', 'locked'), 0o000);
  try {
    const locked = await isRegularFile(join(dir, 'is-file', 'locked', 'inner'));
    assert.equal(locked.ok, false);
    assert.ok(!locked.ok && locked.diagnostic.code === 'E_IO_READ', 'EACCES is never read as absent');
  } finally {
    await chmod(join(dir, 'is-file', 'locked'), 0o755);
  }
});

test('readJson: the decoded value; E_IO_READ when unreadable; the caller\'s code when not JSON or refused by the decoder', { skip: process.getuid?.() === 0 ? 'root reads through mode 000' : false }, async () => {
  const sub = join(dir, 'json');
  await mkdir(sub);
  const decode = (json: unknown): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: string } =>
    typeof json === 'object' && json !== null && typeof (json as { n?: unknown }).n === 'number' ? { ok: true, value: (json as { n: number }).n } : { ok: false, error: 'has no number n' };
  await writeFile(join(sub, 'good.json'), '{"n": 7}');
  await writeFile(join(sub, 'bad.json'), '{"n": ');
  await writeFile(join(sub, 'other.json'), '{"m": 1}');
  await writeFile(join(sub, 'locked.json'), '{"n": 1}');
  assert.deepEqual(await readJson(join(sub, 'good.json'), decode, 'E_SIGNATURE_FILE_INVALID'), { ok: true, value: 7 });
  const bad = await readJson(join(sub, 'bad.json'), decode, 'E_SIGNATURE_FILE_INVALID');
  assert.ok(!bad.ok && bad.diagnostic.code === 'E_SIGNATURE_FILE_INVALID' && / is not JSON: /.test(bad.diagnostic.message), JSON.stringify(bad));
  const other = await readJson(join(sub, 'other.json'), decode, 'E_SIGNATURE_SPEC_INVALID');
  assert.ok(!other.ok && other.diagnostic.code === 'E_SIGNATURE_SPEC_INVALID' && other.diagnostic.message.endsWith('other.json: has no number n'), JSON.stringify(other));
  const absent = await readJson(join(sub, 'absent.json'), decode, 'E_SIGNATURE_FILE_INVALID');
  assert.ok(!absent.ok && absent.diagnostic.code === 'E_IO_READ');
  await chmod(join(sub, 'locked.json'), 0o000);
  try {
    const locked = await readJson(join(sub, 'locked.json'), decode, 'E_SIGNATURE_FILE_INVALID');
    assert.ok(!locked.ok && locked.diagnostic.code === 'E_IO_READ', 'EACCES');
  } finally {
    await chmod(join(sub, 'locked.json'), 0o644);
  }
});
