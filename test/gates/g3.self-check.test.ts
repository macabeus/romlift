// g3.self-check (architecture §6.4, §13): the tiling (every byte in exactly one item), re-encode (every
// mnemonic round-trips) and module-size self-checks pass on every committed fixture (ci and real tiers)
// and on every tuning ROM, all six (real tier; every phase-3 threshold applies to all six, D60, D62).
//
// The checks run in process through romlift/node (verify-rom.ts, D108).
import { gate } from './gate.ts';
import { failedChecks, targets, VERIFY_NEEDS, verifyRom } from './verify-rom.ts';
import type { CheckId } from './verify-rom.ts';

const REQUIRED: readonly CheckId[] = ['tiling', 'reencode', 'module-size'];

gate({
  id: 'g3.self-check',
  phase: 3,
  tier: 'both',
  realInputs: ['roms'],
  needs: [...VERIFY_NEEDS],
  async run(cx) {
    const problems: string[] = [];
    const list = await targets(cx);
    for (const target of list) {
      const result = await verifyRom(cx, target);
      const failed = failedChecks(result, REQUIRED);
      if (failed.length > 0 || !result.ok) problems.push(`${target.name}: ${failed.join('; ') || 'not ok'}`);
    }
    if (problems.length > 0) throw new Error(`self-checks fail: ${problems.join(' | ')}`);
    cx.note(`tiling, re-encode and module-size pass on ${list.length} ROMs (${cx.fixtures.length} fixtures${cx.tier === 'real' ? `, ${cx.datasets.length} tuning ROMs` : ''})`);
  },
});
