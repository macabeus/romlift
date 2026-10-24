// The text-layout self-check (architecture §6.4, §6.7, D49): every file the emission stream produces is
// read back and must rebuild exactly what the model says it holds, without a toolchain. Each FileEntry is checked
// alone under an index of the model built once per pass (indexData, internal to this file), so the check pass streams
// the emission and keeps no tree (§9.4); checkEntries folds a whole stream into the 'text-layout' and 'paths'
// results.
//
// - A function or orphan file (core/model/paths.ts chunkPaths) is parsed with foundation/asm/statements.ts
//   (include/macros.inc is DIALECT.macrosInc) and laid out by foundation/asm/layout.ts from its chunk's
//   start, in the state the previous chunk of its module leaves (Thumb before a module's first chunk: the
//   module file's preamble), at its run address inside a runs_at range, so local labels take the addresses
//   ld gives them. It is read as `as` reads it, inside its module file, after that file's include of the
//   macro file: a chunk file that includes the macro file again redefines every macro, which `as` refuses.
//   Names it does not define resolve to the model: a label of its module, else a global label (resolver.ts
//   wordValueOf: a Thumb function carries the Thumb bit), else a [symbols] entry outside the ROM (what
//   symbols.ld defines); only a label a printer can place counts, one at an item's start or inside a data item
//   (chunk.ts places no other), so a name the tree never defines is an undefined symbol here as for `as`. A
//   [symbols] entry inside the ROM is defined only by its label, so one no printer can place resolves to nothing. A PC-relative load or
//   `adr` may name only a label of its own module, the object `as` assembles it into (D63).
//   `.incbin "baserom.gba"` reads the ROM.
// - A module's source (asm/rom_header.s, asm/crt0.s, asm/<module>.s, data/<module>.s; paths.ts
//   moduleSource) is laid out from the module's start in ARM state (GNU as starts every file in ARM state).
//   Each `.include` of one of the module's chunk files stands for that chunk's ROM bytes; the includes must
//   be exactly the module's chunk files in ROM order, so the file adds no byte of its own beyond what the
//   model puts between them (a header, startup or data chunk it holds inline).
// - A C module's source, src/<module>.c (the c-stub writer's, phase 4), is read with the reconciler's tokenizer
//   (c-stub.ts readStub): it must be a stub-only unit, its INCLUDE_ASM statements must be exactly the module's chunk
//   files in ROM order (every chunk of a C module has a file), and it is laid out as the assembly agbcc emits for
//   it (core/model/c-unit.ts): from the module's start in Thumb state (`.code 16`), each statement's chunk file
//   standing for that chunk's ROM bytes, nothing between or after them.
// - Every laid-out file must reproduce its ROM range byte for byte, and every `.align` (and every pad of a
//   switch to ARM state) that emits bytes must emit exactly the padding item at that address.
// - Each build unit must start and end on a multiple of its section's alignment (the largest any of its files
//   asks, foundation/asm/layout.ts sectionAlign): GNU as pads a section's end to it and ld places a section on
//   it, so an odd-sized ROM's last unit, or a unit at a misaligned border, would link to other bytes.
// - ldscript.txt and symbols.ld are checked structurally (link-scripts.ts): each build unit once, in ROM order,
//   a runs_at unit at its run address loaded at its load address with its __load_ symbol; each symbol outside
//   the ROM defined once with the model's value, and nothing else.
//
// Every failure is E_SELF_CHECK_TEXT with the file (`path`), the line (in the message) and the load
// address (`addr`) of the first difference. Scaffold entries other than the c-stub writer's, reconciled entries
// and entries of writers this check does not read (modules.mk) are not this check's.
import { DIALECT } from '../../foundation/asm/dialect.ts';
import { layoutMemo, layoutStatements } from '../../foundation/asm/layout.ts';
import type { Layout, LayoutInput, LayoutMemo } from '../../foundation/asm/layout.ts';
import { parseStatements, stripComment } from '../../foundation/asm/statements.ts';
import type { Statement } from '../../foundation/asm/statements.ts';
import { RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { ROM_BASE } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { pushAll } from '../../foundation/util/arrays.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import type { FileEntry, WriterId } from '../emit/tree.ts';
import { findItem, modeOfSpec, specIdAt } from '../model/item-table.ts';
import { moduleIndexAt, relocatedModules, runOffsetOf, toLoad } from '../model/modules.ts';
import { BASEROM_FILE, isCSource } from '../../foundation/util/project-files.ts';
import { chunkPathsOf, LDSCRIPT_PATH, MACROS_PATH, moduleSource, SYMBOLS_PATH } from '../model/paths.ts';
import { STUB_UNIT_MODE } from '../model/c-unit.ts';
import { wordValueOf } from '../model/resolver.ts';
import { ItemKind } from '../model/types.ts';
import type { Label, Model, Module } from '../model/types.ts';
import { readStub } from './c-stub.ts';
import { checkLdscript, checkSymbolsFile, externalSymbolValues } from './link-scripts.ts';
import { pathsCheck } from './paths.ts';
import { checkResult } from './report.ts';
import type { CheckResult, VerifyReport } from './report.ts';
import { textError } from './text-error.ts';

/** How many problems one entry reports at most; the first is the one that matters. */
export const MAX_PER_ENTRY = 16;

/** The writers whose files this check reads; an unknown path of one of them is an error. */
const CHECKED_WRITERS: ReadonlySet<WriterId> = new Set<WriterId>(['header', 'crt0', 'function', 'orphan', 'module', 'data', 'ldscript', 'symbols', 'c-stub']);

const INCLUDES: ReadonlyMap<string, string> = new Map([[MACROS_PATH, DIALECT.macrosInc]]);

// ---------------------------------------------------------------------------------------------------
// What each path of the model holds, indexed once per check pass and dropped with it.

type Target =
  | { readonly kind: 'chunk'; readonly module: number; readonly chunk: number }
  | { readonly kind: 'source'; readonly module: number }
  | { readonly kind: 'c-stub'; readonly module: number }
  | { readonly kind: 'ldscript' }
  | { readonly kind: 'symbols' };

/** What each path of the model holds, indexed once per check pass (indexData) and dropped with it; never exported. */
interface IndexData {
  readonly targets: ReadonlyMap<string, Target>;
  /** chunkPathsOf(model), aligned with model.chunks: the writers' own. */
  readonly chunkPaths: readonly (string | undefined)[];
  /** Every path the stream of the model must hold, in model order, with the address its bytes start at. */
  readonly expected: readonly { readonly path: string; readonly addr: Addr }[];
  /** relocatedModules(model.modules), for moduleIndexAt. */
  readonly relocated: readonly Module[];
  /** The labels a printer can place (definable), by name, each list by address. */
  readonly labelsByName: ReadonlyMap<string, readonly Label[]>;
  /** The [symbols] entries outside the ROM, which symbols.ld defines, by name (the first by address). */
  readonly symbolsByName: ReadonlyMap<string, Addr>;
  /** What every layout of the pass's files remembers of instruction texts (foundation/asm/layout.ts). */
  readonly memo: LayoutMemo;
}

/**
 * Whether a printer can place `label`: its load address is an item's start, or lies inside a data item (the
 * readable printer splits a data item there, the data writer an `.incbin`, the header its `.byte` lines). An
 * instruction, pool word or table entry cannot be cut, so a label inside one is never defined (D63 d).
 */
function definable(model: Model, relocated: readonly Module[], label: Label): boolean {
  const module = model.modules[moduleIndexAt(model.modules, label.addr, relocated)];
  if (module === undefined) return false;
  const load = toLoad(module, label.addr);
  const i = findItem(model.items, load);
  return i >= 0 && (model.items.start[i] === load || model.items.kind[i] === ItemKind.data);
}

/** The pass's index: every path the stream must hold, its target, and the labels files may name. */
function indexData(model: Model): IndexData {
  const paths = chunkPathsOf(model);
  const targets = new Map<string, Target>([
    [LDSCRIPT_PATH, { kind: 'ldscript' }],
    [SYMBOLS_PATH, { kind: 'symbols' }],
  ]);
  const expected: { readonly path: string; readonly addr: Addr }[] = [];
  model.modules.forEach((module, m) => {
    if (!module.generated) return;
    // A C module's source is the c-stub writer's stub, laid out as agbcc compiles it (checkStubFile).
    const source = moduleSource(model, module);
    targets.set(source, isCSource(source) ? { kind: 'c-stub', module: m } : { kind: 'source', module: m });
    expected.push({ path: source, addr: module.span.start });
    for (let c = module.chunks.first; c < module.chunks.first + module.chunks.count; c++) {
      const path = paths[c];
      const chunk = model.chunks[c];
      if (path === undefined || chunk === undefined) continue;
      targets.set(path, { kind: 'chunk', module: m, chunk: c });
      expected.push({ path, addr: chunk.span.start });
    }
  });
  expected.push({ path: LDSCRIPT_PATH, addr: ROM_BASE }, { path: SYMBOLS_PATH, addr: ROM_BASE });
  const relocated = relocatedModules(model.modules);
  const labelsByName = new Map<string, Label[]>();
  for (const label of model.labels) {
    if (!definable(model, relocated, label)) continue;
    const list = labelsByName.get(label.name);
    if (list === undefined) labelsByName.set(label.name, [label]);
    else list.push(label);
  }
  return { targets, chunkPaths: paths, expected, relocated, labelsByName, symbolsByName: externalSymbolValues(model), memo: layoutMemo() };
}

// ---------------------------------------------------------------------------------------------------
// Laying a file out.

/** The value of a name a file of module `m` does not define (what ld would give it), or undefined. */
function resolveIn(model: Model, index: IndexData, m: number): (name: string) => number | undefined {
  return (name) => {
    const labels = index.labelsByName.get(name) ?? [];
    const label = labels.find((l) => moduleIndexAt(model.modules, l.addr, index.relocated) === m) ?? labels.find((l) => l.scope === 'global');
    if (label !== undefined) return wordValueOf(label);
    return index.symbolsByName.get(name);
  };
}

/** Whether a name a file of module `m` does not define is a label of module `m` itself (one object). */
function inModule(model: Model, index: IndexData, m: number): (name: string) => boolean {
  return (name) => (index.labelsByName.get(name) ?? []).some((l) => moduleIndexAt(model.modules, l.addr, index.relocated) === m);
}

function romIncbin(rom: Rom): (file: string, offset: number, length: number) => Uint8Array | undefined {
  return (file, offset, length) => (file === BASEROM_FILE && offset + length <= rom.bytes.length ? rom.bytes.subarray(offset, offset + length) : undefined);
}

/** The mode of an item's isa row, or undefined when it names none. */
function itemMode(model: Model, i: number): Mode | undefined {
  const kind = model.items.kind[i];
  if (kind !== ItemKind.insn && kind !== ItemKind.rawInsn) return undefined;
  const spec = specIdAt(model.items.spec[i] ?? 0xffff);
  return spec === undefined ? undefined : modeOfSpec(spec);
}

/**
 * The state GNU as is in when the module file includes chunk `c`: Thumb before the module's first chunk
 * (the module file's preamble), else the mode of the previous chunk's last instruction, else its mode.
 */
function incomingMode(model: Model, module: Module, c: number): Mode {
  const prev = model.chunks[c - 1];
  if (c === module.chunks.first || prev === undefined) return 'thumb';
  for (let i = prev.items.first + prev.items.count - 1; i >= prev.items.first; i--) {
    const mode = itemMode(model, i);
    if (mode !== undefined) return mode;
  }
  return prev.mode ?? 'thumb';
}

/** One file to lay out: its statements and where they go. */
interface Job {
  readonly path: string;
  readonly statements: readonly Statement[];
  readonly input: Omit<LayoutInput, 'statements'>;
  /** The load range the bytes must equal. */
  readonly range: Span;
  /** Run address minus load address (0 outside runs_at). */
  readonly runOffset: number;
}

function layoutOf(job: Job, statements: readonly Statement[]): Layout {
  return layoutStatements({ ...job.input, statements });
}

/** The line of the statement that lays out the byte at run address `at` (found by laying out prefixes). */
function lineAt(job: Job, at: Addr): number {
  const all = job.statements;
  let lo = 1;
  let hi = all.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (layoutOf(job, all.slice(0, mid)).end > at) hi = mid;
    else lo = mid + 1;
  }
  return all[lo - 1]?.line ?? 1;
}

