// The GNU binutils runner: finds arm-none-eabi-{as,ld,objcopy} on the PATH, reports their versions,
// assembles a source text to the bytes of its `.text` section (as with the dialect's arguments, then
// objcopy -O binary -j .text), and links several sources with a linker script to the bytes of the
// linked `.text`, each in a temporary directory that is always removed. It decides nothing: callers
// choose what to assemble and what the bytes mean.
import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, normalize, sep } from 'node:path';

import { DIALECT } from '../../foundation/asm/dialect.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Mode } from '../../foundation/rom/span.ts';
import { ShellCodes } from '../codes.ts';

/** Absolute paths of the three binutils programs romlift runs. */
export interface Binutils {
  readonly as: string;
  readonly ld: string;
  readonly objcopy: string;
}

export interface BinutilsVersions {
  readonly as: string;
  readonly ld: string;
  readonly objcopy: string;
}

export interface AssembleOptions {
  /** The instruction set `as` starts in (`-mthumb` for Thumb); the source's own directives still apply. */
  readonly mode?: Mode;
  /** Files written beside the source before assembling, by relative path (e.g. include/macros.inc). */
  readonly files?: Readonly<Record<string, string>>;
  /** Arguments added after DIALECT.asArgs. */
  readonly args?: readonly string[];
  /** The programs to run; default: findBinutils(process.env). */
  readonly tools?: Binutils;
}

/** One source of a link: assembled to `<name>.o`, which the linker script may name. */
export interface LinkSource {
  /** A file stem without directory or extension, e.g. `a` for `a.s` and `a.o`. */
  readonly name: string;
  readonly text: string;
  readonly mode?: Mode;
}

export interface LinkOptions {
  /** The text of the linker script, passed to ld with -T; it names the objects as `<name>.o`. */
  readonly script: string;
  /** The programs to run; default: findBinutils(process.env). */
  readonly tools?: Binutils;
}

export type AssembleResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly stderr: string; readonly diagnostics: readonly Diagnostic[] };

const PREFIX = 'arm-none-eabi-';
const TOOLS = ['as', 'ld', 'objcopy'] as const;

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The first executable named `name` on the PATH of `env` (with a PATHEXT suffix where one is set). */
export function findExecutable(name: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  const dirs = (env['PATH'] ?? '').split(delimiter).filter((d) => d !== '');
  const suffixes = ['', ...(env['PATHEXT'] ?? '').split(';').filter((s) => s !== '')];
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = join(dir, name + suffix);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

/** The binutils on the PATH of `env`, or E_TOOLCHAIN_MISSING naming the programs it lacks. */
export function findBinutils(env: Readonly<Record<string, string | undefined>>): Binutils | Diagnostic<'E_TOOLCHAIN_MISSING'> {
  const found: Partial<Record<(typeof TOOLS)[number], string>> = {};
  const missing: string[] = [];
  for (const tool of TOOLS) {
    const path = findExecutable(PREFIX + tool, env);
    if (path === undefined) missing.push(PREFIX + tool);
    else found[tool] = path;
  }
  if (found.as === undefined || found.ld === undefined || found.objcopy === undefined) {
    return diagnostic<'E_TOOLCHAIN_MISSING'>(ShellCodes, 'E_TOOLCHAIN_MISSING', `not on the PATH: ${missing.join(', ')}`);
  }
  return { as: found.as, ld: found.ld, objcopy: found.objcopy };
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(file: string, args: readonly string[], cwd?: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(file, [...args], { cwd, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ code, stdout, stderr: error !== null && stderr === '' ? error.message : stderr });
    });
  });
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

/** The first line of each program's `--version` (empty when the program cannot run). */
export async function binutilsVersions(tools: Binutils): Promise<BinutilsVersions> {
  const [as, ld, objcopy] = await Promise.all([tools.as, tools.ld, tools.objcopy].map((t) => run(t, ['--version'])));
  return { as: firstLine(as?.stdout ?? ''), ld: firstLine(ld?.stdout ?? ''), objcopy: firstLine(objcopy?.stdout ?? '') };
}

