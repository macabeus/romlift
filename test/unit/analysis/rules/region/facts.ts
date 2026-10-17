// Function facts for the region rule tests: the fields a region rule reads (entry, extent, origin), the
// rest empty. Not a test file; the region tests import it.
import type { Addr } from '../../../../../src/foundation/rom/span.ts';
import type { Origin } from '../../../../../src/core/provenance/vocabulary.ts';
import type { FunctionFact } from '../../../../../src/core/analysis/types.ts';

export function fact(entry: Addr, end: Addr, origin: Origin): FunctionFact {
  return {
    entry,
    mode: 'thumb',
    extent: { start: entry, end },
    codeEnd: end,
    code: [{ start: entry, end }],
    dead: [],
    pools: [],
    farPools: [],
    tables: [],
    calls: [],
    blVerdicts: [],
    exits: [],
    branchTargets: [],
    adrs: [],
    veneers: [],
    absorbed: [],
    holes: [],
    origin,
    accepted: { rule: 'seed.call', round: 0, cites: [] },
    also: [],
  };
}

/** owner() over facts: the covering extent with the greatest start, as the driver's interval index. */
export function ownerOver(facts: readonly FunctionFact[]): (a: Addr) => FunctionFact | undefined {
  return (a) => facts.filter((f) => f.extent.start <= a && a < f.extent.end).sort((x, y) => y.extent.start - x.extent.start)[0];
}