/** The run address the statements before `line` reach. */
function addressBefore(job: Job, line: number): Addr {
  return layoutOf(
    job,
    job.statements.filter((s) => s.line < line),
  ).end;
}

/** What checking one file found: its problems, and the section alignment its statements ask of their unit. */
interface FileCheck {
  readonly diagnostics: Diagnostic[];
  /** Layout.sectionAlign of the file; 0 when it was not laid out. */
  readonly sectionAlign: number;
}

/** Every difference between a laid-out file and the model: bytes, length and padding. */
function compareLayout(rom: Rom, model: Model, job: Job, parseErrors: readonly { readonly line: number; readonly message: string }[]): FileCheck {
  const out: Diagnostic[] = [];
  const load = (at: Addr): Addr => at - job.runOffset;
  // Each parse error costs a layout of the statements before it, so only as many as an entry reports.
  for (const e of parseErrors.slice(0, MAX_PER_ENTRY)) out.push(textError(job.path, e.line, load(addressBefore(job, e.line)), e.message));
  const layout = layoutOf(job, job.statements);
  for (const e of layout.errors) out.push(textError(job.path, e.line, load(e.at), e.message));

  const expected = job.range.end - job.range.start;
  const got = layout.bytes.length;
  const base = job.range.start - ROM_BASE;
  let diff = -1;
  for (let k = 0; k < Math.min(expected, got); k++) {
    if (layout.bytes[k] !== rom.bytes[base + k]) {
      diff = k;
      break;
    }
  }
  if (diff >= 0) {
    const addr = job.range.start + diff;
    const message = `the file lays out 0x${(layout.bytes[diff] ?? 0).toString(16).padStart(2, '0')} where the ROM holds 0x${(rom.bytes[base + diff] ?? 0).toString(16).padStart(2, '0')}`;
    out.push(textError(job.path, lineAt(job, addr + job.runOffset), addr, message));
  } else if (got !== expected) {
    const addr = job.range.start + Math.min(expected, got);
    const message = `the file lays out ${got} bytes, but its range ${hexAddr(job.range.start)}..${hexAddr(job.range.end)} holds ${expected}`;
    out.push(textError(job.path, got > expected ? lineAt(job, addr + job.runOffset) : (job.statements[job.statements.length - 1]?.line ?? 1), addr, message));
  }

  for (const a of layout.aligns) {
    if (a.length === 0) continue;
    const at = load(a.at);
    const i = findItem(model.items, at);
    const isPadding = i >= 0 && model.items.kind[i] === ItemKind.padding && model.items.start[i] === at;
    const padding = isPadding ? (model.items.length[i] ?? 0) : 0;
    if (padding !== a.length) {
      const what = isPadding ? `the padding item there is ${padding} bytes` : 'no padding item starts there';
      out.push(textError(job.path, a.line, at, `the alignment emits ${a.length} bytes, but ${what}`));
    }
  }
  return { diagnostics: out, sectionAlign: layout.sectionAlign };
}

