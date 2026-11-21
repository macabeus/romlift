// File helpers over romlift/node: recursive listing in code-unit order, JSON reading and the pretty
// JSON the committed bench files use. I/O failures throw a BenchError naming the path.
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { compareCodeUnits } from 'romlift';
import { atomicWrite, listDir, readBytes } from 'romlift/node';

/** A failure the bench reports to the user and exits 1 on; never a bug. */
export class BenchError extends Error {
  override readonly name = 'BenchError';
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Files macOS writes into directories on its own; never part of a digest. */
const OS_DROPPINGS: ReadonlySet<string> = new Set(['.DS_Store']);

/**
 * Every file under `dir`, as `/`-separated paths relative to it, sorted by code unit. Directories
 * are walked in listDir order and the result is sorted again, so the order never depends on the
 * file system.
 */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (absolute: string, prefix: string): Promise<void> => {
    const listed = await listDir(absolute);
    if (!listed.ok) throw new BenchError(listed.diagnostic.message);
    for (const name of listed.value) {
      if (OS_DROPPINGS.has(name)) continue;
      const path = join(absolute, name);
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      const info = await stat(path);
      if (info.isDirectory()) await walk(path, relative);
      else if (info.isFile()) out.push(relative);
    }
  };
  await walk(dir, '');
  return out.sort(compareCodeUnits);
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  const read = await readBytes(path);
  if (!read.ok) throw new BenchError(read.diagnostic.message);
  return read.value;
}

export async function readText(path: string): Promise<string> {
  return new TextDecoder().decode(await readFileBytes(path));
}

export async function readJson(path: string): Promise<unknown> {
  const text = await readText(path);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new BenchError(`${path}: not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Two-space JSON with a final newline: the spelling of every committed bench file. */
export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Writes `text` atomically, creating the directory first. */
export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const written = await atomicWrite(path, text);
  if (!written.ok) throw new BenchError(written.diagnostic.message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
