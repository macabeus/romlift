// The model's modules (architecture §6.2, §6.7, D46, D47, D75 a): the config's modules in link order, each spanning
// from its start to the next one's (the last to the ROM end), checked against the ROM's legal borders, with its
// build compiler resolved and the run address of a runs_at override. Their chunks are filled in by model.ts.
//
// Whether a start is legal is core/layout's one rule (borders.ts isLegalStart, architecture-r1-3): the code region's
// legal borders, and every word from the data start to the ROM end (D75 a). The bytes between a confirm run's lower
// data start and a data border the TOML keeps are the tail of the module before, an orphan chunk there.
//
// A C data range (architecture §6.6, phase 6, D92): a `c` module's `data_start` D starts the range [D, the first module
// start after D, or the ROM end), whose bytes belong to that module's C object (its `.rodata`): no generated file emits
// them. D must be word-aligned, at or past the data start (only data lies there), inside the ROM and past its module's
// start, outside every runs_at range, and the ranges of two modules must not overlap; else E_DATA_RANGE_INVALID and the
// module gets no range. The range cuts the module whose span holds D at D: its own module, whose text span then ends
// there, or a `data` module, clipped at the range start; a `data` module starting at D, wholly inside the range, is
// dropped from the model; any other module there is E_DATA_RANGE_INVALID. By construction the range ends at a module
// start or the ROM end. Module.span is then the module's text span, and the spans and the ranges (modulePieces) tile
// the ROM.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { spanIndexAt } from '../../foundation/util/arrays.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { compareNumbers } from '../../foundation/util/sorted.ts';
import { buildCompilerOf } from '../config/compilers.ts';
import type { ModuleConfig, RomliftConfig } from '../config/schema.ts';
import { isLegalStart, nearestLegalStarts } from '../layout/borders.ts';
import type { BorderRule } from '../layout/borders.ts';
import { ModelCodes } from './codes.ts';
import type { Module } from './types.ts';

export interface ModulesPlan {
  /** In link order, tiling the ROM; `chunks` is empty until the chunks are laid out. */
  readonly modules: readonly Module[];
  readonly diagnostics: readonly Diagnostic[];
}

/** The module a config with no usable module gets, so a model can still be built and its errors reported. */
const FALLBACK_NAME = 'main';

/** The nearest legal starts around `start` under `rule`, as E_MODULE_BORDER's message names them. */
function describeBorders(rule: BorderRule, start: Addr): string {
  const { below, above } = nearestLegalStarts(rule, start);
  const parts = [below === undefined ? undefined : `${hexAddr(below)} below`, above === undefined ? undefined : `${hexAddr(above)} above`].filter((p) => p !== undefined);
  return parts.length === 0 ? 'there is no legal border' : `the nearest legal borders are ${parts.join(' and ')}`;
}

/** The modules whose starts increase from the ROM base, with the diagnostics of every one left out or moved. */
function orderedModules(rom: Rom, config: RomliftConfig, rule: BorderRule, diagnostics: Diagnostic[]): ModuleConfig[] {
  const kept: ModuleConfig[] = [];
  for (const m of config.modules) {
    const last = kept[kept.length - 1];
    if (last !== undefined && m.start <= last.start) {
      diagnostics.push(diagnostic(ModelCodes, 'E_MODULE_ORDER', `module ${m.name} starts at ${hexAddr(m.start)}, not after ${last.name} (${hexAddr(last.start)})`, { addr: m.start, cites: [last.start] }));
      continue;
    }
    if (m.start < rom.base || m.start >= rom.end) {
      diagnostics.push(diagnostic(ModelCodes, 'E_MODULE_BORDER', `module ${m.name} starts at ${hexAddr(m.start)}, outside the ROM [${hexAddr(rom.base)}, ${hexAddr(rom.end)})`, { addr: m.start }));
      continue;
    }
    if (!isLegalStart(rule, m.start)) {
      const near = nearestLegalStarts(rule, m.start);
      diagnostics.push(diagnostic(ModelCodes, 'E_MODULE_BORDER', `module ${m.name} starts at ${hexAddr(m.start)}, which is not a legal border: ${describeBorders(rule, m.start)}`, { addr: m.start, cites: [near.below, near.above].filter((a): a is Addr => a !== undefined) }));
    }
    kept.push(m);
  }
  const first = kept[0];
  if (first === undefined) {
    diagnostics.push(diagnostic(ModelCodes, 'E_MODULE_ORDER', `the config has no module inside the ROM; the model uses one module, ${FALLBACK_NAME}, for the whole ROM`, { addr: rom.base }));
    return [{ name: FALLBACK_NAME, start: rom.base, kind: 'asm', generated: true }];
  }
  if (first.start !== rom.base) {
    diagnostics.push(diagnostic(ModelCodes, 'E_MODULE_ORDER', `the first module, ${first.name}, starts at ${hexAddr(first.start)}, not at the ROM base ${hexAddr(rom.base)}; the model starts it at the base`, { addr: first.start }));
    kept[0] = { ...first, start: rom.base };
  }
  return kept;
}