function parse(text: string): { readonly statements: readonly Statement[]; readonly errors: readonly { readonly line: number; readonly message: string }[] } {
  return parseStatements(text, { includes: INCLUDES });
}

/**
 * A chunk file as GNU as reads it inside its module file: after the module file's `.include` of the macro
 * file. The include is put in front of line 1 (`;` separates statements), so line numbers stay the file's,
 * and a chunk file that includes the macro file again fails as `as` fails, on a second macro definition.
 */
function asIncluded(text: string): string {
  return `${DIALECT.macrosInclude}; ${text}`;
}

/** The line of the module file's `.include` of the macro file, or undefined (parseStatements leaves it no statement). */
function macrosIncludeLine(text: string): number | undefined {
  const index = text.split('\n').findIndex((raw) => stripComment(raw).trim() === DIALECT.macrosInclude);
  return index < 0 ? undefined : index + 1;
}

/** A function or orphan file: laid out from its chunk's start. */
function checkChunkFile(rom: Rom, model: Model, index: IndexData, entry: { readonly path: string; readonly text: string }, m: number, c: number): FileCheck {
  const module = model.modules[m];
  const chunk = model.chunks[c];
  if (module === undefined || chunk === undefined) throw new RomliftInvariantError(`text-layout: the path index names chunk ${c} of module ${m}, which the model lacks`);
  const runOffset = runOffsetOf(chunk);
  const parsed = parse(asIncluded(entry.text));
  const job: Job = {
    path: entry.path,
    statements: parsed.statements,
    input: { start: chunk.span.start + runOffset, mode: incomingMode(model, module, c), resolve: resolveIn(model, index, m), incbin: romIncbin(rom), include: () => undefined, memo: index.memo, sameObject: inModule(model, index, m) },
    range: chunk.span,
    runOffset,
  };
  return compareLayout(rom, model, job, parsed.errors);
}

