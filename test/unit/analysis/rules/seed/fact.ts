// A FunctionFact for the queue rules' tests: the reading's lists, with any field overridden.
import { provenance } from '../../../../../src/core/provenance/provenance.ts';
import type { FunctionFact, Reading } from '../../../../../src/core/analysis/types.ts';

export function factOf(r: Reading, extra: Partial<FunctionFact> = {}): FunctionFact {
  return {
    entry: r.entry,
    mode: r.mode,
    extent: { start: r.entry, end: r.end },
    codeEnd: r.codeEnd,
    code: [],
    dead: [],
    pools: [],
    farPools: [],
    tables: r.tables,
    calls: r.calls,
    blVerdicts: r.blVerdicts,
    exits: r.exits,
    branchTargets: r.branchTargets,
    adrs: r.adrs,
    veneers: r.veneers,
    absorbed: [],
    holes: r.holes,
    origin: 'call',
    accepted: provenance('seed.call', 0, [r.entry]),
    also: [],
    ...extra,
  };
}
