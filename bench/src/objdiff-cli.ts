// objdiff-cli, the oracle of the objdiff family (architecture §8.4, D34): where the bench finds it, which
// version it is against bench/tools/objdiff.version (part of the source digest), and the one invocation
// the family needs: the one-shot `diff` of a reference object (`-1`, objdiff's target, left) against a
// base object (`-2`, right), JSON on stdout, one process per object pair rather than per function. The
// parser turns that JSON into per-function results: match percent, instruction differences, and
// relocation differences with the reference side's target read from the reference object's own relocation
// table, so a target that is a section symbol (`unnamed-target`) is told apart from a named one.
import { access, constants, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { compareCodeUnits, implicitAddend, parseElf, SHT, type ElfSymbol, type ParseResult } from 'romlift';
import { findExecutable as findOnPath } from 'romlift/node';

import { objectRelocations, type ObjectRelocation } from './objects.ts';
import { runProcess } from './process.ts';

// ---------------------------------------------------------------------------------------------------
// Finding the binary and its version

/** The variable that names the objdiff-cli binary, ahead of every default. */
export const OBJDIFF_ENV = 'ROMLIFT_OBJDIFF';
/** The pinned `objdiff-cli --version` line, repository-relative. */
export const OBJDIFF_VERSION_FILE = 'bench/tools/objdiff.version';
/** Where `cargo build --target-dir <repo>/bench/.local/objdiff-target` puts the binary, repository-relative. */
export const OBJDIFF_LOCAL_BUILD = 'bench/.local/objdiff-target/release/objdiff-cli';
/** The objdiff checkout's own release build, relative to the benchmark root. */
export const OBJDIFF_CHECKOUT_BUILD = 'objdiff/target/release/objdiff-cli';

export type ObjdiffSource = 'env' | 'repo-build' | 'main-repo-build' | 'path' | 'bench-root';

export interface ObjdiffLocation {
  readonly bin: string;
  readonly source: ObjdiffSource;
}

export interface FindObjdiffOptions {
  /** The repository the bench runs from; its `bench/.local` build is the default. */
  readonly repoRoot?: string;
  /**
   * The main checkout when `repoRoot` is a linked `git worktree` (bench/.local is per checkout and
   * gitignored, so a worktree finds the build its main checkout made).
   */
  readonly mainRepoRoot?: string;
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The objdiff-cli the bench uses: `ROMLIFT_OBJDIFF` when set (returned even when it does not exist, so the
 * version check names the variable); else the repository's `bench/.local` build, then the main checkout's
 * when this is a worktree; else `objdiff-cli` on the PATH; else `<benchRoot>/objdiff/target/release/objdiff-cli`.
 * Undefined when none exists.
 */
export async function findObjdiff(
  env: Readonly<Record<string, string | undefined>>,
  benchRoot: string,
  options: FindObjdiffOptions = {},
): Promise<ObjdiffLocation | undefined> {
  const named = env[OBJDIFF_ENV];
  if (named !== undefined && named !== '') return { bin: isAbsolute(named) ? named : resolve(named), source: 'env' };
  const candidates: ObjdiffLocation[] = [];
  if (options.repoRoot !== undefined) candidates.push({ bin: join(options.repoRoot, OBJDIFF_LOCAL_BUILD), source: 'repo-build' });
  if (options.mainRepoRoot !== undefined && options.mainRepoRoot !== options.repoRoot) {
    candidates.push({ bin: join(options.mainRepoRoot, OBJDIFF_LOCAL_BUILD), source: 'main-repo-build' });
  }
  for (const c of candidates) if (await isExecutable(c.bin)) return c;
  const onPath = findOnPath('objdiff-cli', env);
  if (onPath !== undefined && onPath !== null) return { bin: onPath, source: 'path' };
  const checkout = join(benchRoot, OBJDIFF_CHECKOUT_BUILD);
  return (await isExecutable(checkout)) ? { bin: checkout, source: 'bench-root' } : undefined;
}

/**
 * The main checkout of the git repository at `repoRoot` (the parent of its common git directory), or
 * undefined when git cannot say.
 */
export async function mainRepoRootOf(repoRoot: string): Promise<string | undefined> {
  const run = await runProcess('git', ['-C', repoRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
  const common = run.stdout.trim();
  return run.code === 0 && common !== '' ? dirname(common) : undefined;
}

/** The first line of `<bin> --version`, or null when it cannot run or prints nothing. */
export async function objdiffVersion(bin: string): Promise<string | null> {
  const run = await runProcess(bin, ['--version']);
  if (run.code !== 0) return null;
  const line = run.stdout.split('\n')[0]?.trim() ?? '';
  return line === '' ? null : line;
}

/** The pinned version line of `bench/tools/objdiff.version`, or null when the file is missing or empty. */
export async function readPinnedObjdiffVersion(repoRoot: string): Promise<string | null> {
  try {
    const line = (await readFile(join(repoRoot, OBJDIFF_VERSION_FILE), 'utf8')).split('\n')[0]?.trim() ?? '';
    return line === '' ? null : line;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// The invocation

/**
 * The diff options the family pins: relocation targets compared by name or address (objdiff's default,
 * spelled out so a changed default cannot move a verdict), and the GBA's ARMv4T decoder.
 */
export const OBJDIFF_DIFF_CONFIG: readonly string[] = ['functionRelocDiffs=name_address', 'arm.archVersion=v4t'];

/** The arguments of the one-shot diff of `reference` (objdiff's target, left) against `base` (right). */
export function objdiffDiffArgs(reference: string, base: string): string[] {
  return ['--no-color', 'diff', '-1', reference, '-2', base, '-o', '-', '--format', 'json', ...OBJDIFF_DIFF_CONFIG.flatMap((c) => ['-c', c])];
}

/**
 * Diffs the reference object `reference` against `base` with `bin` and parses the result, reading the
 * reference object's relocations to classify each relocation difference's reference target.
 */
export async function diffObjects(bin: string, reference: string, base: string): Promise<ParseResult<ObjectDiff>> {
  const run = await runProcess(bin, objdiffDiffArgs(reference, base));
  if (run.code !== 0) return { ok: false, error: `objdiff-cli exited ${run.code} on ${reference} and ${base}: ${run.stderr.trim()}` };
  let json: unknown;
  try {
    json = JSON.parse(run.stdout) as unknown;
  } catch (error) {
    return { ok: false, error: `objdiff-cli printed no JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const left = objectFacts(new Uint8Array(await readFile(reference)));
  if (!left.ok) return left;
  const right = objectFacts(new Uint8Array(await readFile(base)));
  if (!right.ok) return right;
  return parseObjdiffDiff(json, left.value, right.value);
}

/** What the parser reads of an object: its symbols, its relocations (with their addends) and its section contents. */
export function objectFacts(bytes: Uint8Array): ParseResult<ReferenceObject> {
  const elf = parseElf(bytes);
  if (!elf.ok) return elf;
  const relocations = objectRelocations(bytes);
  if (!relocations.ok) return relocations;
  const contents = new Map<string, Uint8Array>();
  for (const section of elf.value.sections) {
    if (section.type === SHT.NOBITS || section.size === 0 || section.offset + section.size > bytes.length || contents.has(section.name)) continue;
    contents.set(section.name, bytes.subarray(section.offset, section.offset + section.size));
  }
  return { ok: true, value: { symbols: elf.value.symbols, relocations: relocations.value, contents } };
}

// ---------------------------------------------------------------------------------------------------
// The result

/** objdiff's row kinds, without the `DIFF_` prefix; `none` rows are never reported. */
export type RowDiffKind = 'replace' | 'delete' | 'insert' | 'op-mismatch' | 'arg-mismatch';

/** A row whose instruction differs (other than only in a relocation's target). */
export interface InstructionDifference {
  /** The reference row's section offset, or null for a row only the base has. */
  readonly offset: number | null;
  readonly kind: RowDiffKind;
  readonly reference: string | null;
  readonly base: string | null;
}

/** What the reference side of a relocation refers to: a named symbol, or a section symbol (`unnamed-target`). */
export interface RelocationTarget {
  /** The symbol's name; a section symbol's section name (`.rodata`). */
  readonly name: string;
  readonly symbol: 'named' | 'section';
  /** The relocation's addend (objdiff prints none), when the reference object's table holds the entry and its type is one implicitAddend reads. */
  readonly addend?: number;
}

/** A row whose relocation target differs between the two sides. */
export interface RelocationDifference {
  readonly offset: number | null;
  readonly kind: RowDiffKind;
  /** The relocation type as objdiff names it (`R_ARM_ABS32`). */
  readonly type: string;
  /** Null when only the base row carries a relocation. */
  readonly reference: RelocationTarget | null;
  /** The base side's target as objdiff names it; null when only the reference row carries a relocation. */
  readonly base: string | null;
  /** The ELF relocation type (2 R_ARM_ABS32, 10 R_ARM_THM_CALL, ...): the reference entry's, else the base entry's. */
  readonly typeCode?: number;
  /** The base relocation's addend, when the base object's table holds the entry. */
  readonly baseAddend?: number;
  /**
   * When only the reference row carries a relocation: the value the base's field holds, read as that relocation type
   * reads its field (the word of an R_ARM_ABS32, the branch offset of an R_ARM_THM_CALL).
   */
  readonly baseField?: number;
}

/** One function of the reference object and how it compares. */
export interface FunctionDiff {
  readonly name: string;
  /** The function's offset in its section of the reference object. */
  readonly offset: number;
  readonly size: number;
  /** Whether the base object has a symbol of that name that objdiff diffed it against. */
  readonly paired: boolean;
  /** objdiff's match percent; null when unpaired. */
  readonly matchPercent: number | null;
  readonly instructionDifferences: readonly InstructionDifference[];
  readonly relocationDifferences: readonly RelocationDifference[];
}

export interface ObjectDiff {
  /** The reference object's functions, in code-unit order of the name. */
  readonly functions: readonly FunctionDiff[];
}

/** An object's facts the parser reads: its symbols (for sections), its relocations, and its section contents (for a plain value). */
export interface ReferenceObject {
  readonly symbols: readonly ElfSymbol[];
  readonly relocations: readonly ObjectRelocation[];
  /** The bytes of each section with contents, by name; absent when the caller has none to give. */
  readonly contents?: ReadonlyMap<string, Uint8Array>;
}

/**
 * How a function scores: `match` (100%, nothing differs), `unnamed-target` (only relocation differences
 * whose reference side is a section symbol: counted and reported, not gated), `differs`, or `unpaired`.
 */
export type FunctionOutcome = 'match' | 'unnamed-target' | 'differs' | 'unpaired';

export function functionOutcome(f: FunctionDiff): FunctionOutcome {
  if (!f.paired) return 'unpaired';
  if (f.instructionDifferences.length > 0) return 'differs';
  if (f.relocationDifferences.some((r) => r.reference === null || r.reference.symbol === 'named')) return 'differs';
  if (f.relocationDifferences.length > 0) return 'unnamed-target';
  return f.matchPercent === 100 ? 'match' : 'differs';
}

// The JSON is proto3's mapping of objdiff's DiffResult (objdiff-core/protos/diff.proto): default values
// are omitted and uint64 fields are strings.

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isJson) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A proto3 uint64 (a decimal string) or uint32 (a number); 0 when omitted. */
function unsigned(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

const ROW_KINDS: Readonly<Record<string, RowDiffKind>> = {
  DIFF_REPLACE: 'replace',
  DIFF_DELETE: 'delete',
  DIFF_INSERT: 'insert',
  DIFF_OP_MISMATCH: 'op-mismatch',
  DIFF_ARG_MISMATCH: 'arg-mismatch',
};

interface Side {
  readonly symbols: readonly Json[];
}

function side(value: unknown): Side {
  return { symbols: isJson(value) ? list(value['symbols']) : [] };
}

/** The arguments of a row's instruction, each with whether it is the relocation operand. */
function args(instruction: Json | undefined): boolean[] {
  return list(instruction?.['parts'])
    .map((p) => p['arg'])
    .filter(isJson)
    .map((a) => a['reloc'] === true);
}

/**
 * What a differing row reports: an argument mismatch is a relocation difference when a differing argument
 * is the relocation operand, an instruction difference when another argument differs (both can hold), and,
 * when objdiff marks no argument, a relocation difference if either side carries a relocation. Every other
 * kind (replace, insert, delete, opcode mismatch) is an instruction difference.
 */
function rowDifference(kind: RowDiffKind, row: Json, instruction: Json | undefined, hasRelocation: boolean): { readonly reloc: boolean; readonly plain: boolean } {
  if (kind !== 'arg-mismatch') return { reloc: false, plain: true };
  const kinds = args(instruction);
  let reloc = false;
  let plain = false;
  list(row['arg_diff']).forEach((d, i) => {
    if (d['diff_index'] === undefined) return;
    if (kinds[i] === true) reloc = true;
    else plain = true;
  });
  if (!reloc && !plain) return hasRelocation ? { reloc: true, plain: false } : { reloc: false, plain: true };
  return { reloc, plain };
}

function relocationOf(instruction: Json | undefined): Json | undefined {
  const r = instruction?.['relocation'];
  return isJson(r) ? r : undefined;
}

function symbolName(s: Side, index: unknown): string | null {
  if (typeof index !== 'number') return null;
  return text(s.symbols[index]?.['name']) ?? null;
}

/** The entry of an object's relocation table at `offset` in `section` (any section when undefined). */
function relocationAt(object: ReferenceObject, section: string | undefined, offset: number): ObjectRelocation | undefined {
  return object.relocations.find((r) => r.offset === offset && (section === undefined || r.section === section));
}

/** The reference target of the relocation `entry` (the object's own), else objdiff's name for it. */
function referenceTarget(entry: ObjectRelocation | undefined, fallback: string | null): RelocationTarget | null {
  if (entry !== undefined) return { name: entry.symbol.name, symbol: entry.symbol.type === 'section' ? 'section' : 'named', ...(entry.addend === undefined ? {} : { addend: entry.addend }) };
  return fallback === null ? null : { name: fallback, symbol: 'named' };
}

/** The value the field of relocation type `type` at `offset` of `bytes` holds, as that type reads it; undefined outside the bytes. */
function fieldValue(bytes: Uint8Array | undefined, offset: number, type: number): number | undefined {
  if (bytes === undefined || offset + 4 > bytes.length) return undefined;
  return implicitAddend(type, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset);
}

/** The base side's facts of a relocation difference: its type, and its addend or its field's plain value. */
function baseFacts(base: ReferenceObject | undefined, section: string | undefined, offset: number | null, refEntry: ObjectRelocation | undefined, hasRelocation: boolean): Pick<RelocationDifference, 'typeCode' | 'baseAddend' | 'baseField'> {
  const entry = base === undefined || offset === null ? undefined : relocationAt(base, section, offset);
  const typeCode = refEntry?.type ?? entry?.type;
  const out: { typeCode?: number; baseAddend?: number; baseField?: number } = {};
  if (typeCode !== undefined) out.typeCode = typeCode;
  if (entry?.addend !== undefined) out.baseAddend = entry.addend;
  if (!hasRelocation && entry === undefined && typeCode !== undefined && offset !== null && section !== undefined) {
    const value = fieldValue(base?.contents?.get(section), offset, typeCode);
    if (value !== undefined) out.baseField = value;
  }
  return out;
}

function functionDiff(symbol: Json, left: Side, right: Side, reference: ReferenceObject, base: ReferenceObject | undefined): FunctionDiff {
  const name = text(symbol['name']) ?? '';
  const targetIndex = symbol['target_symbol'];
  const paired = typeof targetIndex === 'number';
  const match = symbol['match_percent'];
  const section = reference.symbols.find((s) => s.name === name && s.type === 'func')?.sectionName;
  const baseName = paired ? text(right.symbols[targetIndex]?.['name']) : undefined;
  const baseSection = base?.symbols.find((s) => s.name === baseName && s.type === 'func')?.sectionName;
  const baseRows = paired ? list(right.symbols[targetIndex]?.['instructions']) : [];
  const instructionDifferences: InstructionDifference[] = [];
  const relocationDifferences: RelocationDifference[] = [];
  list(symbol['instructions']).forEach((row, i) => {
    const kind = ROW_KINDS[text(row['diff_kind']) ?? ''];
    if (kind === undefined) return;
    const refInsn = isJson(row['instruction']) ? row['instruction'] : undefined;
    const baseRow = baseRows[i];
    const baseInsn = isJson(baseRow?.['instruction']) ? baseRow['instruction'] : undefined;
    const offset = refInsn === undefined ? null : unsigned(refInsn['address']);
    const refReloc = relocationOf(refInsn);
    const baseReloc = relocationOf(baseInsn);
    const differs = rowDifference(kind, row, refInsn, refReloc !== undefined || baseReloc !== undefined);
    if (differs.reloc) {
      const refEntry = refReloc === undefined || offset === null ? undefined : relocationAt(reference, section, offset);
      const baseOffset = baseInsn === undefined ? null : unsigned(baseInsn['address']);
      relocationDifferences.push({
        offset,
        kind,
        type: text(refReloc?.['type_name']) ?? text(baseReloc?.['type_name']) ?? '',
        reference: refReloc === undefined || offset === null ? null : referenceTarget(refEntry, symbolName(left, refReloc['target_symbol'])),
        base: baseReloc === undefined ? null : symbolName(right, baseReloc['target_symbol']),
        ...baseFacts(base, baseSection, baseOffset, refEntry, baseReloc !== undefined),
      });
    }
    if (differs.plain) {
      instructionDifferences.push({ offset, kind, reference: text(refInsn?.['formatted']) ?? null, base: text(baseInsn?.['formatted']) ?? null });
    }
  });
  return {
    name,
    offset: unsigned(symbol['address']),
    size: unsigned(symbol['size']),
    paired,
    matchPercent: paired ? (typeof match === 'number' ? match : 0) : null,
    instructionDifferences,
    relocationDifferences,
  };
}

/**
 * Parses objdiff-cli's one-shot `diff --format json` output into the reference object's functions; pure. `base`, the
 * base object's facts, gives each relocation difference its base addend or plain value. ok:false when the value has
 * no reference (left) side.
 */
export function parseObjdiffDiff(json: unknown, reference: ReferenceObject, base?: ReferenceObject): ParseResult<ObjectDiff> {
  if (!isJson(json) || !isJson(json['left'])) return { ok: false, error: 'objdiff-cli JSON: no left (reference) object' };
  const left = side(json['left']);
  const right = side(json['right']);
  const functions = left.symbols
    .filter((s) => s['kind'] === 'SYMBOL_FUNCTION')
    .map((s) => functionDiff(s, left, right, reference, base))
    .sort((a, b) => compareCodeUnits(a.name, b.name) || a.offset - b.offset);
  return { ok: true, value: { functions } };
}
