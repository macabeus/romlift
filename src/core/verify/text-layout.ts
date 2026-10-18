// The text-layout self-check (architecture §6.4, §6.7, D49): every file the emission stream produces is
// read back and must rebuild exactly what the model says it holds, without a toolchain. checkEntry checks
// ONE FileEntry, so the check pass streams the emission and keeps no tree (§9.4); checkEntries folds a
// whole stream into the 'text-layout' and 'paths' results.
//
// - A function or orphan file (core/model/paths.ts chunkPaths) is parsed with foundation/asm/statements.ts
//   (include/macros.inc is DIALECT.macrosInc) and laid out by foundation/asm/layout.ts from its chunk's
//   start, in the state the previous chunk of its module leaves (Thumb before a module's first chunk: the
//   module file's preamble), at its run address inside a runs_at range, so local labels take the addresses
//   ld gives them. It is read as `as` reads it, inside its module file, after that file's include of the
//   macro file: a chunk file that includes the macro file again redefines every macro, which `as` refuses.
//   Names it does not define resolve to the model: a label of its module, else a global label (resolver.ts
//   wordValueOf: a Thumb function carries the Thumb bit), else a [symbols] entry (what symbols.ld defines);
//   only a label a printer can place counts, one at an item's start or inside a data item (chunk.ts places no
//   other), so a name the tree never defines is an undefined symbol here as for `as`. A PC-relative load or
//   `adr` may name only a label of its own module, the object `as` assembles it into (D63).
//   `.incbin "baserom.gba"` reads the ROM.
// - A module's source (asm/rom_header.s, asm/crt0.s, asm/<module>.s, data/<module>.s; paths.ts
//   moduleSource) is laid out from the module's start in ARM state (GNU as starts every file in ARM state).
//   Each `.include` of one of the module's chunk files stands for that chunk's ROM bytes; the includes must
//   be exactly the module's chunk files in ROM order, so the file adds no byte of its own beyond what the
//   model puts between them (a header, startup or data chunk it holds inline).
// - Every laid-out file must reproduce its ROM range byte for byte, and every `.align` (and every pad of a
//   switch to ARM state) that emits bytes must emit exactly the padding item at that address.
// - ldscript.txt and symbols.ld are checked structurally: each build unit once, in ROM order, a runs_at
//   unit at its run address loaded at its load address with its __load_ symbol; each symbol outside the
//   ROM defined once with the model's value, and nothing else.
//
// Every failure is E_SELF_CHECK_TEXT with the file (`path`), the line (in the message) and the load
// address (`addr`) of the first difference. Scaffold and reconciled entries, and entries of writers of later
// phases, are not this check's.
import { DIALECT } from '../../foundation/asm/dialect.ts';
import { layoutMemo, layoutStatements } from '../../foundation/asm/layout.ts';
import type { Layout, LayoutInput, LayoutMemo } from '../../foundation/asm/layout.ts';
import { parseStatements } from '../../foundation/asm/statements.ts';
import type { Statement } from '../../foundation/asm/statements.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { ROM_BASE } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { hexAddr, parseHexAddr } from '../../foundation/util/hex.ts';
import type { FileEntry, WriterId } from '../emit/tree.ts';
import { findItem, specIdAt } from '../model/item-table.ts';
import { buildUnits, chunkPaths, LDSCRIPT_PATH, moduleSource, SYMBOLS_PATH } from '../model/paths.ts';
import { moduleIndexAt, wordValueOf } from '../model/resolver.ts';
import { ItemKind } from '../model/types.ts';
import type { Label, Model, Module } from '../model/types.ts';
import { pathsCheck } from './paths.ts';
import { checkResult } from './report.ts';
import type { CheckResult, VerifyReport } from './report.ts';
import { VerifyCodes } from './codes.ts';

/** The only file an `.incbin` may read: the user's ROM at the project root. */
export const BASEROM_FILE = 'baserom.gba';

/** The macro file every generated `.s` includes. */
export const MACROS_PATH = 'include/macros.inc';

/** How many problems one entry reports at most; the first is the one that matters. */
export const MAX_PER_ENTRY = 16;

