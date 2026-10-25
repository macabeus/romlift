// The signature layer of `init`, `analyze --update`, `explain --rom` and `signatures <rom>` (architecture §7.3, D9,
// D93, D95 b; roadmap 6.D; split out of proposals.ts, architecture-1). Signatures propose; the TOML decides: the only
// writers of their proposals are `init` (which folds them into the config it serialises) and `analyze --update` (which
// patches them in); `generate` never loads signatures (R3, g4.no-toml-write).
//
//   - signaturesOver / signaturesOnRom: the settled placements of the built files on a ROM (matchSignatures over its
//     discover result, then resolvePlacements), their library regions and their unscreened proposals. The one policy
//     for a discover result with an error: nothing is matched (architecture-4).
//   - signatureLayer: those proposals screened against the analysis and the config (proposals.ts checkProposals), and
//     the regions narrowed to the kept placements, which module inference reads.
//   - foldSignatures: the kept proposals written into a config as init writes them; librariesOf, init's [signatures]
//     libraries.
//   - updateProposals: the proposals analyze --update keeps (only entries that still carry a default name, D9).
//   - libraryModuleProposals, droppedRegionNotes: the library [[modules]] a project lacks, planned by core/layout
//     (module-proposals.ts), and the W_LIBRARY_MODULE_DROPPED notes of the regions that take none.
//   - signatureNotes: the shell's notes on the files it located (W_SIGNATURE_FILE_SKIPPED, W_SIGNATURES_ABSENT), kept
//     only by a run that uses signatures, which the workflow decides (`--no-signatures`, `[signatures] enabled`).
// Pure.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { defaultSpellingAddress } from '../../foundation/util/project-files.ts';
import { compareCodeUnits, sortedEntries } from '../../foundation/util/sorted.ts';
import { functionAt } from '../analysis/types.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { applyProposals } from '../config/patch.ts';
import type { FunctionConfig, RomliftConfig } from '../config/schema.ts';
import { codeLayout } from '../layout/borders.ts';
import { planLibraryModules, regionsWithoutModule } from '../layout/module-proposals.ts';
import { runsAtSpans } from '../model/modules.ts';
import type { LibraryRegion, ModuleProposal, Proposal } from '../proposals/types.ts';
import { matchSignatures } from '../signatures/match.ts';
import { proposeFromSignatures } from '../signatures/propose.ts';
import { resolvePlacements } from '../signatures/resolve.ts';
import type { SignatureFile, SignaturePlacement } from '../signatures/schema.ts';
import { WorkflowCodes } from './codes.ts';
import { discover } from './discover.ts';
import { checkProposals } from './proposals.ts';

// ---------------------------------------------------------------------------------------------------
// Placing the built files.

/** The settled placements of the built files on a ROM, their library regions and proposals (unscreened). */
export interface RomSignatures {
  readonly placements: readonly SignaturePlacement[];
  readonly regions: readonly LibraryRegion[];
  /** proposeFromSignatures over the placements: address, then kind, then name. */
  readonly proposals: readonly Proposal[];
  /** The matcher's and the resolver's diagnostics. */
  readonly diagnostics: readonly Diagnostic[];
}

const NOTHING: RomSignatures = { placements: [], regions: [], proposals: [], diagnostics: [] };

/** The settled placements of `files` on `rom` (matchSignatures over the discover result, then resolvePlacements). */
export function placeSignatures(rom: Rom, analysis: AnalysisResult, files: readonly SignatureFile[]): ReturnType<typeof resolvePlacements> {
  return resolvePlacements(rom, matchSignatures(rom, analysis, files));
}

/**
 * The signatures of `files` on `rom` over its discover result `analysis`: nothing when no file is given or the analysis
 * raised an error (an image that is not a cartridge has no code to match), else the settled placements, their regions
 * and proposals.
 */
export function signaturesOver(rom: Rom, analysis: AnalysisResult, files: readonly SignatureFile[]): RomSignatures {
  if (files.length === 0 || analysis.diagnostics.some((d) => d.severity === 'error')) return NOTHING;
  const resolved = placeSignatures(rom, analysis, files);
  return { placements: resolved.placements, regions: resolved.regions, proposals: proposeFromSignatures(resolved, analysis), diagnostics: resolved.diagnostics };
}

