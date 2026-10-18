// The toolchain checks of `verify` (architecture §2.1, §6.4): in a directory holding an emitted tree,
// `linkCheck` assembles every build unit with arm-none-eabi-as, links them with the tree's ldscript.txt,
// copies the image out with objcopy -O binary and reports its SHA-1 against the ROM's (`verify --link`, the
// final proof); `assembleCheck` compares each module's object, before linking, with the module's ROM range
// (`verify --assemble`), leaving the fields the linker fills (the object's relocations) to the link.
// Mechanical: the tree, the units and their spans come from the caller (core/model/paths.ts buildUnits).
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { DIALECT } from '../../foundation/asm/dialect.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { parseElf } from '../../foundation/formats/elf.ts';
import type { ElfSection } from '../../foundation/formats/types.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Span } from '../../foundation/rom/span.ts';
import { hex } from '../../foundation/util/hex.ts';
import type { BuildUnit } from '../../core/model/paths.ts';
import { LDSCRIPT_PATH } from '../../core/model/paths.ts';
import type { CheckResult } from '../../core/verify/report.ts';
import { ShellCodes } from '../codes.ts';
import { sha1Of } from '../hash.ts';
import { onDisk } from '../project/disk-state.ts';
import { findBinutils } from './binutils.ts';
import type { Binutils } from './binutils.ts';

/** The files a link needs beside the tree, written only when absent. */
export const MACROS_INC_PATH = 'include/macros.inc';
export const BASEROM_PATH = 'baserom.gba';
/** The linked ELF and its binary image, under the build directory. */
export const LINK_ELF_PATH = 'build/link-check.elf';
export const LINK_IMAGE_PATH = 'build/link-check.gba';

export interface LinkCheckOptions {
  /** The directory holding the emitted tree (ldscript.txt and every unit's source). */
  readonly dir: string;
  readonly rom: Rom;
  /** In link order. */
  readonly units: readonly BuildUnit[];
  /** Default: findBinutils(process.env). */
  readonly tools?: Binutils;
}

/** A unit with the ROM range its object must reproduce. */
export interface AssembleUnit extends BuildUnit {
  readonly span: Span;
}

export interface AssembleCheckOptions {
  readonly dir: string;
  readonly rom: Rom;
  readonly units: readonly AssembleUnit[];
  readonly tools?: Binutils;
}

/**
 * The `link` check. `ok` when the image links and its SHA-1 equals the ROM's; a toolchain or I/O failure
 * carries its diagnostic (E_TOOLCHAIN_MISSING, E_TOOLCHAIN_FAILED, E_IO_*), while a linked image that
 * differs has no diagnostic code (architecture §9.1 has none) and says where in `detail`.
 */
export interface LinkCheckResult extends CheckResult {
  readonly id: 'link';
  /** The SHA-1 of the linked image; null when nothing linked. */
  readonly sha1: string | null;
}

/** One module of the `assemble` check. */
export interface ModuleAssembly {
  readonly module: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** The `assemble` check: `ok` when every unit assembles and each object's `.text` equals its ROM range. */
export interface AssembleCheckResult extends CheckResult {
  readonly id: 'assemble';
  /** In unit order; empty when the toolchain is missing. */
  readonly modules: readonly ModuleAssembly[];
}

interface Run {
  readonly code: number;
  readonly stderr: string;
}

function run(file: string, args: readonly string[], cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(file, [...args], { cwd, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }, (error, _stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ code, stderr: error !== null && stderr === '' ? error.message : stderr });
    });
  });
}

/** The first lines of a program's error output, for a diagnostic. */
function excerpt(stderr: string, lines = 12): string {
  const all = stderr.trimEnd().split('\n');
  return all.length <= lines ? all.join('\n') : `${all.slice(0, lines).join('\n')}\n… (${all.length - lines} more lines)`;
}

function toolFailed(what: string, result: Run, path?: string): Diagnostic {
  const message = `${what} exited with ${result.code}${result.stderr.trim() === '' ? '' : `:\n${excerpt(result.stderr)}`}`;
  return diagnostic(ShellCodes, 'E_TOOLCHAIN_FAILED', message, path === undefined ? {} : { path });
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readOutput(dir: string, path: string): Promise<Uint8Array | Diagnostic> {
  try {
    const bytes = await readFile(onDisk(dir, path));
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } catch (error) {
    return diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${path}: ${reason(error)}`, { path });
  }
}

function isDiagnostic(value: Uint8Array | Diagnostic): value is Diagnostic {
  return !(value instanceof Uint8Array);
}

/** Writes `data` at `path` unless a file is already there. */
async function writeIfAbsent(dir: string, path: string, data: string | Uint8Array): Promise<Diagnostic | undefined> {
  const file = onDisk(dir, path);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'wx' });
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined;
    return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot write ${file}: ${reason(error)}`, { path: file });
  }
}

