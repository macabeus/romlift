// The toolchain runs of `verify` (architecture §2.1, §6.4): in a directory holding an emitted tree,
// `linkCheck` assembles every build unit with arm-none-eabi-as, links them with the tree's ldscript.txt,
// copies the image out with objcopy -O binary and hashes it (`verify --link`, the final proof);
// `assembleCheck` assembles each unit and reads its object (`verify --assemble`). Mechanical: it runs the
// programs, writes the files a link needs and reads what the programs wrote; every verdict on those bytes
// is core/verify/toolchain.ts's, and the tree, the units and their spans come from the caller
// (core/model/paths.ts buildUnits).
//
// A C unit (source `src/<module>.c`, object `build/src/<module>.o`, D74 f) needs no compiler here: its stub is read
// back (core/verify/c-stub.ts stubAssemblyOf) into the assembly agbcc emits for it (core/model/c-unit.ts, measured
// and proved by test/local/c-stub-agbcc.test.ts), which is written to `build/src/<module>.s` and assembled like an
// asm unit, so `verify --assemble/--link` and the g3 gates still need only binutils. A C file that is not a
// stub-only unit (a decompiled function, a declaration) is refused with its first problem.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { DIALECT } from '../../foundation/asm/dialect.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { BuildUnit } from '../../core/model/paths.ts';
import { BASEROM_FILE, isCSource } from '../../foundation/util/project-files.ts';
import { cAssemblyPath, LDSCRIPT_PATH, MACROS_PATH } from '../../core/model/paths.ts';
import { stubAssemblyOf } from '../../core/verify/c-stub.ts';
import { assembleFailure, assembleVerdict, compareObject, linkFailure, linkVerdict, unassemblable } from '../../core/verify/toolchain.ts';
import type { AssembleUnit } from '../../core/model/paths.ts';
import type { AssembleCheckResult, LinkCheckResult, ModuleAssembly } from '../../core/verify/toolchain.ts';
import { ShellCodes } from '../codes.ts';
import { errnoOf, errorReason } from '../fs.ts';
import { sha1Of } from '../hash.ts';
import { onDisk } from '../project/disk-state.ts';
import { findBinutils, runTool } from './binutils.ts';
import type { Binutils, ToolRun } from './binutils.ts';

export type { AssembleCheckResult, LinkCheckResult, ModuleAssembly } from '../../core/verify/toolchain.ts';

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

export interface AssembleCheckOptions {
  readonly dir: string;
  readonly rom: Rom;
  readonly units: readonly AssembleUnit[];
  readonly tools?: Binutils;
}

/** The first lines of a program's error output, for a diagnostic. */
function excerpt(stderr: string, lines = 12): string {
  const all = stderr.trimEnd().split('\n');
  return all.length <= lines ? all.join('\n') : `${all.slice(0, lines).join('\n')}\n… (${all.length - lines} more lines)`;
}

function toolFailed(what: string, result: ToolRun, path?: string): Diagnostic {
  const message = `${what} exited with ${result.code}${result.stderr.trim() === '' ? '' : `:\n${excerpt(result.stderr)}`}`;
  return diagnostic(ShellCodes, 'E_TOOLCHAIN_FAILED', message, path === undefined ? {} : { path });
}

async function readOutput(dir: string, path: string): Promise<Uint8Array | Diagnostic> {
  try {
    const bytes = await readFile(onDisk(dir, path));
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } catch (error) {
    return diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${path}: ${errorReason(error)}`, { path });
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
    if (errnoOf(error) === 'EEXIST') return undefined;
    return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot write ${file}: ${errorReason(error)}`, { path: file });
  }
}

/** include/macros.inc (DIALECT.macrosInc) and baserom.gba (the ROM's bytes), each when absent. */
async function prepare(dir: string, rom: Rom): Promise<Diagnostic | undefined> {
  return (await writeIfAbsent(dir, MACROS_PATH, DIALECT.macrosInc)) ?? (await writeIfAbsent(dir, BASEROM_FILE, rom.bytes));
}

