// buildModel (architecture §3.4, §6.2, D9, D19, D46, D62): the ROM, its analysis (discover or confirm) and the
// config become the plain-data Model every writer, self-check and encodeModel reads. The config decides
// (modules, functions, names, symbols, overrides); the analysis says what the bytes are. The steps, each in its
// own file: the modules checked against the legal borders (modules.ts), the chunks (chunks.ts), the labels and
// their scopes (labels.ts), the names checked per module (names.ts), the symbols (symbols.ts), and the items
// that tile the ROM (items.ts). Pure: content problems are diagnostics, never throws.
//
// A C data range (modules.ts, §6.6) is laid out as a `data` module of its own name (layoutModules): its chunks are data
// chunks split at the [symbols] entries inside it, its labels data labels, global when anything references them (the
// C object defines them), and they lie in Model.chunks in ROM order, naming the module, outside Module.chunks.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { contains } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { compareCodeUnits, compareNumbers, sortedEntries } from '../../foundation/util/sorted.ts';
import { spanIndexAt } from '../../foundation/util/arrays.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import type { FunctionConfig, RomliftConfig } from '../config/schema.ts';
import { appliedOverrides, codeLayout, factsByEntry, headerCoveredEntries, isLabelEntry, placeEntries } from '../layout/borders.ts';
import type { ListedEntry, PlacedEntry } from '../layout/borders.ts';
import { ModelCodes } from './codes.ts';
import type { ChunkPlan } from './chunks.ts';
import { planChunks } from './chunks.ts';
import { buildItems } from './items.ts';
import { segmentsOf } from './segments.ts';
import { buildLabels, codeRefs } from './labels.ts';
import { sizedEntries } from './resolver.ts';
import { modulePieces, planModules, relocatedModules, runOffsetAt } from './modules.ts';
import { invalidNames, linkerNameCollisions, moduleNameProblems, nameCollisions, nameSourceOf, sectionNameCollisions } from './names.ts';
import type { DefinedName } from './names.ts';
import { inferSymbolExtents } from './extents.ts';
import { modelSymbols, romSymbols, withDefaultRamSymbols } from './symbols.ts';
import type { Chunk, Label, Model, ModelFunction, ModelSymbol, Module } from './types.ts';

/** Diagnostics by address (span start for a span), then code, then message. */
function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const at = (d: Diagnostic): number => d.addr ?? d.span?.start ?? -1;
  return compareNumbers(at(a), at(b)) || compareCodeUnits(a.code, b.code) || compareCodeUnits(a.message, b.message);
}

/** The index of the chunk containing load address `a`, or -1. */
function chunkIndexAt(chunks: readonly ChunkPlan[], a: Addr): number {
  return spanIndexAt(chunks, a, (c) => c.span);
}

/** Per chunk, the func labels of the listed entries inside it that do not start it (label entries, and the cartridge entry in the header). */
function innerLabelsOf(chunks: readonly ChunkPlan[], placed: readonly PlacedEntry[], functions: ReadonlyMap<Addr, Label>): Label[][] {
  const inner: Label[][] = chunks.map(() => []);
  for (const p of placed) {
    const i = chunkIndexAt(chunks, p.entry);
    const label = functions.get(p.entry);
    if (i < 0 || label === undefined || chunks[i]?.entry === p.entry) continue;
    inner[i]?.push(label);
  }
  for (const list of inner) list.sort((a, b) => compareNumbers(a.addr, b.addr) || compareCodeUnits(a.name, b.name));
  return inner;
}

/** The model's functions: every listed entry with its extent and where its name and extent came from. */
function modelFunctions(
  placed: readonly PlacedEntry[],
  functions: ReadonlyMap<Addr, FunctionConfig>,
  analysis: AnalysisResult,
  modules: readonly Module[],
  relocated: readonly Module[],
): ModelFunction[] {
  const facts = factsByEntry(analysis);
  const starts = placed.filter((p) => !p.label).map((p) => p.entry);
  let next = 0;
  return placed.flatMap((p): ModelFunction[] => {
    const config = functions.get(p.entry);
    if (config === undefined) return [];
    while (next < starts.length && (starts[next] ?? 0) <= p.entry) next++;
    const moduleEnd = modules.find((m) => p.entry >= m.span.start && p.entry < m.span.end)?.span.end ?? p.entry;
    const fact = facts.get(p.entry);
    const extentEnd = p.source === 'analysis' && fact !== undefined ? fact.extent.end : (p.end ?? Math.min(starts[next] ?? moduleEnd, moduleEnd));
    const offset = runOffsetAt(relocated, p.entry);
    const runAt = relocated.some((m) => p.entry >= m.span.start && p.entry < m.span.end) ? p.entry + offset : fact?.runAt;
    return [
      {
        entry: p.entry,
        extent: { start: p.source === 'analysis' && fact !== undefined ? fact.extent.start : p.entry, end: Math.max(extentEnd, p.entry) },
        mode: config.mode,
        name: config.name,
        aliases: [...config.aliases],
        ...(runAt === undefined ? {} : { runAt }),
        source: { name: nameSourceOf(p.entry, config), extent: p.source },
      },
    ];
  });
}

