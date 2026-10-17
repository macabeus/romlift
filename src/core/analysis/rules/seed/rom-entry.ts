// seed.rom-entry (the PoC's run()): the cartridge starts with an ARM `b` over its header to the startup
// code; that word and its target are the first two functions, both ARM. A ROM that does not start with
// a `b` proposes nothing, and a target whose first ARM word is not wholly in the ROM (a truncated image)
// is not proposed: it would be a function with an empty extent.
import { decode } from '../../../../foundation/isa/decode.ts';
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'seed.rom-entry',
    summary: 'the ARM b at 0x08000000 and its target are ARM functions',
    restsOn: 'the BIOS enters the cartridge at 0x08000000 in ARM state, and the header opens with a b over itself to the startup code',
    recovers: 'the startup code, from which every other function is reached',
    reads: ['rom'],
    adds: ['candidates'],
    origin: 'rom-entry',
  },
  kind: 'seed',
  seeds(v) {
    const at = v.rom.base;
    if (!contains(v.rom, at, 4)) return [];
    const flow = decode('arm', u32(v.rom, at), at).flow;
    if (flow.kind !== 'branch') return [];
    const start = { entry: at, mode: 'arm' as const, cites: [at] };
    return contains(v.rom, flow.target, 4) ? [start, { entry: flow.target, mode: 'arm', cites: [at] }] : [start];
  },
});