/** A module's chunk files in ROM order, with the span each stands for. */
function moduleChunkFiles(model: Model, index: IndexData, module: Module): readonly { readonly path: string; readonly span: Span }[] {
  const order: { readonly path: string; readonly span: Span }[] = [];
  for (let c = module.chunks.first; c < module.chunks.first + module.chunks.count; c++) {
    const path = index.chunkPaths[c];
    const chunk = model.chunks[c];
    if (path !== undefined && chunk !== undefined) order.push({ path, span: chunk.span });
  }
  return order;
}

/** The layout's include resolver of a unit file: each of the module's chunk files stands for its chunk's ROM bytes. */
function chunkBytes(order: readonly { readonly path: string; readonly span: Span }[]): (path: string) => readonly Statement[] | undefined {
  const files = new Map(order.map((f) => [f.path, f.span] as const));
  return (path) => {
    const span = files.get(path);
    return span === undefined ? undefined : [{ kind: 'incbin', line: 1, file: BASEROM_FILE, offset: span.start - ROM_BASE, length: span.end - span.start }];
  };
}

/**
 * The first place a unit file's includes (`got`, in text order) differ from the module's chunk files in ROM order
 * (`want`), or undefined when they are the same list: the byte comparison would only repeat a wrong order.
 */
function includeOrderError(path: string, got: readonly { readonly path: string; readonly line: number }[], want: readonly { readonly path: string; readonly span: Span }[], module: Module, lastLine: number): Diagnostic | undefined {
  for (let k = 0; k < Math.max(got.length, want.length); k++) {
    const g = got[k];
    const w = want[k];
    if (g?.path === w?.path) continue;
    const line = g?.line ?? lastLine;
    const addr = w?.span.start ?? module.span.end;
    const message =
      w === undefined
        ? `includes "${g?.path ?? ''}" after the module's last chunk file`
        : g === undefined
          ? `does not include "${w.path}", the chunk file at ${hexAddr(w.span.start)}`
          : `includes "${g.path}" where the module's chunk file in ROM order is "${w.path}"`;
    return textError(path, line, addr, message);
  }
  return undefined;
}