/**
 * Every listed entry, [functions] and [entry_points] together, by address. The same merge as core/config/schema.ts
 * listedEntries, which the model may not import (it reads the config module for types only).
 */
function listedEntries(config: RomliftConfig): ReadonlyMap<Addr, FunctionConfig> {
  const all: [Addr, FunctionConfig][] = sortedEntries(config.functions);
  for (const [addr, e] of sortedEntries(config.entryPoints)) if (!config.functions.has(addr)) all.push([addr, e]);
  return new Map(all.sort((a, b) => compareNumbers(a[0], b[0])));
}

/**
 * E_ENTRY_POINT_OUTSIDE for every [entry_points] entry no other listed entry's extent covers (D116): it would start no
 * file, yet lie in no function's file.
 */
function entryPointsOutside(rom: Rom, config: RomliftConfig, analysis: AnalysisResult): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [entry, e] of sortedEntries(config.entryPoints)) {
    if (!contains(rom, entry)) continue;
    const covered = analysis.functions.some((f) => f.entry !== entry && f.extent.start < entry && f.extent.end > entry);
    if (covered) continue;
    const below = analysis.functions.filter((f) => f.entry < entry && !config.entryPoints.has(f.entry)).at(-1);
    const near = below === undefined ? 'no function lies below it' : `the nearest function below it, ${hexAddr(below.entry)}, ends at ${hexAddr(below.extent.end)}`;
    out.push(
      diagnostic(
        ModelCodes,
        'E_ENTRY_POINT_OUTSIDE',
        `the [entry_points] entry ${hexAddr(entry)} (${e.name}) lies inside no function: ${near}; an entry point is a name inside a function's code, so list it in [functions] instead`,
        { addr: entry },
      ),
    );
  }
  return out;
}

/** W_FUNCTION_OUTSIDE_ROM for every [functions] or [entry_points] entry outside the ROM, W_OVERRIDE_OUTSIDE_ROM for every [[overrides]] range reaching outside it. */
function outsideTheRom(rom: Rom, config: RomliftConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [entry, f] of sortedEntries(listedEntries(config))) {
    if (contains(rom, entry)) continue;
    const table = config.entryPoints.has(entry) ? 'entry_points' : 'functions';
    out.push(diagnostic(ModelCodes, 'W_FUNCTION_OUTSIDE_ROM', `the [${table}] entry ${hexAddr(entry)} (${f.name}) lies outside the ROM ${hexAddr(rom.base)}..${hexAddr(rom.end)}`, { addr: entry }));
  }
  for (const o of config.overrides) {
    if (contains(rom, o.start) && o.start + o.size <= rom.end) continue;
    const span = { start: o.start, end: o.start + o.size };
    out.push(diagnostic(ModelCodes, 'W_OVERRIDE_OUTSIDE_ROM', `the [[overrides]] range ${hexAddr(span.start)}..${hexAddr(span.end)} reaches outside the ROM ${hexAddr(rom.base)}..${hexAddr(rom.end)}; the part outside is ignored`, { span }));
  }
  return out;
}

/**
 * W_OVERRIDE_IGNORED for every [[overrides]] entry without runs_at that nothing applied (fix round 5, correctness-b0-3):
 * derived from what core/layout reports was used, never from the override's kind: the overrides the analysis applied
 * (appliedOverrides: a data override's claim, a code override's seed that took its start, never one a confirm run only
 * reported as unlisted, correctness-o0-2) and the override of an
 * entry whose extent placeEntries gave (fix round 6, architecture-b1-2). What is left changes nothing, such as a code
 * override exactly over a function the [functions] list or another rule already starts. A range wholly outside the
 * ROM is W_OVERRIDE_OUTSIDE_ROM's alone.
 */
