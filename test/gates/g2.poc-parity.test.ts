// g2.poc-parity (architecture §4.5 milestone M1, §13): under the PoC's LIFO worklist and the epoch cache,
// the parity view of every tuning ROM hashed to its digest in bench/baseline/poc-digests.json, the bench
// rows equalled the PoC baseline (bench/baseline/poc-2026-10-16.json) with no difference at all, and the
// lockstep of every family set followed the PoC's log. That run was recorded, before 'poc-lifo' was
// deleted, as the `parity` member of bench/results.json (romlift-bench/parity-evidence@1); this gate
// checks that committed evidence, ties it to the commit it names (an ancestor of HEAD, so the evidence
// was recorded on this branch's history), and is historical once phase 2 lands. Nothing re-runs the
// lockstep: the oracle that replayed the PoC's log was deleted in the fix round of phase 2 (D59).
//
// Per tuning ROM in `parity.roms` it reads: digest and expected (the run's parity digest and the PoC's),
// rowDiffs (rows that differed from the PoC baseline), and lockstep[] ({set, queries, matched, skipped,
// parityDigest, divergence}) for the sets driver, walk+bl+claim, seed+valid+accept, gap+region and all.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gate } from './gate.ts';

interface LockstepSet {
  readonly set: string;
  readonly queries: number;
  readonly matched: number;
  readonly skipped: number;
  readonly parityDigest: string | null;
  readonly divergence: { readonly seq: number; readonly kind: string; readonly detail: string } | null;
}

interface Evidence {
  readonly schema: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly worklist: string;
  readonly pocSourceDigest: string;
  readonly roms: Readonly<Record<string, { readonly digest: string; readonly expected: string; readonly rowDiffs: number; readonly lockstep: readonly LockstepSet[] }>>;
}

const SETS = ['driver', 'walk+bl+claim', 'seed+valid+accept', 'gap+region', 'all'];

gate({
  id: 'g2.poc-parity',
  phase: 2,
  tier: 'real',
  inputs: [],
  historicalAfter: 2,
  needs: [],
  async run(cx) {
    const results = JSON.parse(await readFile(path.join(cx.repoRoot, 'bench', 'results.json'), 'utf8')) as { readonly parity?: Evidence };
    const digests = JSON.parse(await readFile(path.join(cx.repoRoot, 'bench', 'baseline', 'poc-digests.json'), 'utf8')) as { readonly pocSourceDigest: string; readonly roms: Readonly<Record<string, string>> };
    const e = results.parity;
    if (e === undefined) throw new Error('bench/results.json holds no parity evidence');
    if (e.schema !== 'romlift-bench/parity-evidence@1' || e.worklist !== 'poc-lifo') throw new Error(`the parity evidence is ${e.schema} under ${e.worklist}`);
    const problems: string[] = [];
    const ancestor = await cx.exec('git', ['merge-base', '--is-ancestor', e.commit, 'HEAD'], { cwd: cx.repoRoot });
    if (ancestor.code !== 0) problems.push(`the evidence names commit ${e.commit}, which is not an ancestor of HEAD`);
    if (e.pocSourceDigest !== digests.pocSourceDigest) problems.push(`the evidence pins PoC source ${e.pocSourceDigest}, poc-digests.json ${digests.pocSourceDigest}`);
    for (const dataset of cx.datasets) {
      const rom = e.roms[dataset.name];
      const want = digests.roms[dataset.name];
      if (rom === undefined || want === undefined) {
        problems.push(`${dataset.name}: no parity evidence or committed digest`);
        continue;
      }
      cx.digest(`parity:${dataset.name}`, rom.digest);
      if (rom.digest !== want || rom.expected !== want) problems.push(`${dataset.name}: parity digest ${rom.digest}, the PoC's is ${want}`);
      if (rom.rowDiffs !== 0) problems.push(`${dataset.name}: ${rom.rowDiffs} rows differed from the PoC baseline`);
      for (const name of SETS) {
        const s = rom.lockstep.find((l) => l.set === name);
        if (s === undefined) problems.push(`${dataset.name}: no lockstep ${name}`);
        else if (s.divergence !== null) problems.push(`${dataset.name}: lockstep ${name} diverges at seq ${s.divergence.seq} (${s.divergence.kind}): ${s.divergence.detail}`);
        else if (s.parityDigest !== want || s.matched + s.skipped !== s.queries) problems.push(`${dataset.name}: lockstep ${name} ends at ${s.parityDigest ?? 'none'} with ${s.matched} + ${s.skipped} of ${s.queries} records`);
      }
    }
    if (problems.length > 0) throw new Error(`PoC parity: ${problems.join('; ')}`);
    cx.note(
      `${cx.datasets.length} tuning ROMs: parity digests equal the PoC's, rows equal the PoC baseline, ${SETS.length} lockstep sets follow the log ` +
        `(committed evidence recorded at ${e.commit.slice(0, 7)}${e.dirty ? ' with uncommitted M1 wiring' : ''}, an ancestor of HEAD; not re-run)`,
    );
  },
});
