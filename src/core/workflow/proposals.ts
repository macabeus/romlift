// The proposal screen and the signature layer of `init` and `analyze --update` (architecture §7.3, §7.4, D9, D91 d,
// D93; roadmap 6.D). Signatures propose; the TOML decides: the only writers of their proposals are `init` (which folds
// them into the config it serialises) and `analyze --update` (which patches them in); `generate` never loads
// signatures (R3, g4.no-toml-write).
//
// checkProposals screens proposals, in order, against the discover analysis and, when there is one, the config. A
// proposal contradicts
//   - the analysis when it places a function where the analysis found a function of the other mode, or on bytes the
//     analysis claims as a pool, a table or data (its entry instruction), or a table over bytes it claims as code;
//   - the config when the config lists the address in the other mode, a [[overrides]] entry of kind "data" covers a
//     proposed function's entry, one of kind "code" overlaps a proposed table, or a module border it proposes lies
//     strictly inside a runs_at range (a library region would cut code that runs from RAM, §6.7);
//   - the config or an earlier kept proposal when it gives a name another address already has (a function, a symbol
//     or an alias of either), which the model would refuse (E_NAME_COLLISION).
// Each contradicting proposal is one W_EVIDENCE_CONFLICT warning at its address, naming both sides, and is dropped;
// every other proposal is kept unchanged, in its input order. A contradiction is reported, never resolved.
//
// signatureLayer runs the matcher on a discover result (matchSignatures, resolvePlacements, proposeFromSignatures)
// and screens its proposals; foldSignatures writes the kept ones into a config the way `init` does (the signature's
// name and `from`, `size` where it restores an extent, `label = true` for the entries that extent holds, tables as
// [symbols]); libraryModuleProposals gives `analyze --update` the library [[modules]] a project lacks. Pure.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import { hex, hexAddr } from '../../foundation/util/hex.ts';
import { defaultSpellingAddress } from '../../foundation/util/project-files.ts';
import { compareCodeUnits, compareNumbers, sortedEntries } from '../../foundation/util/sorted.ts';
import { Claim, claimName } from '../analysis/types.ts';
import type { AnalysisResult, ClaimKind, ClaimRun, FunctionFact } from '../analysis/types.ts';
import { applyProposals } from '../config/patch.ts';
import type { FunctionConfig, ModuleConfig, RomliftConfig } from '../config/schema.ts';
import { codeLayout } from '../layout/borders.ts';
import { placeLibraries } from '../layout/infer-modules.ts';
import type { LibraryRegion, Proposal, ProposalSource } from '../proposals/types.ts';
import { matchSignatures } from '../signatures/match.ts';
import { resolvePlacements } from '../signatures/resolve.ts';
import { proposeFromSignatures } from '../signatures/propose.ts';
import type { SignatureFile, SignaturePlacement } from '../signatures/schema.ts';
import { WorkflowCodes } from './codes.ts';
import type { CheckProposalsContext, ProposalCheck } from './types.ts';

// ---------------------------------------------------------------------------------------------------
// The screen.

/** The bytes the analysis claims as data a function cannot start on. */
const NOT_CODE: ReadonlySet<ClaimKind> = new Set<ClaimKind>([Claim.pool, Claim.table, Claim.data]);

/** Who made a proposal, as a contradiction names it. */
function sourceText(source: ProposalSource): string {
  switch (source.kind) {
    case 'signature':
      return `the signature ${source.library}@${source.version} (${source.rule})`;
    case 'analysis':
      return `the analysis (${source.rule})`;
    case 'layout':
      return `module inference (${source.reason})`;
  }
}

/** The address a proposal is about: its entry, symbol address, module start or override start. */
export function proposalAddr(p: Proposal): Addr {
  switch (p.kind) {
    case 'function':
    case 'symbol':
      return p.addr;
    case 'module':
      return p.start;
    case 'override':
      return p.span.start;
  }
}