function ignoredOverrides(rom: Rom, config: RomliftConfig, placed: readonly PlacedEntry[], analysis: AnalysisResult): Diagnostic[] {
  // Each applied override (its own object, however many entries it gave an extent) answers for one [[overrides]]
  // entry of its kind, span and mode (fix round 7, architecture-b2-6): a data override, or a second code override, on
  // the span of an applied one is still ignored.
  const unmatched: NonNullable<PlacedEntry['override']>[] = [];
  for (const o of [...appliedOverrides(analysis), ...placed.flatMap((p) => (p.override === undefined ? [] : [p.override]))]) if (!unmatched.includes(o)) unmatched.push(o);
  const out: Diagnostic[] = [];
  for (const o of config.overrides) {
    if (o.runsAt !== undefined) continue;
    const span = { start: o.start, end: o.start + o.size };
    if (span.end <= rom.base || span.start >= rom.end) continue;
    const at = unmatched.findIndex((a) => a.kind === o.kind && a.mode === o.mode && a.span.start === span.start && a.span.end === span.end);
    if (at >= 0) {
      unmatched.splice(at, 1);
      continue;
    }
    const why = o.kind === 'data' ? 'the analysis claimed none of its bytes as data' : codeOverrideIgnoredWhy(o, config, analysis);
    out.push(diagnostic(ModelCodes, 'W_OVERRIDE_IGNORED', `the [[overrides]] range ${hexAddr(span.start)}..${hexAddr(span.end)} (kind = "${o.kind}") changes nothing: ${why}`, { span, addr: o.start }));
  }
  return out;
}

/**
 * Why a code override without runs_at changes nothing, the one reason that applies (phase-6 fix round 6,
 * correctness-o1-2): [functions] lists its start, so the override is redundant; a confirm run only reported its seed as
 * unlisted (W_UNLISTED_FUNCTION, D104 d), so listing the start is the fix, after which the override is redundant; another
 * rule already started a function there; or its seed added no function and it gave no listed entry its extent.
 */
function codeOverrideIgnoredWhy(o: RomliftConfig['overrides'][number], config: RomliftConfig, analysis: AnalysisResult): string {
  const at = hexAddr(o.start);
  if (config.functions.has(o.start)) return `a function already starts at ${at}: [functions] lists it, so the override is redundant and can be removed`;
  if (config.entryPoints.has(o.start)) return `an entry point already starts at ${at}: [entry_points] lists it, so the override is redundant and can be removed`;
  if (analysis.mode === 'confirm' && analysis.unlisted.some((u) => u.entry === o.start)) {
    return `[functions] does not list ${at}, and a confirm run takes only the listed functions, reporting what the seed finds as W_UNLISTED_FUNCTION; list it (\`romlift update\` proposes it), after which the override is redundant and can be removed`;
  }
  if (analysis.functions.some((f) => f.entry === o.start)) return `a function already starts at ${at}, found by another rule, so the override is redundant and can be removed`;
  return `its seed adds no function at ${at} (no ${o.mode ?? 'thumb'} instruction the analysis accepts starts there), and it gives no listed entry its extent`;
}

/** W_SYMBOL_UNPLACED for each [symbols] entry inside the ROM that no file can define. */
function unplacedSymbols(symbols: readonly ModelSymbol[]): Diagnostic[] {
  return symbols.map((s) =>
    diagnostic(
      ModelCodes,
      'W_SYMBOL_UNPLACED',
      `the [symbols] entry ${s.name} at ${hexAddr(s.addr)} lies inside an instruction, a pool word or a table entry, where no file can define it; words equal to its address print by another name or as values`,
      { addr: s.addr },
    ),
  );
}

/**
 * What the chunks, labels and items are laid out over: every module's span and every data range, in ROM order, a data
 * range as a `data` module of its owner's name and no data range of its own; with each piece's module index.
 */
function layoutModules(modules: readonly Module[]): { readonly pieces: readonly Module[]; readonly owner: readonly number[] } {
  const laid = modulePieces(modules).flatMap((p) => {
    const m = modules[p.module];
    if (m === undefined) return [];
    const piece: Module = p.part === 'text' ? m : { name: m.name, span: p.span, kind: 'data', generated: m.generated, compiler: m.compiler, cflags: m.cflags, chunks: { first: 0, count: 0 } };
    return [{ piece, owner: p.module }];
  });
  return { pieces: laid.map((l) => l.piece), owner: laid.map((l) => l.owner) };
}

