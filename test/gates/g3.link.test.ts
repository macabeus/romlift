// g3.link (architecture §5, §13): the readable printer's tree links to the ROM's SHA-1 on every committed
// fixture (ci and real tiers) and on at least three of the six tuning ROMs (real tier; the target is all
// six, and the ROMs that do not link yet are recorded; D62).
//
// The checks run in process through romlift/node (verify-rom.ts, D108).
import { gate } from './gate.ts';
import { VERIFY_NEEDS, failedChecks, targets, verifyRom } from './verify-rom.ts';

const MIN_TUNING_LINKS = 3;

gate({
  id: 'g3.link',
  phase: 3,
  tier: 'both',
  inputs: ['toolchain'],
  realInputs: ['roms'],
  needs: [...VERIFY_NEEDS],
  async run(cx) {
    const fixtureNames = new Set(cx.fixtures.map((f) => f.name));
    const fixtureProblems: string[] = [];
    const linked: string[] = [];
    const unlinked: string[] = [];
    for (const target of await targets(cx)) {
      const result = await verifyRom(cx, target, { link: true });
      const failed = [...failedChecks(result, ['link'])];
      if (result.sha1 !== target.sha1) failed.push(`linked SHA-1 ${result.sha1 ?? 'none'}, expected ${target.sha1}`);
      const ok = failed.length === 0 && result.ok;
      if (fixtureNames.has(target.name)) {
        if (!ok) fixtureProblems.push(`${target.name}: ${failed.join('; ') || 'not ok'}`);
      } else if (ok) {
        linked.push(target.name);
      } else {
        unlinked.push(`${target.name}: ${failed.join('; ') || 'not ok'}`);
      }
    }
    if (fixtureProblems.length > 0)
      throw new Error(`the readable printer does not link every fixture: ${fixtureProblems.join(' | ')}`);
    cx.note(`the readable printer links all ${cx.fixtures.length} fixtures`);
    if (cx.tier === 'real') {
      if (unlinked.length > 0)
        cx.note(`tuning ROMs not linking yet (target all ${cx.datasets.length}): ${unlinked.join(' | ')}`);
      if (linked.length < MIN_TUNING_LINKS)
        throw new Error(
          `the readable printer links ${linked.length} of ${cx.datasets.length} tuning ROMs, at least ${MIN_TUNING_LINKS} must`,
        );
      cx.note(`the readable printer links ${linked.length} of ${cx.datasets.length} tuning ROMs: ${linked.join(', ')}`);
    }
  },
});
