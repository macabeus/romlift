// buildModel (architecture §3.4, §6.2, D9, D19, D46, D62): the ROM, its analysis (discover or confirm) and the
// config become the plain-data Model every writer, self-check and `model --json` reads. The config decides
// (modules, functions, names, symbols, overrides); the analysis says what the bytes are. The steps, each in its
// own file: the modules checked against the legal borders (modules.ts), the chunks (chunks.ts), the labels and
// their scopes (labels.ts), the names checked per module (names.ts), the symbols (symbols.ts), and the items
// that tile the ROM (items.ts). Pure: content problems are diagnostics, never throws.
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
import { codeLayout, factsByEntry, headerCoveredEntries, isLabelEntry, placeEntries } from '../layout/borders.ts';
import type { ListedEntry, PlacedEntry } from '../layout/borders.ts';
import { ModelCodes } from './codes.ts';
import type { ChunkPlan } from './chunks.ts';
import { planChunks } from './chunks.ts';
import { buildItems } from './items.ts';
import { segmentsOf } from './segments.ts';
import { buildLabels, codeRefs } from './labels.ts';
import { planModules, relocatedModules, runOffsetAt } from './modules.ts';
import { invalidNames, moduleNameProblems, nameCollisions, nameSourceOf } from './names.ts';
import type { DefinedName } from './names.ts';
import { modelSymbols, romSymbols } from './symbols.ts';
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

/** W_FUNCTION_OUTSIDE_ROM for every [functions] entry outside the ROM, W_OVERRIDE_OUTSIDE_ROM for every [[overrides]] range reaching outside it. */
function outsideTheRom(rom: Rom, config: RomliftConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [entry, f] of sortedEntries(config.functions)) {
    if (contains(rom, entry)) continue;
    out.push(diagnostic(ModelCodes, 'W_FUNCTION_OUTSIDE_ROM', `the [functions] entry ${hexAddr(entry)} (${f.name}) lies outside the ROM ${hexAddr(rom.base)}..${hexAddr(rom.end)}`, { addr: entry }));
  }
  for (const o of config.overrides) {
    if (contains(rom, o.start) && o.start + o.size <= rom.end) continue;
    const span = { start: o.start, end: o.start + o.size };
    out.push(diagnostic(ModelCodes, 'W_OVERRIDE_OUTSIDE_ROM', `the [[overrides]] range ${hexAddr(span.start)}..${hexAddr(span.end)} reaches outside the ROM ${hexAddr(rom.base)}..${hexAddr(rom.end)}; the part outside is ignored`, { span }));
  }
  return out;
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

/** The Model of `rom` under `config`, with the facts of `analysis` (a discover or confirm result). */
export function buildModel(rom: Rom, analysis: AnalysisResult, config: RomliftConfig): Model {
  const layout = codeLayout(rom, analysis);
  const planned = planModules(rom, config, { borders: layout.borders, dataStart: layout.dataStart });
  const modules = planned.modules;
  const relocated = relocatedModules(modules);

  const functions = new Map<Addr, FunctionConfig>(sortedEntries(config.functions).filter(([entry]) => contains(rom, entry)));
  const headerCovered = headerCoveredEntries(analysis.functions, layout.headerEnd);
  const listed: ListedEntry[] = sortedEntries(functions).map(([entry, f]) => ({ entry, label: isLabelEntry(entry, f.label, headerCovered), ...(f.size === undefined ? {} : { size: f.size }) }));
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
  const labelled = buildLabels({ rom, modules, relocated, chunks: chunkPlans, functions, symbols, segments, refs });

  const defined: DefinedName[] = [...labelled.labels];
  for (const [entry, f] of sortedEntries(functions)) {
    const label = labelled.functions.get(entry);
    if (label !== undefined) for (const alias of f.aliases) defined.push({ name: alias, addr: label.addr, scope: label.scope });
  }
  const collisions = nameCollisions(defined, modules);
  const named = [...sortedEntries(functions), ...sortedEntries(config.symbols)];
  const invalid = invalidNames(named.flatMap(([addr, n]) => [n.name, ...n.aliases].map((name) => ({ name, addr }))));

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
    };
  });
  const finished = modules.map((m, i): Module => {
    const first = chunkPlans.findIndex((c) => c.module === i);
    const count = chunkPlans.filter((c) => c.module === i).length;
    return { ...m, chunks: { first: first < 0 ? chunks.length : first, count } };
  });

  return {
    schema: 'romlift/model@1',
    rom: { sha1: rom.sha1, end: rom.end },
    build: { name: config.build.name },
    functions: modelFunctions(placed, functions, analysis, modules, relocated),
    chunks,
    modules: finished,
    items: built.items,
    labels: labelled.labels,
    symbols,
    unlisted: analysis.mode === 'confirm' ? analysis.unlisted : [],
    diagnostics: [...planned.diagnostics, ...moduleNameProblems(modules), ...collisions, ...invalid, ...built.diagnostics, ...outsideTheRom(rom, config), ...unplacedSymbols(labelled.unplaced)].sort(compareDiagnostics),
  };
}