/** `signatures <rom>`: the discover run of `rom`, then signaturesOver; the analysis' diagnostics first. */
export function signaturesOnRom(rom: Rom, files: readonly SignatureFile[]): RomSignatures {
  const analysis = discover(rom);
  const found = signaturesOver(rom, analysis, files);
  return { ...found, diagnostics: [...analysis.diagnostics, ...found.diagnostics] };
}

/** The shell's notes on the files it located, kept when the run uses signatures (`used`), else dropped. */
export function signatureNotes(used: boolean, notes: readonly Diagnostic[] | undefined): readonly Diagnostic[] {
  return used ? (notes ?? []) : [];
}

// ---------------------------------------------------------------------------------------------------
// The screened layer.

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

/**
 * The signature layer over a discover result: the placements of `files` (signaturesOver), their proposals screened
 * against the analysis and `config` when given (checkProposals). Empty when no file is given or the analysis failed.
 */
export function signatureLayer(rom: Rom, analysis: AnalysisResult, files: readonly SignatureFile[], config?: RomliftConfig): SignatureLayer {
  const found = signaturesOver(rom, analysis, files);
  const screened = checkProposals(found.proposals, config === undefined ? { analysis } : { analysis, config });
  return { proposals: screened.kept, regions: keptRegions(found.regions, found.placements, screened.kept), placements: found.placements, diagnostics: [...found.diagnostics, ...screened.conflicts] };
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

// ---------------------------------------------------------------------------------------------------
// Folding into a config (init) and the update's proposals.

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

/** What libraryModuleProposals leaves: the module proposals and the notes of the regions that take none. */
export interface LibraryModules {
  readonly proposals: readonly ModuleProposal[];
  readonly notes: readonly Diagnostic[];
}

function droppedRegion(region: LibraryRegion, why: string): Diagnostic {
  const at = `${region.library}@${region.version} [${hexAddr(region.span.start)}, ${hexAddr(region.span.end)})`;
  return diagnostic(WorkflowCodes, 'W_LIBRARY_MODULE_DROPPED', `the library region ${at} takes no module: ${why}`, { addr: region.span.start, span: region.span });
}

const NO_LEGAL_BORDER = 'no legal module border lies inside it';

/**
 * The library [[modules]] a project lacks (architecture §7.3, `analyze --update`): core/layout's planLibraryModules over
 * the discover run's code layout, the config's modules and its runs_at ranges, with W_LIBRARY_MODULE_DROPPED for each
 * region that takes none. `proposed` are the module proposals already made (the runs_at borders); `replaces` the
 * starts of those a library module replaces.
 */
export function libraryModuleProposals(rom: Rom, analysis: AnalysisResult, config: RomliftConfig, regions: readonly LibraryRegion[], proposed: readonly ModuleProposal[] = []): LibraryModules & { readonly replaces: readonly Addr[] } {
  const plan = planLibraryModules(codeLayout(rom, analysis), config.modules, regions, runsAtSpans(config), rom.end, proposed);
  const notes = plan.dropped.map(({ region, why }) =>
    why.kind === 'no-legal-border'
      ? droppedRegion(region, NO_LEGAL_BORDER)
      : droppedRegion(region, `the module ${why.module.name} of romlift.toml starts at ${hexAddr(why.module.start)} in [${hexAddr(why.span.start)}, ${hexAddr(why.span.end)}), and analyze --update only inserts modules`),
  );
  return { proposals: plan.proposals, notes, replaces: plan.replaces };
}

/**
 * W_LIBRARY_MODULE_DROPPED for every region of the code (below the config's data module) that no module of its
 * library intersects in `config`: a region init's module inference could not give a module (no legal border inside
 * it). Regions past the code end (tables) are not noted.
 */
export function droppedRegionNotes(config: RomliftConfig, regions: readonly LibraryRegion[]): readonly Diagnostic[] {
  return regionsWithoutModule(config.modules, regions).map((r) => droppedRegion(r, NO_LEGAL_BORDER));
}
