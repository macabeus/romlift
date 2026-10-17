// The explain workflow (architecture §9.2, D35): what romlift decided about one address. On a bare ROM it
// re-runs the discover analysis twice: a first run with the trail off finds the extents that cover the
// address, a second with trail 'full' keeps only the events touching explainFilter (the 256-byte bucket
// around the address widened to those extents), and explainAnalysis composes the claim, the owner, the
// events and the metadata of every rule they name. The report is composed by layer: phase 2 ships the
// analysis part only; the item and chunk (phase 3), the name (phase 4) and the signature (phase 6) are
// added by the phases whose modules produce them. Pure.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { explainAnalysis, explainFilter } from '../analysis/explain.ts';
import type { AnalysisExplanation } from '../analysis/explain.ts';
import { RULES } from '../analysis/driver/rules.ts';
import type { CompilerProfile } from '../profile/types.ts';
import type { RuleMeta } from '../provenance/rule-id.ts';
import type { TrailEvent } from '../provenance/trail.ts';
import { discover } from './discover.ts';
import type { DiscoverOptions } from './discover.ts';

export type { AnalysisExplanation } from '../analysis/explain.ts';

/** The explanation of one address: in phase 2, its analysis part (D35). */
export type ExplainReport = AnalysisExplanation;

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

/** The explanation of `addr` with the diagnostics of its analysis, for the CLI. */
export function explainOutcome(rom: Rom, addr: Addr, options: ExplainOptions = {}): ExplainOutcome {
  const base: DiscoverOptions = options.profile === undefined ? {} : { profile: options.profile };
  const first = discover(rom, base);
  const events: TrailEvent[] = [];
  const result = discover(rom, { ...base, trail: 'full', trailFilter: explainFilter(addr, first) }, { event: (e) => events.push(e) });
  return { report: explainAnalysis(result, events, addr, ruleMetas()), diagnostics: result.diagnostics };
}

/** What the analysis decided about `addr` (architecture §9.2). */
export function explain(rom: Rom, addr: Addr, options: ExplainOptions = {}): ExplainReport {
  return explainOutcome(rom, addr, options).report;
}