/** Writes `text` at `path` under `dir`, replacing what is there (a build product, like an object). */
async function writeBuildFile(dir: string, path: string, text: string): Promise<Diagnostic | undefined> {
  const file = onDisk(dir, path);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    return undefined;
  } catch (error) {
    return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot write ${file}: ${errorReason(error)}`, { path: file });
  }
}

/**
 * The unit `as` assembles for `unit`: itself for an assembly source; for a C source, its stub's assembly by the
 * unit's build compiler (BuildUnit.compiler, the module's), written to build/src/<module>.s (core/verify/c-stub.ts
 * stubAssemblyOf), with the same object. A C unit that names no compiler is refused.
 */
async function assemblySource(dir: string, unit: BuildUnit): Promise<BuildUnit | Diagnostic> {
  if (!isCSource(unit.source)) return unit;
  const text = await readOutput(dir, unit.source);
  if (isDiagnostic(text)) return text;
  if (unit.compiler === undefined) {
    return diagnostic(ShellCodes, 'E_TOOLCHAIN_FAILED', `${unit.source} (module ${unit.module}) names no build compiler: a C unit assembles as its compiler's assembly of the stub`, { path: unit.source });
  }
  const assembly = stubAssemblyOf(new TextDecoder().decode(text), unit.compiler);
  if (!assembly.ok) {
    const first = assembly.problems[0];
    const message = `${unit.source} line ${first?.line ?? 1} ${first?.message ?? ''}: only a stub-only C unit assembles without a compiler`;
    return diagnostic(ShellCodes, 'E_TOOLCHAIN_FAILED', message, { path: unit.source });
  }
  const source = cAssemblyPath(unit.module);
  const written = await writeBuildFile(dir, source, assembly.text);
  return written ?? { ...unit, source };
}

/** Assembles one unit's source to its object, with DIALECT.asArgs and `-I <dir>`, from `dir` (a C unit from its stub's assembly). */
async function assembleUnit(dir: string, given: BuildUnit, tools: Binutils): Promise<Diagnostic | undefined> {
  const unit = await assemblySource(dir, given);
  if ('code' in unit) return unit;
  const refused = unassemblable(unit);
  if (refused !== undefined) return diagnostic(ShellCodes, 'E_TOOLCHAIN_FAILED', refused, { path: unit.source });
  try {
    await mkdir(dirname(onDisk(dir, unit.object)), { recursive: true });
  } catch (error) {
    return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot create the directory of ${unit.object}: ${errorReason(error)}`, { path: unit.object });
  }
  const result = await runTool(tools.as, [...DIALECT.asArgs, '-I', dir, '-o', unit.object, unit.source], dir);
  return result.code === 0 ? undefined : toolFailed(`arm-none-eabi-as on ${unit.source}`, result, unit.source);
}

type Tools = { readonly ok: true; readonly tools: Binutils } | { readonly ok: false; readonly diagnostic: Diagnostic };

function toolsOf(tools: Binutils | undefined): Tools {
  if (tools !== undefined) return { ok: true, tools };
  const found = findBinutils(process.env);
  return 'code' in found ? { ok: false, diagnostic: found } : { ok: true, tools: found };
}

/**
 * `verify --link` in `dir`: writes include/macros.inc and baserom.gba when absent, assembles every unit to
 * its object, links them in unit order with ldscript.txt into build/link-check.elf, copies it out with
 * objcopy -O binary into build/link-check.gba, hashes it, and returns core/verify/toolchain.ts linkVerdict.
 */
export async function linkCheck(options: LinkCheckOptions): Promise<LinkCheckResult> {
  const { rom, units } = options;
  const dir = resolve(options.dir);
  const tools = toolsOf(options.tools);
  if (!tools.ok) return linkFailure('binutils not found', [tools.diagnostic]);
  const prepared = await prepare(dir, rom);
  if (prepared !== undefined) return linkFailure(prepared.message, [prepared]);
  for (const unit of units) {
    const failed = await assembleUnit(dir, unit, tools.tools);
    if (failed !== undefined) return linkFailure(`module ${unit.module} does not assemble`, [failed]);
  }
  const ld = await runTool(tools.tools.ld, ['-T', LDSCRIPT_PATH, '-o', LINK_ELF_PATH, ...units.map((u) => u.object)], dir);
  if (ld.code !== 0) return linkFailure('the link failed', [toolFailed('arm-none-eabi-ld', ld, LDSCRIPT_PATH)]);
  const objcopy = await runTool(tools.tools.objcopy, ['-O', 'binary', LINK_ELF_PATH, LINK_IMAGE_PATH], dir);
  if (objcopy.code !== 0) return linkFailure('objcopy failed', [toolFailed('arm-none-eabi-objcopy', objcopy, LINK_ELF_PATH)]);
  const image = await readOutput(dir, LINK_IMAGE_PATH);
  if (isDiagnostic(image)) return linkFailure(image.message, [image]);
  return linkVerdict(image, sha1Of(image), rom, units.length);
}

/**
 * `verify --assemble` in `dir`: writes include/macros.inc and baserom.gba when absent, assembles every unit,
 * reads each object and returns core/verify/toolchain.ts's verdict on it (compareObject, assembleVerdict).
 * Every unit is checked, also after one fails, so the result names every module that differs.
 */
export async function assembleCheck(options: AssembleCheckOptions): Promise<AssembleCheckResult> {
  const { rom, units } = options;
  const dir = resolve(options.dir);
  const tools = toolsOf(options.tools);
  if (!tools.ok) return assembleFailure('binutils not found', [tools.diagnostic]);
  const prepared = await prepare(dir, rom);
  if (prepared !== undefined) return assembleFailure(prepared.message, [prepared]);
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
  return assembleVerdict(modules, masked, diagnostics);
}
