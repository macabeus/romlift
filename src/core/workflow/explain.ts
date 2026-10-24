// The explain workflow (architecture §9.2, D35): what romlift decided about one address. On a bare ROM it
// runs the discover analysis once with trail 'full', keeping the events that touch a window of
// EXPLAIN_WINDOW bytes on each side of the address's bucket; the result then gives explainFilter (the
// 256-byte bucket widened to the extents that cover the address), and the kept events are filtered to
// it, which keeps exactly what a run filtered to it would. Only when a covering extent reaches outside
// the window is the analysis run a second time, filtered to explainFilter. explainAnalysis composes the
// claim, the owner, the events and the metadata of every rule they name. The report is composed by layer
// (D35): the analysis part (phase 2); the item and chunk (phase 3), from the model configFromDiscover and
// buildModel make of that same discover result (a trail changes no result, so no further analysis runs);
// the name of the function that holds the address and where that name comes from (phase 4: the TOML, with its
// `from` key, or the default spelling the analysis gives); the signature (phase 6) is added by the phase whose
// module produces it. Inside a project (phase 4) explainProject runs the analysis `generate` runs instead: the
// confirm run over the project's config, with the same trail window, and the model buildModel makes of it under
// that config, so it explains what `generate` emitted; another ROM than the config's is refused
// (E_ROM_SHA1_MISMATCH). An image that is not a cartridge is not modelled, so its report has no item, chunk or
// name. Pure.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { spanIndexAt } from '../../foundation/util/arrays.ts';
import { explainAnalysis, explainBucket, explainFilter } from '../analysis/explain.ts';
import type { AnalysisExplanation } from '../analysis/explain.ts';
import { RULES } from '../analysis/driver/rules.ts';
import { analyze } from '../analysis/driver/run.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { findItem, itemAt } from '../model/item-table.ts';
import { runOffsetOf } from '../model/modules.ts';
import { buildModel } from '../model/model.ts';
import type { ChunkKind, Item, Model, NameSource } from '../model/types.ts';
import type { CompilerProfile } from '../profile/types.ts';
import type { RuleMeta } from '../provenance/rule-id.ts';
import { trailKeeps } from '../provenance/trail.ts';
import type { TrailEvent } from '../provenance/trail.ts';
import type { SignatureRuleId } from '../signatures/schema.ts';
import { discover, profileOrDefault } from './discover.ts';
import { confirmOptions, discoverModel } from './generate.ts';
import { romSha1Problems } from '../config/rom-sha1.ts';
import type { DiscoverOptions } from './discover.ts';
import type { ProjectInputs } from './types.ts';

export type { AnalysisExplanation } from '../analysis/explain.ts';

/** The chunk an address lies in, as explain reports it (phase 3). */
export interface ExplainChunk {
  readonly name: string;
  readonly kind: ChunkKind;
  readonly module: string;
}

/** The name of the function holding an address (phase 4) and where it comes from. */
export interface ExplainName {
  readonly value: string;
  /** `toml`: the project's [functions] entry names it (its `from` key, when it has one); `default`: the analysis's default spelling. */
  readonly source: NameSource;
}

/**
 * The signature behind the function holding an address (phase 6, D93): read from its [functions] entry's `from` key
 * (`sig:<library>@<version>`), so explain never re-runs the matcher in a project; `rule` when the placement is known
 * (a bare ROM's matcher run).
 */
export interface ExplainSignature {
  readonly library: string;
  readonly version: string;
  readonly name: string;
  readonly rule?: SignatureRuleId;
}

/**
 * The explanation of one address (D35): its analysis part, from phase 3 its item and chunk, from phase 4 its function's
 * name, from phase 6 its signature.
 */
export type ExplainReport = AnalysisExplanation & {
  /** The model's item holding the address, decoded at its run address; absent outside the model. */
  readonly item?: Item;
  /** The chunk holding the address; absent outside the model. */
  readonly chunk?: ExplainChunk;
  /** The name of the innermost model function whose extent holds the address; absent when none does. */
  readonly name?: ExplainName;
  /** The signature that named that function; absent when no signature did (p6-proposals fills it). */
  readonly signature?: ExplainSignature;
};

export interface ExplainOptions {
  /** The compiler profile; default the discover profile. */
  readonly profile?: CompilerProfile;
}

/** The report and the diagnostics of the analysis it was built from (E_ROM_NOT_GBA, the analysis limits). */
export interface ExplainOutcome {
  readonly report: ExplainReport;
  readonly diagnostics: readonly Diagnostic[];
}

/** The metadata of every registered analysis rule. */
function ruleMetas(): readonly RuleMeta[] {
  return Object.values(RULES).map((rule) => rule.meta);
}

/** How far on each side of the address's bucket the single traced run keeps events. */
const EXPLAIN_WINDOW = 0x1_0000;

