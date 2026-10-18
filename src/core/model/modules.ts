// The model's modules (architecture §6.2, §6.7, D46, D47): the config's modules in link order, each spanning
// from its start to the next one's (the last to the ROM end), checked against the ROM's legal borders, with its
// build compiler resolved and the run address of a runs_at override. Their chunks are filled in by model.ts.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { buildCompilerOf } from '../config/compilers.ts';
import type { ModuleConfig, RomliftConfig } from '../config/schema.ts';
import { nearestBorders } from '../layout/borders.ts';
import { ModelCodes } from './codes.ts';
import { moduleIndexAt } from './resolver.ts';
import type { Module } from './types.ts';

export interface ModulesPlan {
  /** In link order, tiling the ROM; `chunks` is empty until the chunks are laid out. */
  readonly modules: readonly Module[];
  readonly diagnostics: readonly Diagnostic[];
}

/** The module a config with no usable module gets, so a model can still be built and its errors reported. */
const FALLBACK_NAME = 'main';

function describeBorders(borders: readonly Addr[], start: Addr): string {
  const { below, above } = nearestBorders(borders, start);
  const parts = [below === undefined ? undefined : `${hexAddr(below)} below`, above === undefined ? undefined : `${hexAddr(above)} above`].filter((p) => p !== undefined);
  return parts.length === 0 ? 'there is no legal border' : `the nearest legal borders are ${parts.join(' and ')}`;
}

/** The modules whose starts increase from the ROM base, with the diagnostics of every one left out or moved. */
function orderedModules(rom: Rom, config: RomliftConfig, borders: readonly Addr[], diagnostics: Diagnostic[]): ModuleConfig[] {
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
    if (!borders.includes(m.start)) {
      diagnostics.push(diagnostic(ModelCodes, 'E_MODULE_BORDER', `module ${m.name} starts at ${hexAddr(m.start)}, which is not a legal border: ${describeBorders(borders, m.start)}`, { addr: m.start, cites: Object.values(nearestBorders(borders, m.start)).filter((a): a is Addr => a !== undefined) }));
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

/** Every module spanning a runs_at override gets its run address; an override not bounded by module starts is E_OVERRIDE_INVALID. */
function runAddresses(rom: Rom, config: RomliftConfig, spans: readonly { readonly start: Addr; readonly end: Addr }[], diagnostics: Diagnostic[]): (Addr | undefined)[] {
  const runAt: (Addr | undefined)[] = spans.map(() => undefined);
  const isBorder = (a: Addr): boolean => a === rom.end || spans.some((s) => s.start === a);
  for (const o of config.overrides) {
    if (o.runsAt === undefined) continue;
    const end = o.start + o.size;
    if (!isBorder(o.start) || !isBorder(end)) {
      diagnostics.push(diagnostic(ModelCodes, 'E_OVERRIDE_INVALID', `the runs_at range [${hexAddr(o.start)}, ${hexAddr(end)}) does not start and end on module borders; a range that runs from RAM is its own module`, { span: { start: o.start, end }, addr: o.start }));
      continue;
    }
    spans.forEach((s, i) => {
      if (s.start >= o.start && s.start < end && runAt[i] === undefined && o.runsAt !== undefined) runAt[i] = o.runsAt + (s.start - o.start);
    });
  }
  return runAt;
}

/** The modules of `config` over `rom`, checked against the legal borders (ascending). */
export function planModules(rom: Rom, config: RomliftConfig, borders: readonly Addr[]): ModulesPlan {
  const diagnostics: Diagnostic[] = [];
  const kept = orderedModules(rom, config, borders, diagnostics);
  const spans = kept.map((m, i) => ({ start: m.start, end: kept[i + 1]?.start ?? rom.end }));
  const runAt = runAddresses(rom, config, spans, diagnostics);
  const modules = kept.map((m, i): Module => {
    const compilerId = m.compiler ?? config.build.compiler;
    const compiler = buildCompilerOf(compilerId);
    const run = runAt[i];
    return {
      name: m.name,
      span: spans[i] ?? { start: m.start, end: rom.end },
      kind: m.kind,
      generated: m.generated,
      compiler: compilerId,
      cflags: [...(compiler?.flags ?? []), ...(m.cflags ?? [])],
      ...(m.library === undefined || m.version === undefined ? {} : { library: { name: m.library, version: m.version } }),
      ...(run === undefined ? {} : { runAt: run }),
      chunks: { first: 0, count: 0 },
    };
  });
  return { modules, diagnostics };
}

/** The modules that run from RAM (a runAt), the only ones the address maps below look at. */
export function relocatedModules(modules: readonly Module[]): readonly Module[] {
  return modules.filter((m) => m.runAt !== undefined);
}

/** The offset from load to run address at load address `a`: runAt - span.start inside a relocated module, else 0. */
export function runOffsetAt(relocated: readonly Module[], a: Addr): number {
  const m = relocated.find((x) => a >= x.span.start && a < x.span.end);
  return m?.runAt === undefined ? 0 : m.runAt - m.span.start;
}

/** The load address of run address `a`: mapped back inside a relocated module's run range, else `a` itself. */
export function loadAddressOf(relocated: readonly Module[], a: Addr): Addr {
  const m = relocated.find((x) => x.runAt !== undefined && a >= x.runAt && a < x.runAt + (x.span.end - x.span.start));
  return m?.runAt === undefined ? a : m.span.start + (a - m.runAt);
}

/** The index of the module whose load span holds `a`, or -1. */
export function loadModuleAt(modules: readonly Module[], a: Addr): number {
  let lo = 0;
  let hi = modules.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const m = modules[mid] as Module;
    if (a < m.span.start) hi = mid - 1;
    else if (a >= m.span.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** The module a run address lies in (resolver.ts moduleIndexAt), searching only the relocated modules' run ranges first. */
export function runModuleAt(modules: readonly Module[], relocated: readonly Module[], a: Addr): number {
  return relocated.length === 0 ? loadModuleAt(modules, a) : moduleIndexAt(modules, a);
}