/** The writers whose files this check reads; an unknown path of one of them is an error. */
const CHECKED_WRITERS: ReadonlySet<WriterId> = new Set<WriterId>(['header', 'crt0', 'function', 'orphan', 'module', 'data', 'ldscript', 'symbols']);

const INCLUDES: ReadonlyMap<string, string> = new Map([[MACROS_PATH, DIALECT.macrosInc]]);

// ---------------------------------------------------------------------------------------------------
// What each path of the model holds, indexed once per model.

type Target =
  | { readonly kind: 'chunk'; readonly module: number; readonly chunk: number }
  | { readonly kind: 'source'; readonly module: number }
  | { readonly kind: 'ldscript' }
  | { readonly kind: 'symbols' };

interface PathIndex {
  readonly targets: ReadonlyMap<string, Target>;
  /** chunkPaths(model), aligned with model.chunks. */
  readonly chunkPaths: readonly (string | undefined)[];
  /** Every path the stream of the model must hold, in model order, with the address its bytes start at. */
  readonly expected: readonly { readonly path: string; readonly addr: Addr }[];
  /** The labels a printer can place (definable), by name, each list by address. */
  readonly labelsByName: ReadonlyMap<string, readonly Label[]>;
  /** [symbols] entries by name (the first by address). */
  readonly symbolsByName: ReadonlyMap<string, Addr>;
  /** What every layout of the model's files remembers of instruction texts (foundation/asm/layout.ts). */
  readonly memo: LayoutMemo;
}

const INDEXES = new WeakMap<Model, PathIndex>();

/**
 * Whether a printer can place `label`: its load address is an item's start, or lies inside a data item (the
 * readable printer splits a data item there, the data writer an `.incbin`, the header its `.byte` lines). An
 * instruction, pool word or table entry cannot be cut, so a label inside one is never defined (D63 d).
 */
function definable(model: Model, label: Label): boolean {
  const m = moduleIndexAt(model.modules, label.addr);
  const module = model.modules[m];
  if (module === undefined) return false;
  const load = label.addr - (module.runAt ?? module.span.start) + module.span.start;
  const i = findItem(model.items, load);
  return i >= 0 && (model.items.start[i] === load || model.items.kind[i] === ItemKind.data);
}

function buildIndex(model: Model): PathIndex {
  const paths = chunkPaths(model);
  const targets = new Map<string, Target>([
    [LDSCRIPT_PATH, { kind: 'ldscript' }],
    [SYMBOLS_PATH, { kind: 'symbols' }],
  ]);
  const expected: { readonly path: string; readonly addr: Addr }[] = [];
  model.modules.forEach((module, m) => {
    if (!module.generated) return;
    // A C module's source is the c-stub writer's (phase 4); its function files are laid out all the same.
    if (module.kind !== 'c') {
      const source = moduleSource(model, module);
      targets.set(source, { kind: 'source', module: m });
      expected.push({ path: source, addr: module.span.start });
    }
    for (let c = module.chunks.first; c < module.chunks.first + module.chunks.count; c++) {
      const path = paths[c];
      const chunk = model.chunks[c];
      if (path === undefined || chunk === undefined) continue;
      targets.set(path, { kind: 'chunk', module: m, chunk: c });
      expected.push({ path, addr: chunk.span.start });
    }
  });
  expected.push({ path: LDSCRIPT_PATH, addr: ROM_BASE }, { path: SYMBOLS_PATH, addr: ROM_BASE });
  const labelsByName = new Map<string, Label[]>();
  for (const label of model.labels) {
    if (!definable(model, label)) continue;
    const list = labelsByName.get(label.name);
    if (list === undefined) labelsByName.set(label.name, [label]);
    else list.push(label);
  }
  const symbolsByName = new Map<string, Addr>();
  for (const s of model.symbols) if (!symbolsByName.has(s.name)) symbolsByName.set(s.name, s.addr);
  return { targets, chunkPaths: paths, expected, labelsByName, symbolsByName, memo: layoutMemo() };
}

function indexOf(model: Model): PathIndex {
  const cached = INDEXES.get(model);
  if (cached !== undefined) return cached;
  const index = buildIndex(model);
  INDEXES.set(model, index);
  return index;
}

