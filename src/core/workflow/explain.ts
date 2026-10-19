// The explain workflow (architecture §9.2, D35): what romlift decided about one address. On a bare ROM it
// runs the discover analysis once with trail 'full', keeping the events that touch a window of
// EXPLAIN_WINDOW bytes on each side of the address's bucket; the result then gives explainFilter (the
// 256-byte bucket widened to the extents that cover the address), and the kept events are filtered to
// it, which keeps exactly what a run filtered to it would. Only when a covering extent reaches outside
// the window is the analysis run a second time, filtered to explainFilter. explainAnalysis composes the
// claim, the owner, the events and the metadata of every rule they name. The report is composed by layer
// (D35): the analysis part (phase 2); the item and chunk (phase 3), from the model configFromDiscover and
// buildModel make of that same discover result (a trail changes no result, so no further analysis runs);
// the name (phase 4) and the signature (phase 6) are added by the phases whose modules produce them. An
// image that is not a cartridge is not modelled, so its report has no item and no chunk. Pure.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { spanIndexAt } from '../../foundation/util/arrays.ts';
import { explainAnalysis, explainBucket, explainFilter } from '../analysis/explain.ts';
import type { AnalysisExplanation } from '../analysis/explain.ts';
import { RULES } from '../analysis/driver/rules.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { findItem, itemAt } from '../model/item-table.ts';
import { runOffsetOf } from '../model/modules.ts';
import type { ChunkKind, Item, Model } from '../model/types.ts';
import type { CompilerProfile } from '../profile/types.ts';
import type { RuleMeta } from '../provenance/rule-id.ts';
import { trailKeeps } from '../provenance/trail.ts';
import type { TrailEvent } from '../provenance/trail.ts';
import { discover } from './discover.ts';
import { discoverModel } from './generate.ts';
import type { DiscoverOptions } from './discover.ts';

export type { AnalysisExplanation } from '../analysis/explain.ts';

/** The chunk an address lies in, as explain reports it (phase 3). */
export interface ExplainChunk {
  readonly name: string;
  readonly kind: ChunkKind;
  readonly module: string;
}

/** The explanation of one address (D35): its analysis part, and from phase 3 its item and chunk in the model. */
export type ExplainReport = AnalysisExplanation & {
  /** The model's item holding the address, decoded at its run address; absent outside the model. */
  readonly item?: Item;
  /** The chunk holding the address; absent outside the model. */
  readonly chunk?: ExplainChunk;
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

/** The report of `addr`: the analysis part over `events`, then the item and chunk of the discover run's model. */
function compose(rom: Rom, result: AnalysisResult, events: readonly TrailEvent[], addr: Addr): ExplainReport {
  const analysis = explainAnalysis(result, events, addr, ruleMetas());
  if (checkRom(rom.bytes).length > 0) return analysis;
  return { ...analysis, ...modelPart(rom, discoverModel(rom, result), addr) };
}

/** The explanation of `addr` with the diagnostics of its analysis, for the CLI. */
export function explainOutcome(rom: Rom, addr: Addr, options: ExplainOptions = {}): ExplainOutcome {
  const base: DiscoverOptions = options.profile === undefined ? {} : { profile: options.profile };
  const bucket = explainBucket(addr);
  const window: Span = { start: Math.max(0, bucket.start - EXPLAIN_WINDOW), end: bucket.end + EXPLAIN_WINDOW };
  const kept: TrailEvent[] = [];
  const result = discover(rom, { ...base, trail: 'full', trailFilter: window }, { event: (e) => kept.push(e) });
  const filter = explainFilter(addr, result);
  if (within(filter, window)) {
    const events = kept.filter((e) => trailKeeps('full', filter, e));
    return { report: compose(rom, result, events, addr), diagnostics: result.diagnostics };
  }
  const events: TrailEvent[] = [];
  const wide = discover(rom, { ...base, trail: 'full', trailFilter: filter }, { event: (e) => events.push(e) });
  return { report: compose(rom, wide, events, addr), diagnostics: wide.diagnostics };
}

/** What the analysis decided about `addr` (architecture §9.2). */
export function explain(rom: Rom, addr: Addr, options: ExplainOptions = {}): ExplainReport {
  return explainOutcome(rom, addr, options).report;
}