/** A relative path that stays inside its directory, or undefined. */
function safeRelative(path: string): string | undefined {
  const normal = normalize(path);
  return isAbsolute(normal) || normal === '..' || normal.startsWith(`..${sep}`) ? undefined : normal;
}

function failed(stderr: string, message: string): AssembleResult {
  return { ok: false, stderr, diagnostics: [diagnostic(ShellCodes, 'E_TOOLCHAIN_FAILED', message)] };
}

/** A file stem that names a file directly inside a directory. */
function isStem(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name);
}

/** The arguments of `as` for one source in `mode`. */
function asArgs(mode: Mode | undefined, extra: readonly string[], source: string, object: string): string[] {
  return [...DIALECT.asArgs, ...(mode === 'thumb' ? ['-mthumb'] : []), ...extra, '-o', object, source];
}

/** The `.text` of `object` (an ELF in `dir`) as raw bytes, through objcopy -O binary -j .text. */
async function textBytes(tools: Binutils, dir: string, object: string): Promise<AssembleResult> {
  const objcopy = await run(tools.objcopy, ['-O', 'binary', '-j', '.text', object, 'text.bin'], dir);
  if (objcopy.code !== 0) return failed(objcopy.stderr, `arm-none-eabi-objcopy exited with ${objcopy.code}`);
  const bytes = await readFile(join(dir, 'text.bin'));
  return { ok: true, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

/**
 * Assembles `source` with the PATH's arm-none-eabi-as and returns its `.text` bytes. The source and
 * `files` are written to a fresh temporary directory, which is the working directory of `as` (so
 * `.include "include/macros.inc"` resolves there) and is removed afterwards.
 */
export async function assembleWithBinutils(source: string, options: AssembleOptions = {}): Promise<AssembleResult> {
  const tools = options.tools ?? findBinutils(process.env);
  if ('code' in tools) return { ok: false, stderr: '', diagnostics: [tools] };
  const dir = await mkdtemp(join(tmpdir(), 'romlift-as-'));
  try {
    for (const [path, text] of Object.entries(options.files ?? {})) {
      const relative = safeRelative(path);
      if (relative === undefined) return failed('', `refusing to write ${path} outside the assembly directory`);
      await mkdir(dirname(join(dir, relative)), { recursive: true });
      await writeFile(join(dir, relative), text);
    }
    await writeFile(join(dir, 'source.s'), source);
    const as = await run(tools.as, asArgs(options.mode, options.args ?? [], 'source.s', 'source.o'), dir);
    if (as.code !== 0) return failed(as.stderr, `arm-none-eabi-as exited with ${as.code}`);
    return await textBytes(tools, dir, 'source.o');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Assembles each source to `<name>.o`, links them with ld -T `options.script` and returns the linked
 * `.text` bytes. Everything happens in a fresh temporary directory, the working directory of every
 * program, which is removed afterwards.
 */
export async function linkWithBinutils(sources: readonly LinkSource[], options: LinkOptions): Promise<AssembleResult> {
  const tools = options.tools ?? findBinutils(process.env);
  if ('code' in tools) return { ok: false, stderr: '', diagnostics: [tools] };
  const bad = sources.find((s) => !isStem(s.name) || s.name === 'link' || s.name === 'linked' || s.name === 'text');
  if (bad !== undefined) return failed('', `refusing the link source name '${bad.name}'`);
  const dir = await mkdtemp(join(tmpdir(), 'romlift-ld-'));
  try {
    for (const source of sources) {
      await writeFile(join(dir, `${source.name}.s`), source.text);
      const as = await run(tools.as, asArgs(source.mode, [], `${source.name}.s`, `${source.name}.o`), dir);
      if (as.code !== 0) return failed(as.stderr, `arm-none-eabi-as exited with ${as.code} on ${source.name}.s`);
    }
    await writeFile(join(dir, 'link.ld'), options.script);
    const ld = await run(tools.ld, ['-T', 'link.ld', '-o', 'linked.elf', ...sources.map((s) => `${s.name}.o`)], dir);
    if (ld.code !== 0) return failed(ld.stderr, `arm-none-eabi-ld exited with ${ld.code}`);
    return await textBytes(tools, dir, 'linked.elf');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