// ---------------------------------------------------------------------------------------------------
// Diagnostics.

function textError(path: string, line: number, addr: Addr, message: string): Diagnostic {
  return diagnostic(VerifyCodes, 'E_SELF_CHECK_TEXT', `${path} line ${line}: ${message} (at ${hexAddr(addr)})`, { path, addr });
}

// ---------------------------------------------------------------------------------------------------
// Laying a file out.

/** The value of a name a file of module `m` does not define (what ld would give it), or undefined. */
function resolveIn(model: Model, index: PathIndex, m: number): (name: string) => number | undefined {
  return (name) => {
    const labels = index.labelsByName.get(name) ?? [];
    const label = labels.find((l) => moduleIndexAt(model.modules, l.addr) === m) ?? labels.find((l) => l.scope === 'global');
    if (label !== undefined) return wordValueOf(label);
    return index.symbolsByName.get(name);
  };
}

/** Whether a name a file of module `m` does not define is a label of module `m` itself (one object). */
function inModule(model: Model, index: PathIndex, m: number): (name: string) => boolean {
  return (name) => (index.labelsByName.get(name) ?? []).some((l) => moduleIndexAt(model.modules, l.addr) === m);
}

function romIncbin(rom: Rom): (file: string, offset: number, length: number) => Uint8Array | undefined {
  return (file, offset, length) => (file === BASEROM_FILE && offset + length <= rom.bytes.length ? rom.bytes.subarray(offset, offset + length) : undefined);
}