/** What a proposal says, as a contradiction names it. */
function proposalText(p: Proposal): string {
  switch (p.kind) {
    case 'function':
      return `${p.name ?? 'a function'} as a ${p.mode} function at ${hexAddr(p.addr)}`;
    case 'symbol':
      return `the ${p.type === 'pointers' ? 'pointer table' : 'table'} ${p.name} at ${hexAddr(p.addr)}`;
    case 'module':
      return `the module ${p.name} at ${hexAddr(p.start)}`;
    case 'override':
      return `a ${p.overrideKind} override [${hexAddr(p.span.start)}, ${hexAddr(p.span.end)})`;
  }
}

/** The width of an entry instruction of `mode`. */
function insnWidth(mode: Mode): number {
  return mode === 'arm' ? 4 : 2;
}

/** The claim runs of `claims` (sorted, disjoint) that overlap `span`. */
function claimsOver(claims: readonly ClaimRun[], span: Span): readonly ClaimRun[] {
  const out: ClaimRun[] = [];
  for (let i = lowerBound(claims, span.start + 1, (c) => c.span.end); i < claims.length; i++) {
    const c = claims[i];
    if (c === undefined || c.span.start >= span.end) break;
    out.push(c);
  }
  return out;
}

/** The analysis function whose entry is `addr` (functions sorted by entry). */
function functionAt(functions: readonly FunctionFact[], addr: Addr): FunctionFact | undefined {
  const f = functions[lowerBound(functions, addr, (g) => g.entry)];
  return f?.entry === addr ? f : undefined;
}

/** One side a proposal contradicts: what it says, and where (for the diagnostic's span and cites). */
interface Contradiction {
  readonly text: string;
  readonly at?: Addr;
  readonly span?: Span;
}

/** What the discover analysis says against `p`. */
function againstAnalysis(p: Proposal, analysis: AnalysisResult): readonly Contradiction[] {
  if (p.kind === 'function') {
    const found = functionAt(analysis.functions, p.addr);
    if (found !== undefined && found.mode !== p.mode) {
      return [{ text: `the analysis found a ${found.mode} function there (${found.accepted.rule})`, at: found.entry, span: found.extent }];
    }
    const entry = { start: p.addr, end: p.addr + insnWidth(p.mode) };
    const data = claimsOver(analysis.claims, entry).find((c) => NOT_CODE.has(c.kind));
    if (data !== undefined) return [{ text: `the analysis claims [${hexAddr(data.span.start)}, ${hexAddr(data.span.end)}) as ${claimName(data.kind)}`, at: data.span.start, span: data.span }];
    return [];
  }
  if (p.kind === 'symbol') {
    const span = { start: p.addr, end: p.addr + Math.max(p.size ?? 1, 1) };
    const code = claimsOver(analysis.claims, span).find((c) => c.kind === Claim.code);
    if (code !== undefined) {
      const owner = code.owner === undefined ? '' : ` of the function at ${hexAddr(code.owner)}`;
      return [{ text: `the analysis claims [${hexAddr(code.span.start)}, ${hexAddr(code.span.end)}) as code${owner}`, at: code.owner ?? code.span.start, span: code.span }];
    }
  }
  return [];
}

/** Whether [a, b) and `span` overlap. */
function overlaps(a: Addr, b: Addr, span: Span): boolean {
  return a < span.end && span.start < b;
}

