// seed.pool-pointer (the PoC's pointerCandidates(), its pool list): the Thumb pointers in the literal
// pools of accepted functions that are not functions yet, once each, ascending. One snapshot per grow
// round; the driver judges each with the validity and accept slots.
import type { Addr } from '../../../../foundation/rom/span.ts';
import { sortedKeys } from '../../../../foundation/util/sorted.ts';
import { isThumbPointer } from '../../pointers.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'seed.pool-pointer',
    summary: 'Thumb pointers loaded from the pools of accepted functions are candidate functions',
    restsOn: 'compiled code takes the address of a Thumb function as a pool word holding func+1 (callbacks, tables of handlers)',
    recovers: 'functions reached only through a pointer that accepted code loads',
    reads: ['function-set', 'readings', 'rom'],
    adds: ['candidates'],
    origin: 'pool-pointer',
  },
  kind: 'harvest',
  harvest(v) {
    const found = new Set<Addr>();
    for (const entry of v.functions()) {
      const r = v.accepted(entry);
      if (r === undefined) continue;
      for (const p of r.pools) {
        if (isThumbPointer(v.rom, p.value) && !v.isFunction(p.value - 1)) found.add(p.value - 1);
      }
    }
    return sortedKeys(found);
  },
});