/** The mode of an item's isa row, or undefined when it names none. */
function itemMode(model: Model, i: number): Mode | undefined {
  const kind = model.items.kind[i];
  if (kind !== ItemKind.insn && kind !== ItemKind.rawInsn) return undefined;
  const spec = specIdAt(model.items.spec[i] ?? 0xffff);
  return spec === undefined ? undefined : spec.startsWith('thumb.') ? 'thumb' : 'arm';
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

/** Every difference between a laid-out file and the model: bytes, length and padding. */
function compareLayout(rom: Rom, model: Model, job: Job, parseErrors: readonly { readonly line: number; readonly message: string }[]): Diagnostic[] {
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
  return out;
}

function parse(text: string): { readonly statements: readonly Statement[]; readonly errors: readonly { readonly line: number; readonly message: string }[] } {
  return parseStatements(text, { includes: INCLUDES });
}

/** The `.include` of the macro file, as the dialect preamble writes it. */
const MACROS_INCLUDE = `.include "${MACROS_PATH}"`;

/**
 * A chunk file as GNU as reads it inside its module file: after the module file's `.include` of the macro
 * file. The include is put in front of line 1 (`;` separates statements), so line numbers stay the file's,
 * and a chunk file that includes the macro file again fails as `as` fails, on a second macro definition.
 */
function asIncluded(text: string): string {
  return `${MACROS_INCLUDE}; ${text}`;
}

/** The line of the module file's `.include` of the macro file, or undefined (parseStatements leaves it no statement). */
function macrosIncludeLine(text: string): number | undefined {
  const index = text.split('\n').findIndex((raw) => raw.replace(/@.*$/, '').trim() === MACROS_INCLUDE);
  return index < 0 ? undefined : index + 1;
}

/** A function or orphan file: laid out from its chunk's start. */
function checkChunkFile(rom: Rom, model: Model, index: PathIndex, entry: { readonly path: string; readonly text: string }, m: number, c: number): Diagnostic[] {
  const module = model.modules[m] as Module;
  const chunk = model.chunks[c];
  if (chunk === undefined) return [];
  const runOffset = chunk.runAt === undefined ? 0 : chunk.runAt - chunk.span.start;
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

/** A module's source: laid out from the module's start, each include of a chunk file standing for its bytes. */
function checkSourceFile(rom: Rom, model: Model, index: PathIndex, entry: { readonly path: string; readonly text: string }, m: number): Diagnostic[] {
  const module = model.modules[m] as Module;
  const runOffset = module.runAt === undefined ? 0 : module.runAt - module.span.start;
  const files = new Map<string, Span>();
  const order: { readonly path: string; readonly span: Span }[] = [];
  for (let c = module.chunks.first; c < module.chunks.first + module.chunks.count; c++) {
    const path = index.chunkPaths[c];
    const chunk = model.chunks[c];
    if (path === undefined || chunk === undefined) continue;
    files.set(path, chunk.span);
    order.push({ path, span: chunk.span });
  }
  const parsed = parse(entry.text);
  const job: Job = {
    path: entry.path,
    statements: parsed.statements,
    input: {
      start: module.span.start + runOffset,
      mode: 'arm',
      resolve: resolveIn(model, index, m),
      incbin: romIncbin(rom),
      memo: index.memo,
      include: (path) => {
        const span = files.get(path);
        return span === undefined ? undefined : [{ kind: 'incbin', line: 1, file: BASEROM_FILE, offset: span.start - ROM_BASE, length: span.end - span.start }];
      },
    },
    range: module.span,
    runOffset,
  };

  const includes = parsed.statements.filter((s): s is Statement & { readonly kind: 'include' } => s.kind === 'include');
  const lastLine = parsed.statements[parsed.statements.length - 1]?.line ?? 1;
  const firstInclude = includes[0];
  const macrosLine = macrosIncludeLine(entry.text);
  if (firstInclude !== undefined && (macrosLine === undefined || macrosLine > firstInclude.line)) {
    // Its chunk files use the macros without including them (asIncluded): the module file defines them once.
    return [textError(entry.path, firstInclude.line, module.span.start, `includes a chunk file before it includes "${MACROS_PATH}", whose macros the chunk files use`)];
  }
  for (let k = 0; k < Math.max(includes.length, order.length); k++) {
    const got = includes[k];
    const want = order[k];
    if (got?.path === want?.path) continue;
    const line = got?.line ?? lastLine;
    const addr = want?.span.start ?? module.span.end;
    const message =
      want === undefined
        ? `includes "${got?.path ?? ''}" after the module's last chunk file`
        : got === undefined
          ? `does not include "${want.path}", the chunk file at ${hexAddr(want.span.start)}`
          : `includes "${got.path}" where the module's chunk file in ROM order is "${want.path}"`;
    // The order is wrong from here on; the byte comparison would only repeat it.
    return [textError(entry.path, line, addr, message)];
  }
  return compareLayout(rom, model, job, parsed.errors);
}

// ---------------------------------------------------------------------------------------------------
// The linker script and symbols.ld, structurally.

/** The text with every comment blanked, line breaks kept. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** The symbols outside the ROM, as symbols.ld must define them. */
function externalSymbols(model: Model): ReadonlyMap<string, Addr> {
  const out = new Map<string, Addr>();
  for (const s of model.symbols) if ((s.addr < ROM_BASE || s.addr >= model.rom.end) && !out.has(s.name)) out.set(s.name, s.addr);
  return out;
}

interface ScriptObject {
  readonly object: string;
  readonly line: number;
  /** The section it is placed in, and whether it is the first object of it. */
  readonly section: string;
  readonly first: boolean;
  readonly vma?: Addr;
  readonly lma?: Addr;
}

const SECTION_AT = /^\.([A-Za-z0-9_.$]+)\s+(0x[0-9A-Fa-f]+)\s*:\s*AT\(\s*(0x[0-9A-Fa-f]+)\s*\)\s*\{$/;
const SECTION = /^\.([A-Za-z0-9_.$]+)\s*:\s*\{$/;
const OBJECT = /^(\S+)\(\.text\);?$/;
const LOAD_SYMBOL = /^__load_([A-Za-z0-9_.$]+)\s*=\s*LOADADDR\(\s*\.([A-Za-z0-9_.$]+)\s*\);$/;
const START = /^\.\s*=\s*(0x[0-9A-Fa-f]+)\s*;$/;
const ASSIGNMENT = /^([A-Za-z_.$][A-Za-z0-9_.$]*)\s*=\s*(0x[0-9A-Fa-f]+)\s*;$/;

function checkLdscript(model: Model, path: string, text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lines = withoutComments(text).split('\n');
  const objects: ScriptObject[] = [];
  const loads = new Map<string, string>();
  let includesSymbols = false;
  let start: Addr | undefined;
  let inSections = false;
  let section: { readonly name: string; readonly vma?: Addr; readonly lma?: Addr; count: number } | undefined;
  lines.forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (s === '') return;
    const err = (message: string): void => {
      out.push(textError(path, line, ROM_BASE, message));
    };
    if (!inSections) {
      if (s === `INCLUDE ${SYMBOLS_PATH}`) includesSymbols = true;
      else if (s === 'SECTIONS {') inSections = true;
      else err(`unexpected \`${s}\` outside SECTIONS`);
      return;
    }
    if (section !== undefined) {
      const object = OBJECT.exec(s);
      if (object !== null) {
        objects.push({
          object: object[1] ?? '',
          line,
          section: section.name,
          first: section.count === 0,
          ...(section.vma === undefined ? {} : { vma: section.vma }),
          ...(section.lma === undefined ? {} : { lma: section.lma }),
        });
        section.count++;
      } else if (s === '}') section = undefined;
      else err(`unexpected \`${s}\` inside section .${section.name}`);
      return;
    }
    const at = SECTION_AT.exec(s);
    const plain = SECTION.exec(s);
    const loadSymbol = LOAD_SYMBOL.exec(s);
    const startAt = START.exec(s);
    if (at !== null) section = { name: at[1] ?? '', vma: parseHexAddr(at[2] ?? '') ?? 0, lma: parseHexAddr(at[3] ?? '') ?? 0, count: 0 };
    else if (plain !== null) {
      if (start === undefined) err(`section .${plain[1] ?? ''} has no address and no \`. = ${hexAddr(ROM_BASE)};\` precedes it`);
      section = { name: plain[1] ?? '', count: 0 };
    } else if (loadSymbol !== null) loads.set(loadSymbol[1] ?? '', loadSymbol[2] ?? '');
    else if (startAt !== null) {
      start = parseHexAddr(startAt[1] ?? '');
      if (start !== ROM_BASE) err(`the link starts at ${startAt[1] ?? ''}, not ${hexAddr(ROM_BASE)}`);
    } else if (s === '}') inSections = false;
    else err(`unexpected \`${s}\``);
  });

  const lastLine = lines.length;
  const wantSymbols = externalSymbols(model).size > 0;
  if (wantSymbols !== includesSymbols) {
    out.push(textError(path, 1, ROM_BASE, wantSymbols ? `does not INCLUDE ${SYMBOLS_PATH}, which defines symbols the code names` : `INCLUDEs ${SYMBOLS_PATH}, which defines nothing`));
  }
  const units = buildUnits(model);
  for (let k = 0; k < Math.max(units.length, objects.length); k++) {
    const unit = units[k];
    const got = objects[k];
    const module = model.modules[k];
    if (unit === undefined || got === undefined || module === undefined || got.object !== unit.object) {
      const where = got?.line ?? lastLine;
      const addr = module?.span.start ?? model.rom.end;
      const message =
        unit === undefined
          ? `links ${got?.object ?? ''} after the last build unit`
          : got === undefined
            ? `does not link ${unit.object}, the unit of module ${unit.module}`
            : `links ${got.object} where the build unit in ROM order is ${unit.object}`;
      out.push(textError(path, where, addr, message));
      break;
    }
    const at = module.span.start;
    if (module.runAt !== undefined) {
      if (!got.first || got.vma !== module.runAt || got.lma !== at) {
        out.push(textError(path, got.line, at, `${unit.object} runs from ${hexAddr(module.runAt)} and must open its own section at ${hexAddr(module.runAt)} : AT(${hexAddr(at)})`));
      }
      if (loads.get(module.name) !== got.section) out.push(textError(path, got.line, at, `no \`__load_${module.name} = LOADADDR(.${got.section});\` names where ${unit.object} is loaded`));
    } else if (got.first && got.lma !== undefined && (got.lma !== at || got.vma !== at)) {
      out.push(textError(path, got.line, at, `section .${got.section} opens at ${hexAddr(got.vma ?? 0)} : AT(${hexAddr(got.lma)}), but ${unit.object} loads at ${hexAddr(at)}`));
    } else if (got.vma !== undefined && got.vma !== got.lma) {
      out.push(textError(path, got.line, at, `${unit.object} shares a runs_at section with another unit`));
    }
  }
  return out;
}

function checkSymbolsFile(model: Model, path: string, text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const want = externalSymbols(model);
  const seen = new Set<string>();
  const lines = withoutComments(text).split('\n');
  lines.forEach((raw, i) => {
    const s = raw.trim();
    if (s === '') return;
    const m = ASSIGNMENT.exec(s);
    if (m === null) {
      out.push(textError(path, i + 1, ROM_BASE, `unexpected \`${s}\`; symbols.ld holds only \`name = 0xADDR;\` lines`));
      return;
    }
    const name = m[1] ?? '';
    const value = parseHexAddr(m[2] ?? '') ?? -1;
    const expected = want.get(name);
    if (expected === undefined) out.push(textError(path, i + 1, value, `defines ${name}, which is no [symbols] entry outside the ROM`));
    else if (seen.has(name)) out.push(textError(path, i + 1, value, `defines ${name} twice`));
    else if (value !== expected) out.push(textError(path, i + 1, value, `defines ${name} as ${m[2] ?? ''}, but the model has ${hexAddr(expected)}`));
    seen.add(name);
  });
  for (const s of model.symbols) {
    if (want.get(s.name) === s.addr && !seen.has(s.name)) {
      out.push(textError(path, lines.length, s.addr, `does not define ${s.name}`));
      seen.add(s.name);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The check.

/** The text-layout check of one entry of the emission stream; [] when it is not this check's or it passes. */
export function checkEntry(rom: Rom, model: Model, entry: FileEntry): readonly Diagnostic[] {
  if (entry.ownership !== 'generated') return [];
  const index = indexOf(model);
  const target = index.targets.get(entry.path);
  let found: Diagnostic[];
  if (target === undefined) {
    found = CHECKED_WRITERS.has(entry.writer) ? [textError(entry.path, 1, ROM_BASE, `the ${entry.writer} writer emits a file no chunk or module of the model has`)] : [];
  } else {
    switch (target.kind) {
      case 'chunk':
        found = checkChunkFile(rom, model, index, entry, target.module, target.chunk);
        break;
      case 'source':
        found = checkSourceFile(rom, model, index, entry, target.module);
        break;
      case 'ldscript':
        found = checkLdscript(model, entry.path, entry.text);
        break;
      case 'symbols':
        found = checkSymbolsFile(model, entry.path, entry.text);
        break;
    }
  }
  return found.slice(0, MAX_PER_ENTRY);
}

/** The 'text-layout' CheckResult of the diagnostics of `files` checked entries. */
export function textLayoutResult(diagnostics: readonly Diagnostic[], files: number): CheckResult {
  const first = diagnostics[0]?.message;
  const detail = first === undefined ? `${files} files lay out to their ROM ranges` : diagnostics.length > 1 ? `${first} (${diagnostics.length} problems in all)` : first;
  return checkResult('text-layout', diagnostics, detail);
}

/**
 * The text-layout and paths checks of a whole stream, in one pass that keeps only the paths: checkEntry on
 * each entry, then every path the model needs that the stream lacked (E_SELF_CHECK_TEXT), then checkPaths.
 */
export function checkEntries(rom: Rom, model: Model, entries: Iterable<FileEntry>): VerifyReport {
  const diagnostics: Diagnostic[] = [];
  const paths: string[] = [];
  for (const entry of entries) {
    paths.push(entry.path);
    diagnostics.push(...checkEntry(rom, model, entry));
  }
  const emitted = new Set(paths);
  for (const { path, addr } of indexOf(model).expected) {
    if (!emitted.has(path)) diagnostics.push(textError(path, 1, addr, 'the stream emits no such file, which the model needs'));
  }
  const checks = [textLayoutResult(diagnostics, paths.length), pathsCheck(paths)];
  return { ok: checks.every((c) => c.ok), checks };
}
