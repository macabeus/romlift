// walk.table-by-register (milestone M3, D12; the plan's "a jump table is found by tracking which register
// reaches mov pc"): a Thumb `mov pc, rN` or `add pc, rN` is a jump table when rN, followed back through
// the run's moves, adds and the word load of the table slot, comes from a pc-relative load whose word is a
// word-aligned ROM address just ahead of the jump. The profile's matchTableJump idiom does the tracking
// and reads the table with its tableJump numbers: the base within (0, maxBaseDistance) bytes ahead, then
// up to maxEntries words, stopping at the lowest target above the base, or at a target out of the ROM,
// odd, or further than maxTargetSpan from the jump. The table's targets are walked and the path ends.
// With no table the rule declines, and walk.mov-pc-without-table ends the path as a register jump. It
// replaces walk.table-nearest-pool-load, whose 40-instruction look-behind took the nearest qualifying
// load whatever register it set.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.table-by-register',
    summary: 'Thumb mov/add pc whose register comes from a pool load naming a base just ahead is a jump table: walk its targets',
    restsOn: 'agbcc lowers a dense switch to `ldr rB, =table; ...; add rI, rB; ldr rN, [rI]; mov pc, rN` with the table right after the jump, and may hoist other work between the load and the jump',
    recovers: 'switch cases unreached by the walk, and the table words decoded as instructions',
    reads: ['rom', 'readings'],
    adds: ['readings'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.mode !== 'thumb' || cursor.phase !== 'insn' || insn.flow.kind !== 'indirect') return undefined;
    if (insn.flow.via !== 'mov-pc' && insn.flow.via !== 'add-pc') return undefined;
    const run = cursor.run;
    const match = cursor.view.profile.idioms.matchTableJump(run, run.length - 1, cursor.view.rom);
    if (match === undefined) return undefined;
    return { step: 'table', table: { base: match.base, targets: match.targets, thumbBit: false } };
  },
});
