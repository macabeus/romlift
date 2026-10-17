// gap.arm-over-prologueless-thumb (the comparison at one forward-chain cursor): a Thumb reading that opens
// with a prologue wins; otherwise ARM wins unless it starts at the same address and its code ends within
// the Thumb extent.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'gap.arm-over-prologueless-thumb',
    summary: 'Thumb with a prologue wins the cursor; otherwise ARM wins unless it starts at the same entry and its code ends within the Thumb extent',
    restsOn: 'ARM words decode as plausible Thumb pairs, but a compiled Thumb function opens with push {.., lr} on a word boundary',
    recovers: '14-byte Thumb stubs read in front of ARM functions, and ARM heap, OAM and map routines lost to them',
    reads: ['rom', 'readings'],
    adds: [],
    origin: 'arm-gap-scan',
  },
  kind: 'gap-prefer',
  prefer(thumb, arm, v) {
    if (v.profile.idioms.isPrologue(v.rom, thumb.entry, 'thumb')) return 'thumb';
    return arm.entry === thumb.entry && arm.codeEnd <= thumb.end ? 'thumb' : 'arm';
  },
});
