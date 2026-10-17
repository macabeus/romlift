// readRom (shell/rom.ts): the bytes of a ROM file, hashed by the shell, as the Rom the core reads.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { sha1Of } from '../../../src/shell/hash.ts';
import { readRom } from '../../../src/shell/rom.ts';

let dir = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'romlift-rom-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('readRom reads, hashes and wraps a ROM, or reports E_IO_READ', async () => {
  const path = join(dir, 'rom.gba');
  await writeFile(path, new Uint8Array(0x200));
  const rom = await readRom(path);
  assert.ok(rom.ok);
  assert.equal(rom.value.bytes.length, 0x200);
  assert.equal(rom.value.sha1, sha1Of(new Uint8Array(0x200)));
  const missing = await readRom(join(dir, 'missing.gba'));
  assert.ok(!missing.ok);
  assert.equal(missing.diagnostic.code, 'E_IO_READ');
});