/** What the config says against `p`. */
function againstConfig(p: Proposal, config: RomliftConfig): readonly Contradiction[] {
  const out: Contradiction[] = [];
  if (p.kind === 'function') {
    const listed = config.functions.get(p.addr);
    if (listed !== undefined && listed.mode !== p.mode) out.push({ text: `romlift.toml lists ${listed.name} there as a ${listed.mode} function`, at: p.addr });
    for (const o of config.overrides) {
      const span = { start: o.start, end: o.start + o.size };
      if (o.kind === 'data' && p.addr >= span.start && p.addr < span.end) out.push({ text: `a data override of romlift.toml covers [${hexAddr(span.start)}, ${hexAddr(span.end)})`, at: o.start, span });
    }
  } else if (p.kind === 'symbol') {
    const end = p.addr + Math.max(p.size ?? 1, 1);
    for (const o of config.overrides) {
      const span = { start: o.start, end: o.start + o.size };
      if (o.kind === 'code' && overlaps(p.addr, end, span)) out.push({ text: `a code override of romlift.toml covers [${hexAddr(span.start)}, ${hexAddr(span.end)})`, at: o.start, span });
    }
  } else if (p.kind === 'module') {
    for (const o of config.overrides) {
      if (o.runsAt === undefined) continue;
      const span = { start: o.start, end: o.start + o.size };
      if (p.start > span.start && p.start < span.end) {
        out.push({ text: `it would cut the runs_at range [${hexAddr(span.start)}, ${hexAddr(span.end)}) of romlift.toml, which is its own module`, at: o.start, span });
      }
    }
  }
  return out;
}

/** The name a function or symbol proposal gives, when it gives one. */
function proposedName(p: Proposal): string | undefined {
  return p.kind === 'function' || p.kind === 'symbol' ? p.name : undefined;
}

/** Every name the config gives to an address: functions, symbols and their aliases. */
function configNames(config: RomliftConfig | undefined): Map<string, Addr> {
  const names = new Map<string, Addr>();
  if (config === undefined) return names;
  for (const [addr, f] of sortedEntries(config.functions)) for (const n of [f.name, ...f.aliases]) if (!names.has(n)) names.set(n, addr);
  for (const [addr, s] of sortedEntries(config.symbols)) for (const n of [s.name, ...s.aliases]) if (!names.has(n)) names.set(n, addr);
  return names;
}

/**
 * The screen (architecture §7.4, CheckProposals of types.ts): the proposals that contradict neither the analysis nor
 * the config, in their input order, and one W_EVIDENCE_CONFLICT per proposal that does (see the header).
 */
export function checkProposals(proposals: readonly Proposal[], cx: CheckProposalsContext): ProposalCheck {
  const kept: Proposal[] = [];
  const conflicts: Diagnostic[] = [];
  const names = configNames(cx.config);
  for (const p of proposals) {
    const addr = proposalAddr(p);
    const found: Contradiction[] = [...againstAnalysis(p, cx.analysis), ...(cx.config === undefined ? [] : againstConfig(p, cx.config))];
    const name = proposedName(p);
    const holder = name === undefined ? undefined : names.get(name);
    if (name !== undefined && holder !== undefined && holder !== addr) found.push({ text: `the name ${name} is already given to ${hexAddr(holder)}`, at: holder });
    if (found.length === 0) {
      kept.push(p);
      if (name !== undefined && holder === undefined) names.set(name, addr);
      continue;
    }
    const first = found[0];
    const cites = [addr, ...found.flatMap((c) => (c.at === undefined || c.at === addr ? [] : [c.at]))].filter((a, i, all) => all.indexOf(a) === i);
    const message = `${sourceText(p.source)} proposes ${proposalText(p)}, but ${found.map((c) => c.text).join('; and ')}; the proposal is dropped`;
    conflicts.push(diagnostic(WorkflowCodes, 'W_EVIDENCE_CONFLICT', message, { addr, ...(first?.span === undefined ? {} : { span: first.span }), cites }));
  }
  return { kept, conflicts };
}

// ---------------------------------------------------------------------------------------------------
// The signature layer.

