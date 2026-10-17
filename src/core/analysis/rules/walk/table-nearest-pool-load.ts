// walk.table-nearest-pool-load: a Thumb `mov pc, rN` or `add pc, rN` is a jump table when one of the
// run's recent pc-relative loads names a word-aligned ROM address just ahead of the jump (the PoC's
// `mov_pc` branch of analyzeThumb). The look-behind window, the base distance, the entry cap and the
// target span are the profile's tableJump numbers, applied by its matchTableJump idiom: the nearest
// earlier load within lookBehindInsns whose pool value is in the ROM, 4-aligned and within
// (0, maxBaseDistance) bytes ahead of the jump; then up to maxEntries words from that base, stopping at
// the lowest target above the base, or at a target out of the ROM, odd, or further than maxTargetSpan from
// the jump. The table's targets are walked and the path ends. With no target the rule declines, and
// walk.mov-pc-without-table ends the path as a register jump. Replaced at milestone M3 by
// walk.table-by-register.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.table-nearest-pool-load',
    summary: 'Thumb mov/add pc after a pool load naming a base just ahead is a jump table: walk its targets',
    restsOn: 'agbcc lowers a dense switch to `ldr rB, =table; ...; ldr rN, [rB, rI]; mov pc, rN` with the table right after the jump',
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