/** The module at `m`, which the path index names. */
function moduleAtIndex(model: Model, m: number): Module {
  const module = model.modules[m];
  if (module === undefined) throw new RomliftInvariantError(`text-layout: the path index names module ${m}, which the model lacks`);
  return module;
}

/** A module's source: laid out from the module's start, each include of a chunk file standing for its bytes. */
function checkSourceFile(rom: Rom, model: Model, index: IndexData, entry: { readonly path: string; readonly text: string }, m: number): FileCheck {
  const module = moduleAtIndex(model, m);
  const runOffset = runOffsetOf(module);
  const order = moduleChunkFiles(model, index, module);
  const parsed = parse(entry.text);
  const job: Job = {
    path: entry.path,
    statements: parsed.statements,
    input: { start: module.span.start + runOffset, mode: 'arm', resolve: resolveIn(model, index, m), incbin: romIncbin(rom), memo: index.memo, include: chunkBytes(order) },
    range: module.span,
    runOffset,
  };

  const includes = parsed.statements.filter((s): s is Statement & { readonly kind: 'include' } => s.kind === 'include');
  const lastLine = parsed.statements[parsed.statements.length - 1]?.line ?? 1;
  const firstInclude = includes[0];
  const macrosLine = macrosIncludeLine(entry.text);
  if (firstInclude !== undefined && (macrosLine === undefined || macrosLine > firstInclude.line)) {
    // Its chunk files use the macros without including them (asIncluded): the module file defines them once.
    return { diagnostics: [textError(entry.path, firstInclude.line, module.span.start, `includes a chunk file before it includes "${MACROS_PATH}", whose macros the chunk files use`)], sectionAlign: 0 };
  }
  const misordered = includeOrderError(entry.path, includes, order, module, lastLine);
  if (misordered !== undefined) return { diagnostics: [misordered], sectionAlign: 0 };
  return compareLayout(rom, model, job, parsed.errors);
}

