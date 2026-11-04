// g3.text-layout (architecture §6.4, §13, D49): every file the emission stream produces, parsed back and
// laid out from its module start, reproduces the ROM range byte for byte, and every `.align` emits exactly
// its padding item; the paths check of the same pass (duplicates and case-folded collisions,
// E_PATH_CASE_COLLISION) passes too. On every committed fixture (ci and real tiers) and every tuning ROM,
// all six (real tier, D62).
//
// The checks run in process through romlift/node (verify-rom.ts, D108).
import { gate } from './gate.ts';
import { failedChecks, targets, VERIFY_NEEDS, verifyRom } from './verify-rom.ts';

gate({
  id: 'g3.text-layout',
  phase: 3,
  tier: 'both',
  realInputs: ['roms'],
  needs: [...VERIFY_NEEDS],
  async run(cx) {
    const problems: string[] = [];
    const list = await targets(cx);
    for (const target of list) {
      const result = await verifyRom(cx, target);
      const failed = failedChecks(result, ['text-layout', 'paths']);
      if (failed.length > 0 || !result.ok) problems.push(`${target.name}: ${failed.join('; ') || 'not ok'}`);
    }
    if (problems.length > 0) throw new Error(`text layout fails: ${problems.join(' | ')}`);
    cx.note(`the text-layout and paths checks pass on ${list.length} ROMs (${cx.fixtures.length} fixtures${cx.tier === 'real' ? `, ${cx.datasets.length} tuning ROMs` : ''})`);
  },
});
