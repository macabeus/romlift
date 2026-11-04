// The module proposals a project's config lacks (architecture §6.7, §7.3, D91, D95 b; architecture-1, architecture-2):
// the borders that make each hand-written runs_at range its own module (`update`), and the library modules of
// the signature regions placed in the code. One naming rule for both and for init's module inference
// (infer-modules.ts, where the names are spelled): a runs_at range's module is runsAtName(<run address>), a library's its
// library name, and a name already taken gets `_2`, `_3`, … (freeModuleName); the module that held a range resumes after it as
// `<that module>_<ENDADDR>` with its kind, library and version (resumedModule). Pure; the diagnostics are the workflow's
// (core/workflow/signature-layer.ts, update.ts), which reads the reasons returned here. core/layout imports no
// config: a module of the config is read as a ModuleAt, which core/config's ModuleConfig satisfies.
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { hex } from '../../foundation/util/hex.ts';
import { compareNumbers } from '../../foundation/util/sorted.ts';
import type { LayoutReason, LibraryRegion, ModuleProposal } from '../proposals/types.ts';
import type { CodeLayout } from './borders.ts';
import { freeModuleName, placeLibraries, runsAtName } from './infer-modules.ts';

/** A module of a config as the planning reads it (core/config's ModuleConfig is one). */
export interface ModuleAt {
  readonly name: string;
  readonly start: Addr;
  readonly kind: 'asm' | 'c' | 'data';
  readonly library?: string;
  readonly version?: string;
}

/** A hand-written runs_at range as the planning reads it (core/config's OverrideConfig with runsAt is one). */
export interface RunsAtOverride {
  readonly start: Addr;
  readonly size: number;
  readonly runsAt: Addr;
}

/** The module of `modules` (in link order) that holds `a`: the last one starting at or below it. */
export function moduleHolding(modules: readonly ModuleAt[], a: Addr): ModuleAt | undefined {
  let found: ModuleAt | undefined;
  for (const m of modules) if (m.start <= a) found = m;
  return found;
}

/** The module `holder` resuming at `at` after a range cut out of it: `<holder>_<AT>`, its kind, library and version. */
export function resumedModule(holder: ModuleAt, at: Addr, taken: Set<string>, reason: LayoutReason): ModuleProposal {
  return {
    kind: 'module',
    name: freeModuleName(`${holder.name}_${hex(at)}`, taken),
    start: at,
    moduleKind: holder.kind,
    ...(holder.library === undefined || holder.version === undefined ? {} : { library: { name: holder.library, version: holder.version } }),
    source: { kind: 'layout', reason },
  };
}

/** Why a runs_at range cannot be made its own module. */
export type RunsAtRefusal = { readonly kind: 'outside-rom' } | { readonly kind: 'c-module-inside'; readonly module: ModuleAt };

/** What planRunsAtBorders leaves: the border proposals, and the ranges it refuses. */
export interface RunsAtBorderPlan {
  readonly proposals: readonly ModuleProposal[];
  readonly refused: readonly { readonly span: Span; readonly why: RunsAtRefusal }[];
}

/**
 * The module proposals that make every runs_at range its own module: at a start that is no module start an `asm` module
 * runsAtName(<run address>), at an end that is neither a module start, nor the ROM end, nor another range's start the
 * module that held it resumed (resumedModule); ranges in start order, each judged against `modules` alone, so two
 * ranges in one module each split it once. A range outside the ROM, or one a `c` module starts strictly inside, is
 * refused.
 */
export function planRunsAtBorders(rom: { readonly base: Addr; readonly end: Addr }, modules: readonly ModuleAt[], overrides: readonly RunsAtOverride[]): RunsAtBorderPlan {
  const proposals: ModuleProposal[] = [];
  const refused: { readonly span: Span; readonly why: RunsAtRefusal }[] = [];
  const taken = new Set(modules.map((m) => m.name));
  const starts = new Set(modules.map((m) => m.start));
  const ranges = [...overrides].sort((a, b) => compareNumbers(a.start, b.start) || compareNumbers(a.size, b.size));
  const rangeStarts = new Set(ranges.map((o) => o.start));
  for (const o of ranges) {
    const span = { start: o.start, end: o.start + o.size };
    if (span.start < rom.base || span.end > rom.end || o.size <= 0) {
      refused.push({ span, why: { kind: 'outside-rom' } });
      continue;
    }
    const inner = modules.find((m) => m.kind === 'c' && m.start > span.start && m.start < span.end);
    if (inner !== undefined) {
      refused.push({ span, why: { kind: 'c-module-inside', module: inner } });
      continue;
    }
    if (!starts.has(span.start) && !proposals.some((p) => p.start === span.start)) {
      proposals.push({ kind: 'module', name: freeModuleName(runsAtName(o.runsAt), taken), start: span.start, moduleKind: 'asm', source: { kind: 'layout', reason: 'runs-at' } });
    }
    // A range ending where another starts leaves that border to the next range's own module.
    const holder = span.end < rom.end && !starts.has(span.end) && !rangeStarts.has(span.end) ? moduleHolding(modules, span.end) : undefined;
    if (holder !== undefined) proposals.push(resumedModule(holder, span.end, taken, 'runs-at'));
  }
  return { proposals, refused };
}

