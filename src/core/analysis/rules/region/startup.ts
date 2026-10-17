// region.startup (the PoC's `startup` getter): the cartridge entry, the code it branches to and what that
// code names with adr or reaches through a veneer, as long as those functions tile the ROM from its
// start (each within anchorSlack bytes of the previous end). Projects lay it out as one crt0 file and
// type its labels by their own convention, so it is one region, scored from its end. It claims nothing.
import type { Addr } from '../../../../foundation/rom/span.ts';
import type { Origin } from '../../../provenance/vocabulary.ts';
import type { StartupRegion } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

const STARTUP_ORIGINS: ReadonlySet<Origin> = new Set<Origin>(['rom-entry', 'adr', 'veneer']);

export default defineRule({
  meta: {
    id: 'region.startup',
    summary: 'functions of origin rom-entry, adr or veneer tiling the ROM from its start form the startup region, its end rounded up to 4',
    restsOn: 'crt0 is hand-written and linked first: the entry branch, the code after the header and the interrupt entry it names with adr',
    recovers: 'per-project label conventions inside crt0 (kleod types three, Emerald none) counted as false entries or misses',
    reads: ['function-set', 'readings'],
    adds: ['regions'],
  },
  kind: 'region',
  classify: () => [],
  startup(v): StartupRegion {
    const entries: Addr[] = [];
    let end: Addr = v.rom.base;
    for (const e of [...v.functions()].sort((a, b) => a - b)) {
      const f = v.owner(e);
      if (e > end + v.profile.anchorSlack || f?.entry !== e || !STARTUP_ORIGINS.has(f.origin)) break;
      entries.push(e);
      end = Math.max(end, f.extent.end);
    }
    return { span: { start: v.rom.base, end: (end + 3) & ~3 }, entries };
  },
});