/**
 * A C module's stub, src/<module>.c: a stub-only unit (c-stub.ts readStub) whose INCLUDE_ASM statements are the
 * module's chunk files in ROM order, laid out as the assembly agbcc emits for it (core/model/c-unit.ts): from the
 * module's start in STUB_UNIT_MODE, each statement's chunk file standing for its chunk's bytes, and nothing else. The
 * header's include of the macro file comes before every statement, as the chunk files need (asIncluded).
 */
function checkStubFile(rom: Rom, model: Model, index: IndexData, entry: { readonly path: string; readonly text: string }, m: number): FileCheck {
  const module = moduleAtIndex(model, m);
  const runOffset = runOffsetOf(module);
  const reading = readStub(entry.text);
  if (reading.problems.length > 0) return { diagnostics: reading.problems.map((p) => textError(entry.path, p.line, module.span.start, p.message)), sectionAlign: 0 };
  for (let c = module.chunks.first; c < module.chunks.first + module.chunks.count; c++) {
    const chunk = model.chunks[c];
    if (chunk !== undefined && index.chunkPaths[c] === undefined) {
      return { diagnostics: [textError(entry.path, 1, chunk.span.start, `the ${chunk.kind} chunk ${chunk.name} at ${hexAddr(chunk.span.start)} has no file of its own, and a C unit holds only INCLUDE_ASM statements`)], sectionAlign: 0 };
    }
  }
  const order = moduleChunkFiles(model, index, module);
  const lastLine = reading.includes[reading.includes.length - 1]?.line ?? 1;
  const misordered = includeOrderError(entry.path, reading.includes, order, module, lastLine);
  if (misordered !== undefined) return { diagnostics: [misordered], sectionAlign: 0 };
  const statements: Statement[] = [{ kind: 'mode', line: 1, mode: STUB_UNIT_MODE }, ...reading.includes.map((i): Statement => ({ kind: 'include', line: i.line, path: i.path }))];
  const job: Job = {
    path: entry.path,
    statements,
    input: { start: module.span.start + runOffset, mode: 'arm', resolve: resolveIn(model, index, m), incbin: romIncbin(rom), memo: index.memo, include: chunkBytes(order) },
    range: module.span,
    runOffset,
  };
  return compareLayout(rom, model, job, []);
}

// ---------------------------------------------------------------------------------------------------
// The check.

/** What one entry contributes: its problems (at most MAX_PER_ENTRY), and for a file of a unit the alignment it asks. */
interface EntryCheck {
  readonly diagnostics: readonly Diagnostic[];
  /** The unit (model.modules index) the file is assembled into, and its Layout.sectionAlign. */
  readonly unit?: { readonly module: number; readonly sectionAlign: number };
}

