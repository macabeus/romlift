// seed.startup-pointer (the PoC's run()): the ARM startup code reaches the Thumb program (main, the
// interrupt dispatcher) through Thumb pointers in its literal pools. For each accepted ARM function, in
// acceptance order, each pool value of its reading, in walk order, that is a Thumb pointer to a
// word-aligned ROM address is proposed as Thumb.
import type { Proposal } from '../../types.ts';
import { isThumbPointer } from '../../pointers.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'seed.startup-pointer',
    summary: 'Thumb pointers in the literal pools of the ARM startup functions are Thumb functions',
    restsOn: 'crt0 is ARM and enters the Thumb program with ldr rN, =func+1; bx rN',
    recovers: 'main and the other Thumb entry points the startup code names only through a pointer',
    reads: ['function-set', 'readings', 'rom'],
    adds: ['candidates'],
    origin: 'startup-pointer',
  },
  kind: 'seed',
  seeds(v) {
    const out: Proposal[] = [];
    for (const entry of v.functions()) {
      const r = v.accepted(entry);
      if (r === undefined || r.mode !== 'arm') continue;
      for (const p of r.pools) {
        if (isThumbPointer(v.rom, p.value)) out.push({ entry: p.value - 1, mode: 'thumb', cites: [p.addr, entry] });
      }
    }
    return out;
  },
});