/** include/macros.inc (DIALECT.macrosInc) and baserom.gba (the ROM's bytes), each when absent. */
async function prepare(dir: string, rom: Rom): Promise<Diagnostic | undefined> {
  return (await writeIfAbsent(dir, MACROS_INC_PATH, DIALECT.macrosInc)) ?? (await writeIfAbsent(dir, BASEROM_PATH, rom.bytes));
}

/** Assembles one unit's source to its object, with DIALECT.asArgs and `-I <dir>`, from `dir`. */
async function assembleUnit(dir: string, unit: BuildUnit, tools: Binutils): Promise<Diagnostic | undefined> {
  if (!unit.source.endsWith('.s')) {
    return diagnostic(ShellCodes, 'E_TOOLCHAIN_FAILED', `${unit.source} (module ${unit.module}) is not an assembly source`, { path: unit.source });
  }
  try {
    await mkdir(dirname(onDisk(dir, unit.object)), { recursive: true });
  } catch (error) {
    return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot create the directory of ${unit.object}: ${reason(error)}`, { path: unit.object });
  }
  const result = await run(tools.as, [...DIALECT.asArgs, '-I', dir, '-o', unit.object, unit.source], dir);
  return result.code === 0 ? undefined : toolFailed(`arm-none-eabi-as on ${unit.source}`, result, unit.source);
}

type Tools = { readonly ok: true; readonly tools: Binutils } | { readonly ok: false; readonly diagnostic: Diagnostic };

function toolsOf(tools: Binutils | undefined): Tools {
  if (tools !== undefined) return { ok: true, tools };
  const found = findBinutils(process.env);
  return 'code' in found ? { ok: false, diagnostic: found } : { ok: true, tools: found };
}

/** Where two images first differ, for a detail line. */
function firstDifference(image: Uint8Array, rom: Rom): string {
  const shared = Math.min(image.length, rom.bytes.length);
  for (let i = 0; i < shared; i++) {
    if (image[i] !== rom.bytes[i]) return `first difference at 0x${hex(rom.base + i)}`;
  }
  return `the image is 0x${image.length.toString(16)} bytes, the ROM 0x${rom.bytes.length.toString(16)}`;
}

function linkResult(ok: boolean, sha1: string | null, detail: string, diagnostics: readonly Diagnostic[]): LinkCheckResult {
  return { id: 'link', ok, detail, diagnostics, sha1 };
}

/**
 * `verify --link` in `dir`: writes include/macros.inc and baserom.gba when absent, assembles every unit to
 * its object, links them in unit order with ldscript.txt into build/link-check.elf, copies it out with
 * objcopy -O binary into build/link-check.gba and compares its SHA-1 with the ROM's.
 */
export async function linkCheck(options: LinkCheckOptions): Promise<LinkCheckResult> {
  const { rom, units } = options;
  const dir = resolve(options.dir);
  const tools = toolsOf(options.tools);
  if (!tools.ok) return linkResult(false, null, 'binutils not found', [tools.diagnostic]);
  const prepared = await prepare(dir, rom);
  if (prepared !== undefined) return linkResult(false, null, prepared.message, [prepared]);
  for (const unit of units) {
    const failed = await assembleUnit(dir, unit, tools.tools);
    if (failed !== undefined) return linkResult(false, null, `module ${unit.module} does not assemble`, [failed]);
  }
  const ld = await run(tools.tools.ld, ['-T', LDSCRIPT_PATH, '-o', LINK_ELF_PATH, ...units.map((u) => u.object)], dir);
  if (ld.code !== 0) return linkResult(false, null, 'the link failed', [toolFailed('arm-none-eabi-ld', ld, LDSCRIPT_PATH)]);
  const objcopy = await run(tools.tools.objcopy, ['-O', 'binary', LINK_ELF_PATH, LINK_IMAGE_PATH], dir);
  if (objcopy.code !== 0) return linkResult(false, null, 'objcopy failed', [toolFailed('arm-none-eabi-objcopy', objcopy, LINK_ELF_PATH)]);
  const image = await readOutput(dir, LINK_IMAGE_PATH);
  if (isDiagnostic(image)) return linkResult(false, null, image.message, [image]);
  const sha1 = sha1Of(image);
  if (sha1 === rom.sha1) return linkResult(true, sha1, `${units.length} units link to the ROM's SHA-1 ${sha1}`, []);
  return linkResult(false, sha1, `the linked image's SHA-1 ${sha1} is not the ROM's ${rom.sha1}: ${firstDifference(image, rom)}`, []);
}

const SHT_REL = 9;
const REL_SIZE = 8;
/** Relocations that change no byte. */
const R_ARM_NONE = 0;
const R_ARM_V4BX = 40;
/** The bytes a relocation's field covers, by type; every other type is a word. */
const FIELD_BYTES: Readonly<Record<number, number>> = {
  5: 2, // R_ARM_ABS16
  8: 1, // R_ARM_ABS8
  11: 2, // R_ARM_THM_PC8
  102: 2, // R_ARM_THM_JUMP11
  103: 2, // R_ARM_THM_JUMP8
};

/** Marks in `mask` (one entry per `.text` byte) every byte a relocation of `.text` leaves to the linker. */
function maskRelocations(object: Uint8Array, sections: readonly ElfSection[], text: ElfSection, mask: Uint8Array): number | string {
  const view = new DataView(object.buffer, object.byteOffset, object.byteLength);
  let masked = 0;
  for (const rel of sections) {
    if (rel.type !== SHT_REL || rel.info !== text.index) continue;
    const size = rel.entsize === 0 ? REL_SIZE : rel.entsize;
    if (size < REL_SIZE || rel.offset + rel.size > object.length) return `relocation section ${rel.name} is malformed`;
    for (let at = rel.offset; at + REL_SIZE <= rel.offset + rel.size; at += size) {
      const offset = view.getUint32(at, true);
      const type = view.getUint32(at + 4, true) & 0xff;
      if (type === R_ARM_NONE || type === R_ARM_V4BX) continue;
      const width = FIELD_BYTES[type] ?? 4;
      for (let i = offset; i < offset + width && i < mask.length; i++) {
        if (mask[i] === 0) masked++;
        mask[i] = 1;
      }
    }
  }
  return masked;
}

/** One unit's verdict: its object's `.text`, outside the relocated fields, against the ROM range. */
function compareObject(object: Uint8Array, unit: AssembleUnit, rom: Rom): ModuleAssembly & { readonly masked: number } {
  const failed = (detail: string): ModuleAssembly & { readonly masked: number } => ({ module: unit.module, ok: false, detail, masked: 0 });
  const elf = parseElf(object);
  if (!elf.ok) return failed(`${unit.object}: ${elf.error}`);
  const text = elf.value.sections.find((s) => s.name === '.text');
  const length = unit.span.end - unit.span.start;
  const size = text?.size ?? 0;
  if (text === undefined || size !== length) {
    return failed(`${unit.object} has 0x${size.toString(16)} bytes of .text, the module spans 0x${length.toString(16)}`);
  }
  if (text.offset + size > object.length) return failed(`${unit.object}: .text lies outside the file`);
  const mask = new Uint8Array(size);
  const masked = maskRelocations(object, elf.value.sections, text, mask);
  if (typeof masked === 'string') return failed(`${unit.object}: ${masked}`);
  const base = unit.span.start - rom.base;
  if (base < 0 || base + size > rom.bytes.length) return failed(`the module's span lies outside the ROM`);
  for (let i = 0; i < size; i++) {
    if (mask[i] === 0 && object[text.offset + i] !== rom.bytes[base + i]) {
      return failed(`first difference at 0x${hex(unit.span.start + i)}`);
    }
  }
  return { module: unit.module, ok: true, detail: `equals 0x${hex(unit.span.start)}..0x${hex(unit.span.end)}`, masked };
}

/**
 * `verify --assemble` in `dir`: writes include/macros.inc and baserom.gba when absent, assembles every unit,
 * and compares each object's `.text` with its unit's ROM range, byte for byte except the fields its
 * relocations leave to the linker (a cross-module `bl`, a pool word naming a label). Every unit is checked,
 * also after one fails, so the result names every module that differs.
 */
export async function assembleCheck(options: AssembleCheckOptions): Promise<AssembleCheckResult> {
  const { rom, units } = options;
  const dir = resolve(options.dir);
  const result = (ok: boolean, detail: string, diagnostics: readonly Diagnostic[], modules: readonly ModuleAssembly[]): AssembleCheckResult => ({
    id: 'assemble',
    ok,
    detail,
    diagnostics,
    modules,
  });
  const tools = toolsOf(options.tools);
  if (!tools.ok) return result(false, 'binutils not found', [tools.diagnostic], []);
  const prepared = await prepare(dir, rom);
  if (prepared !== undefined) return result(false, prepared.message, [prepared], []);
  const modules: ModuleAssembly[] = [];
  const diagnostics: Diagnostic[] = [];
  let masked = 0;
  for (const unit of units) {
    const failed = await assembleUnit(dir, unit, tools.tools);
    if (failed !== undefined) {
      diagnostics.push(failed);
      modules.push({ module: unit.module, ok: false, detail: `${unit.source} does not assemble` });
      continue;
    }
    const object = await readOutput(dir, unit.object);
    if (isDiagnostic(object)) {
      diagnostics.push(object);
      modules.push({ module: unit.module, ok: false, detail: object.message });
      continue;
    }
    const verdict = compareObject(object, unit, rom);
    masked += verdict.masked;
    modules.push({ module: verdict.module, ok: verdict.ok, detail: verdict.detail });
  }
  const bad = modules.filter((m) => !m.ok);
  if (bad.length === 0) {
    return result(diagnostics.length === 0, `${modules.length} modules assemble to their ROM ranges (${masked} relocated bytes left to the linker)`, diagnostics, modules);
  }
  const detail = `${bad.length} of ${modules.length} modules differ: ${bad.map((m) => `${m.module}: ${m.detail}`).join('; ')}`;
  return result(false, detail, diagnostics, modules);
}
