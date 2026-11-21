// g3.raw-link (architecture §5 "Raw printer", §13): the raw printer's tree links to the ROM's SHA-1 on
// every committed fixture (ci and real tiers) and on all six tuning ROMs (real tier; D60 kept every
// threshold for all six, D62).
//
// The checks run in process through romlift/node (verify-rom.ts, D108).
import { gate } from './gate.ts';
import { VERIFY_NEEDS, failedChecks, targets, verifyRom } from './verify-rom.ts';

gate({
  id: 'g3.raw-link',
  phase: 3,
  tier: 'both',
  inputs: ['toolchain'],
  realInputs: ['roms'],
  needs: [...VERIFY_NEEDS],
  async run(cx) {
    const problems: string[] = [];
    const list = await targets(cx);
    for (const target of list) {
      const result = await verifyRom(cx, target, { link: true, printer: 'raw' });
      const failed = [...failedChecks(result, ['link'])];
      if (result.sha1 !== target.sha1) failed.push(`linked SHA-1 ${result.sha1 ?? 'none'}, expected ${target.sha1}`);
      if (failed.length > 0 || !result.ok) problems.push(`${target.name}: ${failed.join('; ') || 'not ok'}`);
    }
    if (problems.length > 0) throw new Error(`the raw printer does not link: ${problems.join(' | ')}`);
    cx.note(
      `the raw printer links to the SHA-1 on ${list.length} ROMs (${cx.fixtures.length} fixtures${cx.tier === 'real' ? `, ${cx.datasets.length} tuning ROMs` : ''})`,
    );
  },
});