/**
 * Every module spanning a runs_at override gets its run address. E_OVERRIDE_INVALID, and no run address, for an override
 * not bounded by module starts, one whose run range [runs_at, runs_at + size) overlaps the ROM's own load space
 * [base, end) without being its load range itself (ld would place the RAM section over the cartridge's; runs_at equal
 * to the start is the identity, which moves nothing), or one whose run range overlaps that of an earlier
 * override (in start order; two sections cannot run at one address) (correctness-8).
 */
function runAddresses(rom: Rom, config: RomliftConfig, spans: readonly { readonly start: Addr; readonly end: Addr }[], diagnostics: Diagnostic[]): (Addr | undefined)[] {
  const runAt: (Addr | undefined)[] = spans.map(() => undefined);
  const isBorder = (a: Addr): boolean => a === rom.end || spans.some((s) => s.start === a);
  const ranged = config.overrides.filter((o) => o.runsAt !== undefined).sort((a, b) => compareNumbers(a.start, b.start));
  const running: Span[] = [];
  for (const o of ranged) {
    if (o.runsAt === undefined) continue;
    const end = o.start + o.size;
    const span = { start: o.start, end };
    const run = { start: o.runsAt, end: o.runsAt + o.size };
    const refuse = (why: string): void => {
      diagnostics.push(diagnostic(ModelCodes, 'E_OVERRIDE_INVALID', `the runs_at range [${hexAddr(o.start)}, ${hexAddr(end)}) ${why}`, { span, addr: o.start }));
    };
    if (!isBorder(o.start) || !isBorder(end)) {
      refuse('does not start and end on module borders; a range that runs from RAM is its own module');
      continue;
    }
    if (run.start !== span.start && run.start < rom.end && rom.base < run.end) {
      refuse(`runs at [${hexAddr(run.start)}, ${hexAddr(run.end)}), which overlaps the ROM's load space [${hexAddr(rom.base)}, ${hexAddr(rom.end)}); a range runs from RAM, outside the cartridge`);
      continue;
    }
    const clash = running.find((r) => run.start < r.end && r.start < run.end);
    if (clash !== undefined) {
      refuse(`runs at [${hexAddr(run.start)}, ${hexAddr(run.end)}), which overlaps the run range [${hexAddr(clash.start)}, ${hexAddr(clash.end)}) of another runs_at range`);
      continue;
    }
    running.push(run);
    spans.forEach((s, i) => {
      if (s.start >= o.start && s.start < end && runAt[i] === undefined && o.runsAt !== undefined) runAt[i] = o.runsAt + (s.start - o.start);
    });
  }
  return runAt;
}

/** The word a data range starts on: `ld` places the C object's `.rodata` at its own alignment, which agbcc keeps at most 4. */
const DATA_ALIGN = 4;

/** A data range that passed its checks: the module it belongs to (an index of `kept`) and its span. */
interface PlannedRange {
  readonly owner: number;
  readonly span: Span;
}

