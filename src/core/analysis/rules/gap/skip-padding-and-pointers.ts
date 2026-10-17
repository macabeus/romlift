// gap.skip-padding-and-pointers (the end of the PoC's forward chain): when nothing starts at the cursor,
// step one word over a zero word or a Thumb pointer into the ROM; any other word stops the chain.
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'gap.skip-padding-and-pointers',
    summary: 'the forward chain steps 4 bytes over a zero word or an odd word pointing into the ROM, and stops at anything else',
    restsOn: 'between compiled functions sit only alignment zeros and small tables of Thumb code pointers; other bytes are data',
    recovers: 'functions after padding or a callback table inside a gap, without walking through data that would chain false entries',
    reads: ['rom'],
    adds: [],
    origin: 'gap-scan',
  },
  kind: 'gap-skip',
  skip(c, v) {
    if (!contains(v.rom, c.at, 4)) return undefined;
    const w = u32(v.rom, c.at);
    if (w === 0 || ((w & 1) === 1 && contains(v.rom, w - 1))) return c.at + 4;
    return undefined;
  },
});
