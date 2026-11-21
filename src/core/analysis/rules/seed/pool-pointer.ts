// seed.pool-pointer (the PoC's pointerCandidates(), its pool list): the Thumb pointers in the literal
// pools of accepted functions that are not functions yet, once each, ascending. One snapshot per grow
// round; the driver judges each with the validity and accept slots. Inside a runs_at range (§6.7) a pool word names
// code by its run address, mapped to the load address it is loaded at (pointers.ts thumbPointerTarget).
import type { Addr } from '../../../../foundation/rom/span.ts';
import { sortedKeys } from '../../../../foundation/util/sorted.ts';
import { thumbPointerTarget } from '../../pointers.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'seed.pool-pointer',
    summary: 'Thumb pointers loaded from the pools of accepted functions are candidate functions',
    restsOn:
      'compiled code takes the address of a Thumb function as a pool word holding func+1 (callbacks, tables of handlers)',
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
        const target = thumbPointerTarget(v.rom, v.addresses, p.value);
        if (target !== undefined && !v.isFunction(target)) found.add(target);
      }
    }
    return sortedKeys(found);
  },
});