/** The runs_at ranges of the config's overrides, as load spans. */
function runsAtSpans(config: RomliftConfig): readonly Span[] {
  return config.overrides.flatMap((o) => (o.runsAt === undefined ? [] : [{ start: o.start, end: o.start + o.size }]));
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function rangeText(span: Span): string {
  return `[${hexAddr(span.start)}, ${hexAddr(span.end)})`;
}

/**
 * Why module `kept[i]`'s data_start cannot start the data range `span` (from the data_start to the next module start, the
 * module comment above), or undefined when it can. `others` are the ranges already accepted, in config order.
 */
function rangeProblem(rom: Rom, kept: readonly ModuleConfig[], i: number, span: Span, rule: BorderRule, config: RomliftConfig, others: readonly PlannedRange[]): string | undefined {
  const m = kept[i];
  if (m === undefined) return 'it names no module';
  const start = span.start;
  if (m.kind !== 'c') return `data_start is legal only on a module of kind = "c", and ${m.name} is kind = "${m.kind}"`;
  if (start % DATA_ALIGN !== 0) return 'it is not word-aligned';
  if (start >= rom.end) return `it lies at or past the ROM end ${hexAddr(rom.end)}`;
  if (start < rule.dataStart) return `it lies below the data start ${hexAddr(rule.dataStart)}, where code lies`;
  if (start <= m.start) return `it does not lie past the module's start ${hexAddr(m.start)}`;
  const runsAt = runsAtSpans(config).find((r) => overlaps(r, span));
  if (runsAt !== undefined) return `its range ${rangeText(span)} overlaps the runs_at range ${rangeText(runsAt)}`;
  const holder = kept.findIndex((k, j) => k.start <= start && start < (kept[j + 1]?.start ?? rom.end));
  const cut = kept[holder];
  if (cut !== undefined && holder !== i && cut.kind !== 'data' && cut.start < start) return `its range ${rangeText(span)} cuts module ${cut.name}, which is neither ${m.name} nor a data module`;
  const covered = kept.find((k) => k.start === start);
  if (covered !== undefined && covered.kind !== 'data') return `its range ${rangeText(span)} covers module ${covered.name}, which is not a data module`;
  const other = others.find((r) => overlaps(r.span, span));
  if (other !== undefined) return `its range ${rangeText(span)} overlaps module ${kept[other.owner]?.name ?? ''}'s data range ${rangeText(other.span)}`;
  return undefined;
}

/** The data ranges of the kept modules that pass their checks, with E_DATA_RANGE_INVALID for every one that does not. */
function dataRanges(rom: Rom, config: RomliftConfig, kept: readonly ModuleConfig[], rule: BorderRule, diagnostics: Diagnostic[]): readonly PlannedRange[] {
  const out: PlannedRange[] = [];
  kept.forEach((m, i) => {
    if (m.dataStart === undefined) return;
    const start = m.dataStart;
    const end = kept.find((k) => k.start > start)?.start ?? rom.end;
    const span = { start, end: Math.max(start, end) };
    const problem = rangeProblem(rom, kept, i, span, rule, config, out);
    if (problem === undefined) {
      out.push({ owner: i, span });
      return;
    }
    diagnostics.push(diagnostic(ModelCodes, 'E_DATA_RANGE_INVALID', `module ${m.name}'s data_start ${hexAddr(start)} cannot start a C data range: ${problem}`, { addr: start }));
  });
  return out;
}

/** The modules of `config` over `rom`, each start checked with core/layout's isLegalStart under `rule` (a CodeLayout is one). */
export function planModules(rom: Rom, config: RomliftConfig, rule: BorderRule): ModulesPlan {
  const diagnostics: Diagnostic[] = [];
  const ordered = orderedModules(rom, config, rule, diagnostics);
  const planned = dataRanges(rom, config, ordered, rule, diagnostics);
  // A data module starting at a range's start lies wholly inside it, and is dropped.
  const rangeOf = new Map(planned.map((r) => [r.owner, r.span] as const));
  const keptIndexes = ordered.map((_, i) => i).filter((i) => !planned.some((r) => r.span.start === ordered[i]?.start));
  const kept = keptIndexes.map((i) => ordered[i]).filter((m): m is ModuleConfig => m !== undefined);
  const boundaries = [...kept.map((m) => m.start), ...planned.map((r) => r.span.start), rom.end].sort(compareNumbers);
  const spans = kept.map((m) => ({ start: m.start, end: boundaries.find((b) => b > m.start) ?? rom.end }));
  const runAt = runAddresses(rom, config, spans, diagnostics);
  const modules = kept.map((m, i): Module => {
    const compilerId = m.compiler ?? config.build.compiler;
    const compiler = buildCompilerOf(compilerId);
    const run = runAt[i];
    const dataRange = rangeOf.get(keptIndexes[i] ?? -1);
    return {
      name: m.name,
      span: spans[i] ?? { start: m.start, end: rom.end },
      kind: m.kind,
      generated: m.generated,
      compiler: compilerId,
      cflags: [...(compiler?.flags ?? []), ...(m.cflags ?? [])],
      ...(m.library === undefined || m.version === undefined ? {} : { library: { name: m.library, version: m.version } }),
      ...(run === undefined ? {} : { runAt: run }),
      ...(dataRange === undefined ? {} : { dataRange }),
      chunks: { first: 0, count: 0 },
    };
  });
  return { modules, diagnostics };
}

/** One piece of the ROM's tiling: a module's text span (`part: 'text'`) or its C data range (`part: 'data'`). */
export interface ModulePiece {
  /** The index of its module in the modules given. */
  readonly module: number;
  readonly part: 'text' | 'data';
  readonly span: Span;
}

/** Every module's span and every data range, in ROM order: together they tile the ROM (planModules). */
export function modulePieces(modules: readonly Module[]): readonly ModulePiece[] {
  const pieces: ModulePiece[] = [];
  modules.forEach((m, module) => {
    pieces.push({ module, part: 'text', span: m.span });
    if (m.dataRange !== undefined) pieces.push({ module, part: 'data', span: m.dataRange });
  });
  return pieces.sort((a, b) => compareNumbers(a.span.start, b.span.start) || compareNumbers(a.module, b.module));
}

/** The index of the module whose data range holds load address `a`, or -1. */
export function dataRangeModuleAt(modules: readonly Module[], a: Addr): number {
  return modules.findIndex((m) => m.dataRange !== undefined && a >= m.dataRange.start && a < m.dataRange.end);
}

/** The modules that run from RAM (a runAt), the only ones the address maps below look at. */
export function relocatedModules(modules: readonly Module[]): readonly Module[] {
  return modules.filter((m) => m.runAt !== undefined);
}

/** Run address minus load address of a module or chunk: runAt - span.start, 0 outside runs_at. */
export function runOffsetOf(placed: { readonly span: { readonly start: Addr }; readonly runAt?: Addr }): number {
  return placed.runAt === undefined ? 0 : placed.runAt - placed.span.start;
}

/** The run address of a module's or chunk's first byte: its runAt inside a runs_at range, else its load address. */
export function runStartOf(placed: { readonly span: { readonly start: Addr }; readonly runAt?: Addr }): Addr {
  return placed.runAt ?? placed.span.start;
}

/** The load address of run address `run` inside `placed` (run - runOffsetOf). */
export function toLoad(placed: { readonly span: { readonly start: Addr }; readonly runAt?: Addr }, run: Addr): Addr {
  return run - runOffsetOf(placed);
}

/** Whether run address `a` lies in the run range of runs_at module `m`, [runAt, runAt + length); false outside runs_at. */
function inRunRange(m: Module, a: Addr): boolean {
  return m.runAt !== undefined && a >= m.runAt && a < m.runAt + (m.span.end - m.span.start);
}

/** The offset from load to run address at load address `a`: runAt - span.start inside a relocated module, else 0. */
export function runOffsetAt(relocated: readonly Module[], a: Addr): number {
  const m = relocated.find((x) => a >= x.span.start && a < x.span.end);
  return m === undefined ? 0 : runOffsetOf(m);
}

/** The load address of run address `a`: mapped back inside a relocated module's run range, else `a` itself. */
export function loadAddressOf(relocated: readonly Module[], a: Addr): Addr {
  const m = relocated.find((x) => inRunRange(x, a));
  return m === undefined ? a : toLoad(m, a);
}

/** The index of the module whose load span holds `a`, or -1. */
export function loadModuleAt(modules: readonly Module[], a: Addr): number {
  return spanIndexAt(modules, a, (m) => m.span);
}

/**
 * The index in `modules` (in ROM order) of the module run address `a` belongs to: the runs_at module whose run
 * range contains it, else the module whose load span contains it; -1 for none. Only `relocated`,
 * relocatedModules(modules), is searched for a run range; a caller asking for many addresses computes it once
 * (moduleAt in resolver.ts is the one-address form).
 */
export function moduleIndexAt(modules: readonly Module[], a: Addr, relocated: readonly Module[]): number {
  for (const m of relocated) if (inRunRange(m, a)) return modules.indexOf(m);
  return loadModuleAt(modules, a);
}
