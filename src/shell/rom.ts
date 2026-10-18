// Reading a ROM file: its bytes, their SHA-1 (the shell hashes, D44) and the Rom value the core reads. A
// failure is the E_IO_READ diagnostic of reading it, never a throw.
import { romFromBytes } from '../foundation/rom/rom.ts';
import type { Rom } from '../foundation/rom/rom.ts';
import { readBytes } from './fs.ts';
import type { IoResult } from './fs.ts';
import { sha1Of } from './hash.ts';

/** The ROM at `path`, or the E_IO_READ diagnostic of reading it. */
export async function readRom(path: string): Promise<IoResult<Rom>> {
  const read = await readBytes(path);
  return read.ok ? { ok: true, value: romFromBytes(read.value, sha1Of(read.value)) } : read;
}