function checkOne(rom: Rom, model: Model, index: IndexData, entry: FileEntry): EntryCheck {
  // Of the scaffold, only the c-stub writer's src/<module>.c is a unit's source; a reconciled file (D75 b) is the user's C, which make builds, not this check.
  if (entry.ownership === 'reconciled' || (entry.ownership === 'scaffold' && entry.writer !== 'c-stub')) return { diagnostics: [] };
  const target = index.targets.get(entry.path);
  if (target === undefined) {
    return { diagnostics: CHECKED_WRITERS.has(entry.writer) ? [textError(entry.path, 1, ROM_BASE, `the ${entry.writer} writer emits a file no chunk or module of the model has`)] : [] };
  }
  let file: FileCheck;
  switch (target.kind) {
    case 'chunk':
      file = checkChunkFile(rom, model, index, entry, target.module, target.chunk);
      break;
    case 'source':
      file = checkSourceFile(rom, model, index, entry, target.module);
      break;
    case 'c-stub':
      file = checkStubFile(rom, model, index, entry, target.module);
      break;
    case 'ldscript':
      return { diagnostics: checkLdscript(model, entry.path, entry.text).slice(0, MAX_PER_ENTRY) };
    case 'symbols':
      return { diagnostics: checkSymbolsFile(model, entry.path, entry.text).slice(0, MAX_PER_ENTRY) };
  }
  return { diagnostics: file.diagnostics.slice(0, MAX_PER_ENTRY), unit: { module: target.module, sectionAlign: file.sectionAlign } };
}


/**
 * The text-layout check of ONE entry against `model`, with an index built for it alone: O(model) per call, so for
 * tests and single files, never for a stream (checkEntries indexes once per pass). [] when it is not this check's or
 * it passes. Not part of romlift's public API.
 */
export function checkEntry(rom: Rom, model: Model, entry: FileEntry): readonly Diagnostic[] {
  return checkOne(rom, model, indexData(model), entry).diagnostics;
}

/**
 * The unit-level part of the check, once the stream has passed: GNU as pads each object's section to a multiple
 * of its alignment (the largest any of the unit's files asks, Layout.sectionAlign) and ld places it at a
 * multiple of it, so a unit whose start or length is not one links to an image that is longer or shifted.
 */
function unitAlignment(model: Model, aligns: ReadonlyMap<number, number>): Diagnostic[] {
  const out: Diagnostic[] = [];
  model.modules.forEach((module, m) => {
    const power = aligns.get(m);
    if (power === undefined || !module.generated) return;
    const unit = 2 ** power;
    const source = moduleSource(model, module);
    const length = module.span.end - module.span.start;
    if ((module.span.start - ROM_BASE) % unit !== 0) {
      out.push(textError(source, 1, module.span.start, `the object's section is aligned to ${unit} bytes, so ld places it past ${hexAddr(module.span.start)}, the module's start`));
    } else if (length % unit !== 0) {
      const pad = unit - (length % unit);
      out.push(textError(source, 1, module.span.end, `GNU as pads the object's section to a multiple of ${unit} bytes, ${pad} past the module's end ${hexAddr(module.span.end)}, so the image is longer than the ROM range`));
    }
  });
  return out;
}

/** The 'text-layout' CheckResult of the diagnostics of `files` checked entries. */
export function textLayoutResult(diagnostics: readonly Diagnostic[], files: number): CheckResult {
  const first = diagnostics[0]?.message;
  const detail = first === undefined ? `${files} files lay out to their ROM ranges` : diagnostics.length > 1 ? `${first} (${diagnostics.length} problems in all)` : first;
  return checkResult('text-layout', diagnostics, detail);
}

/**
 * The text-layout and paths checks of a whole stream, in one pass that keeps only the paths: each entry checked on
 * each entry, then every path the model needs that the stream lacked (E_SELF_CHECK_TEXT), then checkPaths.
 */
export function checkEntries(rom: Rom, model: Model, entries: Iterable<FileEntry>): VerifyReport {
  const diagnostics: Diagnostic[] = [];
  const paths: string[] = [];
  const aligns = new Map<number, number>();
  const index = indexData(model);
  for (const entry of entries) {
    paths.push(entry.path);
    const found = checkOne(rom, model, index, entry);
    pushAll(diagnostics, found.diagnostics);
    if (found.unit !== undefined) aligns.set(found.unit.module, Math.max(aligns.get(found.unit.module) ?? 0, found.unit.sectionAlign));
  }
  const emitted = new Set(paths);
  for (const { path, addr } of index.expected) {
    if (!emitted.has(path)) diagnostics.push(textError(path, 1, addr, 'the stream emits no such file, which the model needs'));
  }
  pushAll(diagnostics, unitAlignment(model, aligns));
  const checks = [textLayoutResult(diagnostics, paths.length), pathsCheck(paths)];
  return { ok: checks.every((c) => c.ok), checks };
}
