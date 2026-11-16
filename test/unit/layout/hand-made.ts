// Hand-made analyses and configs for the layout and model tests (p3-model): a FunctionFact from its entry,
// extent and the few lists a test names, an AnalysisResult around facts with a chosen startup region, code
// end, claims and mode, and a RomliftConfig from modules and functions. The ROMs come from
// test/helpers/analysis.ts's romWith with code built by thumbAt/armAt; nothing here walks or analyses.
import type { Addr, Mode, Span } from '../../../src/foundation/rom/span.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import type { AnalysisResult, ClaimRun, Exit, FunctionFact, JumpTable, OverrideFact, Seed } from '../../../src/core/analysis/types.ts';
import type { FunctionConfig, ModuleConfig, OverrideConfig, RomliftConfig, SymbolConfig } from '../../../src/core/config/schema.ts';
import { BASE } from '../../helpers/analysis.ts';

export { BASE, romWith, words } from '../../helpers/analysis.ts';
export { thumbAt } from '../../helpers/thumb.ts';
export { armAt } from '../../helpers/arm.ts';

/** The first address past the cartridge header. */
export const HEADER_END = BASE + 0xc0;

export interface FactSpec {
  readonly entry: Addr;
  /** The extent's end. */
  readonly end: Addr;
  /** Default 'thumb'. */
  readonly mode?: Mode;
  /** Default: [entry, end) less the pools and tables. */
  readonly code?: readonly Span[];
  readonly pools?: readonly Addr[];
  readonly farPools?: readonly Addr[];
  readonly tables?: readonly JumpTable[];
  readonly dead?: readonly Span[];
  readonly holes?: readonly Span[];
  readonly exits?: readonly Exit[];
  readonly runAt?: Addr;
}

/** A FunctionFact; every list a test does not name is empty. */
export function fact(spec: FactSpec): FunctionFact {
  const code = spec.code ?? [{ start: spec.entry, end: Math.min(spec.end, ...(spec.pools ?? []), ...(spec.tables ?? []).map((t) => t.base)) }];
  return {
    entry: spec.entry,
    mode: spec.mode ?? 'thumb',
    ...(spec.runAt === undefined ? {} : { runAt: spec.runAt }),
    extent: { start: spec.entry, end: spec.end },
    codeEnd: Math.max(...code.map((s) => s.end)),
    code,
    dead: spec.dead ?? [],
    pools: spec.pools ?? [],
    farPools: spec.farPools ?? [],
    tables: spec.tables ?? [],
    calls: [],
    blVerdicts: [],
    exits: spec.exits ?? [],
    branchTargets: [],
    adrs: [],
    veneers: [],
    absorbed: [],
    holes: spec.holes ?? [],
    origin: 'call',
    accepted: { rule: 'seed.call', round: 0, cites: [] },
    also: [],
  };
}

export interface AnalysisSpec {
  readonly functions: readonly FunctionFact[];
  /** The end of the startup region; default HEADER_END (none). */
  readonly startupEnd?: Addr;
  /** Default: the largest extent end. */
  readonly codeEnd?: Addr;
  readonly claims?: readonly ClaimRun[];
  /** Confirm mode when seeds are given. */
  readonly seeds?: readonly Seed[];
  readonly overrides?: readonly OverrideFact[];
}

/** An analysis result over `rom` (discover mode unless seeds are given). */
export function analysisOf(rom: Rom, spec: AnalysisSpec): AnalysisResult {
  const functions = [...spec.functions].sort((a, b) => a.entry - b.entry);
  const common = {
    schema: 'romlift/analysis@1' as const,
    rom: { sha1: rom.sha1, end: rom.end },
    profile: 'agbcc',
    options: { mode: spec.seeds === undefined ? ('discover' as const) : ('confirm' as const), seeds: spec.seeds ?? [], overrides: spec.overrides ?? [], trail: 'off' as const },
    functions,
    claims: spec.claims ?? [],
    startup: { span: { start: BASE, end: spec.startupEnd ?? HEADER_END }, entries: [] },
    codeEnd: spec.codeEnd ?? Math.max(BASE, ...functions.map((f) => f.extent.end)),
    rejections: [],
    diagnostics: [],
  };
  return spec.seeds === undefined ? { ...common, mode: 'discover' } : { ...common, mode: 'confirm', unlisted: [], listedInvalid: [] };
}

export interface ConfigSpec {
  /** [name, start] or a whole module; kind default 'asm'. */
  readonly modules: readonly (readonly [string, Addr] | ModuleConfig)[];
  /** [entry, name] (Thumb) or [entry, a whole FunctionConfig]; `entryPoint: true` lists it in [entry_points] (D116). */
  readonly functions?: readonly (readonly [Addr, string | (Partial<FunctionConfig> & { readonly entryPoint?: true })])[];
  readonly symbols?: readonly (readonly [Addr, SymbolConfig])[];
  readonly overrides?: readonly OverrideConfig[];
  readonly compiler?: string;
}

/** The spec's functions (`entryPoints` false) or entry points (true), each with its defaults. */
function listedOf(spec: ConfigSpec, entryPoints: boolean): [Addr, FunctionConfig][] {
  return (spec.functions ?? []).flatMap(([entry, f]): [Addr, FunctionConfig][] => {
    const { entryPoint, ...given } = typeof f === 'string' ? { name: f, entryPoint: undefined } : f;
    if ((entryPoint === true) !== entryPoints) return [];
    return [[entry, { name: `sub_${entry.toString(16).toUpperCase().padStart(8, '0')}`, mode: 'thumb', aliases: [], ...given }]];
  });
}

/** A config of the given modules and functions; a function's name defaults to sub_<ADDR>, its mode to Thumb. */
export function configOf(spec: ConfigSpec): RomliftConfig {
  return {
    schema: 1,
    rom: { path: 'baserom.gba', sha1: 'test' },
    build: { name: 'test', compiler: spec.compiler ?? 'agbcc' },
    signatures: { enabled: false },
    modules: spec.modules.map((m): ModuleConfig => ('name' in m ? m : { name: m[0], start: m[1], kind: 'asm', generated: true })),
    functions: new Map(listedOf(spec, false)),
    entryPoints: new Map(listedOf(spec, true)),
    symbols: new Map(spec.symbols ?? []),
    overrides: spec.overrides ?? [],
  };
}

/** Every item of a model's table as [kind, start, length]: what the tiling tests compare. */
export function rows(items: { readonly count: number; readonly kind: Uint8Array; readonly start: Uint32Array; readonly length: Uint32Array }): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < items.count; i++) out.push([items.kind[i] ?? -1, items.start[i] ?? -1, items.length[i] ?? -1]);
  return out;
}

/** Whether the items tile [base, end) exactly, every byte once, in address order. */
export function tiles(items: { readonly count: number; readonly start: Uint32Array; readonly length: Uint32Array }, base: Addr, end: Addr): boolean {
  let at = base;
  for (let i = 0; i < items.count; i++) {
    if (items.start[i] !== at || (items.length[i] ?? 0) === 0) return false;
    at += items.length[i] ?? 0;
  }
  return at === end;
}