function within(inner: Span, outer: Span): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/** The item and chunk of `addr` in `model` (phase 3); nothing when no chunk holds it. */
export function modelPart(rom: Rom, model: Model, addr: Addr): { readonly item?: Item; readonly chunk?: ExplainChunk } {
  const chunk = model.chunks[spanIndexAt(model.chunks, addr, (k) => k.span)];
  if (chunk === undefined) return {};
  const part = { chunk: { name: chunk.name, kind: chunk.kind, module: chunk.module } };
  const i = findItem(model.items, addr);
  if (i < 0) return part;
  return { item: itemAt(model.items, i, rom, runOffsetOf(chunk)), ...part };
}

/**
 * The name part of `addr` (phase 4): the innermost function of `model` whose extent holds it (the latest entry
 * among those that do), its name and the name's source; nothing when no function's extent holds it.
 */
export function namePart(model: Pick<Model, 'functions'>, addr: Addr): { readonly name?: ExplainName } {
  let best: Model['functions'][number] | undefined;
  for (const f of model.functions) {
    if (f.extent.start <= addr && addr < f.extent.end && (best === undefined || f.entry > best.entry)) best = f;
  }
  return best === undefined ? {} : { name: { value: best.name, source: best.source.name } };
}

/** The report of `addr`: the analysis part over `events`, then the item, chunk and name of the run's model. */
function compose(rom: Rom, result: AnalysisResult, events: readonly TrailEvent[], addr: Addr, modelOf: (result: AnalysisResult) => Model): ExplainReport {
  const analysis = explainAnalysis(result, events, addr, ruleMetas());
  if (checkRom(rom.bytes).length > 0) return analysis;
  const model = modelOf(result);
  return { ...analysis, ...modelPart(rom, model, addr), ...namePart(model, addr) };
}

/** One traced analysis run: its result, its events going to `sink`'s event list. */
type TracedRun = (filter: Span, events: TrailEvent[]) => AnalysisResult;

/**
 * The traced run once over the window around `addr`, and a second time over explainFilter only when a covering
 * extent reaches outside the window (see the header); the report composes the model `modelOf` builds.
 */
function explainWith(rom: Rom, addr: Addr, run: TracedRun, modelOf: (result: AnalysisResult) => Model): ExplainOutcome {
  const bucket = explainBucket(addr);
  const window: Span = { start: Math.max(0, bucket.start - EXPLAIN_WINDOW), end: bucket.end + EXPLAIN_WINDOW };
  const kept: TrailEvent[] = [];
  const result = run(window, kept);
  const filter = explainFilter(addr, result);
  if (within(filter, window)) {
    const events = kept.filter((e) => trailKeeps('full', filter, e));
    return { report: compose(rom, result, events, addr, modelOf), diagnostics: result.diagnostics };
  }
  const events: TrailEvent[] = [];
  const wide = run(filter, events);
  return { report: compose(rom, wide, events, addr, modelOf), diagnostics: wide.diagnostics };
}

/** The explanation of `addr` on a bare ROM (the discover run) with the diagnostics of its analysis, for the CLI. */
export function explainOutcome(rom: Rom, addr: Addr, options: ExplainOptions = {}): ExplainOutcome {
  const base: DiscoverOptions = options.profile === undefined ? {} : { profile: options.profile };
  const run: TracedRun = (filter, events) => discover(rom, { ...base, trail: 'full', trailFilter: filter }, { event: (e) => events.push(e) });
  return explainWith(rom, addr, run, (result) => discoverModel(rom, result));
}

/**
 * The explanation of `addr` inside a project (architecture §9.2): the confirm run `generate` makes over the
 * project's config, traced as on a bare ROM, and the model of that run under the config. Refused (`ok: false`)
 * when the ROM is not the one the config records.
 */
export function explainProject(inputs: Pick<ProjectInputs, 'rom' | 'config' | 'profile'>, addr: Addr): ({ readonly ok: true } & ExplainOutcome) | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  const refused = romSha1Problems(inputs.rom, inputs.config);
  if (refused.length > 0) return { ok: false, diagnostics: refused };
  const { rom, config } = inputs;
  const profile = profileOrDefault(inputs.profile);
  const options = confirmOptions(config);
  const run: TracedRun = (filter, events) => {
    if (checkRom(rom.bytes).length > 0) return discover(rom, { profile, trail: 'full', trailFilter: filter }, { event: (e) => events.push(e) });
    return analyze(rom, profile, { ...options, trail: 'full', trailFilter: filter }, { event: (e) => events.push(e) });
  };
  return { ok: true, ...explainWith(rom, addr, run, (result) => buildModel(rom, result, config)) };
}

/** What the analysis decided about `addr` (architecture §9.2). */
export function explain(rom: Rom, addr: Addr, options: ExplainOptions = {}): ExplainReport {
  return explainOutcome(rom, addr, options).report;
}