/** What the signatures propose for a ROM, screened. */
export interface SignatureLayer {
  /** The kept proposals, in proposeFromSignatures' order (address, then kind, then name). */
  readonly proposals: readonly Proposal[];
  /**
   * The library regions of the settled placements (resolvePlacements) narrowed to the placements whose proposals
   * were kept (a region with none left goes), which module inference reads: a dropped proposal changes nothing.
   */
  readonly regions: readonly LibraryRegion[];
  /** The settled placements, with their sig.* rules. */
  readonly placements: readonly SignaturePlacement[];
  /** The matcher's and the resolver's diagnostics, then the screen's W_EVIDENCE_CONFLICT. */
  readonly diagnostics: readonly Diagnostic[];
}

/** The settled placements of `files` on `rom` (matchSignatures over the discover result, then resolvePlacements). */
export function placeSignatures(rom: Rom, analysis: AnalysisResult, files: readonly SignatureFile[]): ReturnType<typeof resolvePlacements> {
  return resolvePlacements(rom, matchSignatures(rom, analysis, files));
}

/**
 * The signature layer over a discover result: the placements of `files`, their proposals, screened against the
 * analysis and `config` when given (checkProposals). Empty when no file is given.
 */
export function signatureLayer(rom: Rom, analysis: AnalysisResult, files: readonly SignatureFile[], config?: RomliftConfig): SignatureLayer {
  if (files.length === 0) return { proposals: [], regions: [], placements: [], diagnostics: [] };
  const resolved = placeSignatures(rom, analysis, files);
  const screened = checkProposals(proposeFromSignatures(resolved, analysis), config === undefined ? { analysis } : { analysis, config });
  return { proposals: screened.kept, regions: keptRegions(resolved.regions, resolved.placements, screened.kept), placements: resolved.placements, diagnostics: [...resolved.diagnostics, ...screened.conflicts] };
}

/** Each region narrowed to the placements of its library whose proposals were kept; a region with none left goes. */
function keptRegions(regions: readonly LibraryRegion[], placements: readonly SignaturePlacement[], kept: readonly Proposal[]): readonly LibraryRegion[] {
  const at = new Set(kept.flatMap((p) => (p.source.kind === 'signature' && (p.kind === 'function' || p.kind === 'symbol') ? [`${p.source.library}:${String(p.addr)}`] : [])));
  return regions.flatMap((r) => {
    const inside = placements.filter((p) => p.library === r.library && p.addr >= r.span.start && p.addr < r.span.end && at.has(`${p.library}:${String(p.addr)}`));
    if (inside.length === 0) return [];
    const start = Math.min(...inside.map((p) => p.addr));
    const end = Math.max(...inside.map((p) => p.addr + p.size));
    return [{ ...r, span: { start, end } }];
  });
}

/** The libraries the kept proposals name, sorted by code unit: init's [signatures] libraries. */
export function librariesOf(proposals: readonly Proposal[]): readonly string[] {
  const out = new Set<string>();
  for (const p of proposals) if (p.source.kind === 'signature') out.add(p.source.library);
  return [...out].sort(compareCodeUnits);
}

/** The listed entries strictly inside [entry, entry + size), ascending. */
function entriesInside(functions: ReadonlyMap<Addr, FunctionConfig>, entry: Addr, size: number): readonly Addr[] {
  return sortedEntries(functions).flatMap(([a]) => (a > entry && a < entry + size ? [a] : []));
}

/**
 * The kept signature proposals folded into `config` as init writes them (architecture §7.3): every placed function
 * its [functions] entry with the signature's name, `from = "sig:<library>@<version>"` and, where the signature
 * restores an extent the analysis split, `size`; every listed entry inside that extent `label = true`; every table a
 * [symbols] entry with `size`, `type` and `from`. Modules are module inference's (InferModulesOptions.libraries).
 */
export function foldSignatures(config: RomliftConfig, proposals: readonly Proposal[]): RomliftConfig {
  const signed = proposals.filter((p) => (p.kind === 'function' || p.kind === 'symbol') && p.source.kind === 'signature');
  const applied = applyProposals(config, signed);
  const functions = new Map(applied.functions);
  for (const p of signed) {
    if (p.kind !== 'function' || p.size === undefined) continue;
    for (const inner of entriesInside(functions, p.addr, p.size)) {
      const entry = functions.get(inner);
      if (entry !== undefined && entry.label !== true) functions.set(inner, { ...entry, label: true });
    }
  }
  return { ...applied, functions: new Map(sortedEntries(functions)) };
}