/** The Model of `rom` under `config`, with the facts of `analysis` (a discover or confirm result). */
export function buildModel(rom: Rom, analysis: AnalysisResult, config: RomliftConfig): Model {
  const layout = codeLayout(rom, analysis);
  const planned = planModules(rom, config, layout);
  const { pieces, owner } = layoutModules(planned.modules);
  // Everything below lays out over the pieces; the Model's modules are planned.modules (finished, below).
  const modules = pieces;
  const relocated = relocatedModules(modules);

  const functions = new Map<Addr, FunctionConfig>(sortedEntries(listedEntries(config)).filter(([entry]) => contains(rom, entry)));
  const headerCovered = headerCoveredEntries(analysis.functions, layout.headerEnd);
  const listed: ListedEntry[] = sortedEntries(functions).map(([entry, f]) => ({ entry, label: isLabelEntry(entry, config.entryPoints.has(entry), headerCovered), ...(f.size === undefined ? {} : { size: f.size }) }));
  const placed = placeEntries(listed, analysis);
  const symbols = modelSymbols(config);
  const inRom = romSymbols(symbols, rom);

  const chunkPlans = planChunks({
    rom,
    modules,
    entries: placed.filter((p) => !p.label),
    functions,
    headerEnd: layout.headerEnd,
    startupEnd: layout.startupEnd,
    symbols: inRom,
  });
  const segments = segmentsOf(rom, analysis, layout.headerEnd);
  const refs = codeRefs(rom, segments, relocated);
  const modelFns = modelFunctions(placed, functions, analysis, planned.modules, relocated);
  const extents = inferSymbolExtents(rom, analysis, symbols, modelFns, relocated);
  const poolWords = segments.concrete.flatMap((s) => (s.kind === 'pool' ? [s.value] : []));
  const allSymbols = withDefaultRamSymbols(poolWords, extents.symbols, sizedEntries({ symbols: extents.symbols, functions: modelFns }), relocated);
  const labelled = buildLabels({ rom, modules, relocated, chunks: chunkPlans, functions, symbols: allSymbols, entries: sizedEntries({ symbols: allSymbols, functions: modelFns }), segments, refs });

  const defined: DefinedName[] = [...labelled.labels];
  for (const [entry, f] of sortedEntries(functions)) {
    const label = labelled.functions.get(entry);
    if (label !== undefined) for (const alias of f.aliases) defined.push({ name: alias, addr: label.addr, scope: label.scope });
  }
  const named = [...sortedEntries(functions), ...sortedEntries(config.symbols)];
  const configNames = named.flatMap(([addr, n]) => [n.name, ...n.aliases].map((name) => ({ name, addr })));
  const collisions = [...nameCollisions(defined, modules), ...linkerNameCollisions([...defined, ...configNames], modules)];
  const invalid = invalidNames(configNames);

  const runOffsets = chunkPlans.map((c) => runOffsetAt(relocated, c.span.start));
  const built = buildItems({ rom, chunks: chunkPlans, modules, segments, labels: labelled.labels, labelStarts: labelled.starts, runOffsets, refs });
  const inner = innerLabelsOf(chunkPlans, placed, labelled.functions);

  const chunks = chunkPlans.map((c, i): Chunk => {
    const offset = runOffsets[i] ?? 0;
    const relocatedChunk = relocated.some((m) => c.span.start >= m.span.start && c.span.start < m.span.end);
    return {
      span: c.span,
      kind: c.kind,
      name: c.name,
      mode: c.mode,
      module: modules[c.module]?.name ?? '',
      items: built.ranges[i] ?? { first: 0, count: 0 },
      innerLabels: inner[i] ?? [],
      ...(relocatedChunk ? { runAt: c.span.start + offset } : {}),
      ...(c.entry !== undefined && c.entry !== c.span.start ? { entry: c.entry } : {}),
    };
  });
  // A module's chunks are its text piece's; a data range's lie outside them (types.ts Module.dataRange).
  const finished = planned.modules.map((m, i): Module => {
    const piece = pieces.findIndex((p, k) => owner[k] === i && p.span.start === m.span.start);
    const first = chunkPlans.findIndex((c) => c.module === piece);
    const count = chunkPlans.filter((c) => c.module === piece).length;
    return { ...m, chunks: { first: first < 0 ? chunks.length : first, count } };
  });

  return {
    schema: 'romlift/model@1',
    rom: { sha1: rom.sha1, end: rom.end },
    build: { name: config.build.name },
    functions: modelFns,
    chunks,
    modules: finished,
    items: built.items,
    labels: labelled.labels,
    symbols: allSymbols,
    unlisted: analysis.mode === 'confirm' ? analysis.unlisted : [],
    diagnostics: [...planned.diagnostics, ...moduleNameProblems(planned.modules), ...sectionNameCollisions(planned.modules), ...collisions, ...invalid, ...built.diagnostics, ...outsideTheRom(rom, config), ...entryPointsOutside(rom, config, analysis), ...ignoredOverrides(rom, config, placed, analysis), ...unplacedSymbols(labelled.unplaced), ...extents.diagnostics].sort(compareDiagnostics),
  };
}