/** Why a library region takes no module of a project. */
export type LibraryModuleDrop = { readonly kind: 'no-legal-border' } | { readonly kind: 'module-inside'; readonly module: ModuleAt; readonly span: Span };

/** What planLibraryModules leaves. */
export interface LibraryModulePlan {
  readonly proposals: readonly ModuleProposal[];
  readonly dropped: readonly { readonly region: LibraryRegion; readonly why: LibraryModuleDrop }[];
  /** The starts of `proposed` (the runs_at borders) a library module replaces. */
  readonly replaces: readonly Addr[];
}

/**
 * The library modules a project lacks: each region placed in the code (placeLibraries over `layout`, cut around
 * `runsAt`) whose range no module of its library starts in becomes an `asm` module named by its library (freeModuleName)
 * at the range's start, and the module that held the range resumes after it unless a module already starts there
 * (resumedModule). A range a module of `modules` starts in or at cannot be proposed (only insertions are): it is
 * dropped with that module, as is a region with no legal border. `proposed` are module proposals already made (the
 * runs_at borders): a start one of them has is not proposed twice, and one resuming at a library range's start is
 * replaced by the library module (`replaces`).
 */
export function planLibraryModules(
  layout: CodeLayout,
  modules: readonly ModuleAt[],
  regions: readonly LibraryRegion[],
  runsAt: readonly Span[],
  romEnd: Addr,
  proposed: readonly ModuleProposal[] = [],
): LibraryModulePlan {
  const placed = placeLibraries(layout, regions, layout.startupEnd, layout.dataStart, runsAt);
  const taken = new Set([...modules.map((m) => m.name), ...proposed.map((p) => p.name)]);
  const starts = new Map<Addr, ModuleProposal>(proposed.map((p) => [p.start, p] as const));
  const out: ModuleProposal[] = [];
  const replaces: Addr[] = [];
  const dropped: { readonly region: LibraryRegion; readonly why: LibraryModuleDrop }[] = [];
  for (const p of placed) {
    if (p.dropped === 'outside-code') continue;
    if (p.dropped === 'no-legal-border') {
      dropped.push({ region: p.region, why: { kind: 'no-legal-border' } });
      continue;
    }
    const library = { name: p.region.library, version: p.region.version };
    for (const span of p.spans) {
      if (modules.some((m) => m.library === library.name && m.start >= span.start && m.start < span.end)) continue;
      const inside = modules.find((m) => m.start >= span.start && m.start < span.end);
      if (inside !== undefined) {
        dropped.push({ region: p.region, why: { kind: 'module-inside', module: inside, span } });
        continue;
      }
      const already = starts.get(span.start);
      if (already?.library?.name === library.name) continue;
      if (already !== undefined) replaces.push(span.start);
      const module: ModuleProposal = { kind: 'module', name: freeModuleName(library.name, taken), start: span.start, moduleKind: 'asm', library, source: { kind: 'layout', reason: 'asm-only' } };
      out.push(module);
      starts.set(span.start, module);
      const holder = moduleHolding(modules, span.start);
      if (holder === undefined || span.end >= romEnd || modules.some((m) => m.start === span.end) || starts.has(span.end)) continue;
      const resume = resumedModule(holder, span.end, taken, 'asm-only');
      out.push(resume);
      starts.set(span.end, resume);
    }
  }
  return { proposals: out.sort((a, b) => compareNumbers(a.start, b.start)), dropped, replaces };
}

/**
 * The regions of the code (below the first `data` module of `modules`) that no module of their library intersects: the
 * regions init's module inference could give no module (no legal border inside). Regions past the code end (tables)
 * are left out.
 */
export function regionsWithoutModule(modules: readonly ModuleAt[], regions: readonly LibraryRegion[]): readonly LibraryRegion[] {
  const dataStart = modules.find((m) => m.kind === 'data')?.start ?? Number.POSITIVE_INFINITY;
  const spans = modules.map((m, i) => ({ module: m, end: modules[i + 1]?.start ?? Number.POSITIVE_INFINITY }));
  return regions.filter((r) => r.span.start < dataStart && !spans.some((s) => s.module.library === r.library && s.module.start < r.span.end && r.span.start < s.end));
}