/** Whether `name` is romlift's default spelling of `addr` (sub_, gUnk_, …): a name nobody gave. */
export function isDefaultName(name: string, addr: Addr): boolean {
  return defaultSpellingAddress(name) === addr;
}

/**
 * The proposals `analyze --update` takes from the signatures against a project's config: a function or symbol
 * proposal for an entry the config lists under another than its default name is left out (the TOML decides, and
 * `--write` renames only entries that still carry a default name, D9), and for each function kept that restores an
 * extent, a `label = true` proposal for every listed entry it holds (source the analysis's, so `from` is not written
 * there).
 */
export function updateProposals(config: RomliftConfig, analysis: AnalysisResult, proposals: readonly Proposal[]): readonly Proposal[] {
  const out: Proposal[] = [];
  for (const p of proposals) {
    if (p.kind === 'function') {
      const listed = config.functions.get(p.addr);
      if (listed !== undefined && !isDefaultName(listed.name, p.addr)) continue;
      out.push(p);
      if (p.size === undefined) continue;
      for (const inner of entriesInside(config.functions, p.addr, p.size)) {
        const entry = config.functions.get(inner);
        const fact = functionAt(analysis.functions, inner);
        if (entry === undefined || entry.label === true) continue;
        out.push({ kind: 'function', addr: inner, mode: entry.mode, label: true, source: { kind: 'analysis', rule: fact?.accepted.rule ?? 'seed.listed' } });
      }
    } else if (p.kind === 'symbol') {
      const listed = config.symbols.get(p.addr);
      if (listed !== undefined && !isDefaultName(listed.name, p.addr)) continue;
      out.push(p);
    } else {
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The library modules of a project (`analyze --update`).

type ModuleProposal = Extract<Proposal, { readonly kind: 'module' }>;

/** What libraryModuleProposals leaves: the module proposals and the notes of the regions that take none. */
export interface LibraryModules {
  readonly proposals: readonly ModuleProposal[];
  readonly notes: readonly Diagnostic[];
}

/** `base`, or `base_2`, `base_3`, … : the first name not in `taken`, which it then holds. */
export function freeModuleName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  taken.add(name);
  return name;
}

/** The module of `modules` (in link order) that holds `a`: the last one starting at or below it. */
export function moduleHolding(modules: readonly ModuleConfig[], a: Addr): ModuleConfig | undefined {
  let found: ModuleConfig | undefined;
  for (const m of modules) if (m.start <= a) found = m;
  return found;
}

function droppedRegion(region: LibraryRegion, why: string): Diagnostic {
  const at = `${region.library}@${region.version} [${hexAddr(region.span.start)}, ${hexAddr(region.span.end)})`;
  return diagnostic(WorkflowCodes, 'W_LIBRARY_MODULE_DROPPED', `the library region ${at} takes no module: ${why}`, { addr: region.span.start, span: region.span });
}

/**
 * The library [[modules]] a project lacks (architecture §7.3, `analyze --update`): each region of the signatures
 * placed in the code, shrunk to legal borders and cut around the config's runs_at ranges (placeLibraries over the
 * discover run's code layout), whose range no module of that library starts in, becomes an `asm` module named by its
 * library at the range's start, and the module that held the range resumes after it (`<module>_<ENDADDR>`, its kind,
 * library and version) unless a module already starts there. A range a module of the config starts in or at cannot be
 * proposed (planPatch inserts modules only): W_LIBRARY_MODULE_DROPPED, as for a region with no legal border.
 * `proposed` are the module proposals already made (the runs_at borders): a start one of them has is not proposed
 * twice, and one of them resuming at a library range's start is replaced by the library module (the returned
 * `replaces`).
 */
export function libraryModuleProposals(rom: Rom, analysis: AnalysisResult, config: RomliftConfig, regions: readonly LibraryRegion[], proposed: readonly ModuleProposal[] = []): LibraryModules & { readonly replaces: readonly Addr[] } {
  const layout = codeLayout(rom, analysis);
  const around = config.overrides.flatMap((o) => (o.runsAt === undefined ? [] : [{ start: o.start, end: o.start + o.size }]));
  const placed = placeLibraries(layout, regions, layout.startupEnd, layout.dataStart, around);
  const taken = new Set([...config.modules.map((m) => m.name), ...proposed.map((p) => p.name)]);
  const starts = new Map<Addr, ModuleProposal>(proposed.map((p) => [p.start, p] as const));
  const out: ModuleProposal[] = [];
  const replaces: Addr[] = [];
  const notes: Diagnostic[] = [];
  const source = { kind: 'layout', reason: 'asm-only' } as const;
  for (const p of placed) {
    if (p.dropped === 'outside-code') continue;
    if (p.dropped === 'no-legal-border') {
      notes.push(droppedRegion(p.region, 'no legal module border lies inside it'));
      continue;
    }
    const library = { name: p.region.library, version: p.region.version };
    for (const span of p.spans) {
      if (config.modules.some((m) => m.library === library.name && m.start >= span.start && m.start < span.end)) continue;
      const inside = config.modules.find((m) => m.start >= span.start && m.start < span.end);
      if (inside !== undefined) {
        notes.push(droppedRegion(p.region, `the module ${inside.name} of romlift.toml starts at ${hexAddr(inside.start)} in [${hexAddr(span.start)}, ${hexAddr(span.end)}), and analyze --update only inserts modules`));
        continue;
      }
      const already = starts.get(span.start);
      if (already?.library?.name === library.name) continue;
      if (already !== undefined) replaces.push(span.start);
      const resumed = moduleHolding(config.modules, span.start);
      const module: ModuleProposal = { kind: 'module', name: freeModuleName(library.name, taken), start: span.start, moduleKind: 'asm', library, source };
      out.push(module);
      starts.set(span.start, module);
      const resumesAt = span.end;
      if (resumed === undefined || resumesAt >= rom.end || config.modules.some((m) => m.start === resumesAt) || starts.has(resumesAt)) continue;
      const resume: ModuleProposal = {
        kind: 'module',
        name: freeModuleName(`${resumed.name}_${hex(resumesAt)}`, taken),
        start: resumesAt,
        moduleKind: resumed.kind,
        ...(resumed.library === undefined || resumed.version === undefined ? {} : { library: { name: resumed.library, version: resumed.version } }),
        source,
      };
      out.push(resume);
      starts.set(resumesAt, resume);
    }
  }
  return { proposals: out.sort((a, b) => compareNumbers(a.start, b.start)), notes, replaces };
}

/**
 * W_LIBRARY_MODULE_DROPPED for every region of the code (below the config's data module) that no module of its
 * library intersects in `config`: a region init's module inference could not give a module (no legal border inside
 * it). Regions past the code end (tables) are not noted.
 */
export function droppedRegionNotes(config: RomliftConfig, regions: readonly LibraryRegion[]): readonly Diagnostic[] {
  const dataStart = config.modules.find((m) => m.kind === 'data')?.start ?? Number.POSITIVE_INFINITY;
  const spans = config.modules.map((m, i) => ({ module: m, end: config.modules[i + 1]?.start ?? Number.POSITIVE_INFINITY }));
  return regions.flatMap((r) => {
    if (r.span.start >= dataStart) return [];
    const has = spans.some((s) => s.module.library === r.library && s.module.start < r.span.end && r.span.start < s.end);
    return has ? [] : [droppedRegion(r, 'no legal module border lies inside it')];
  });
}
