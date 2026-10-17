// g2.poc-parity (architecture §4.5 milestone M1, §13): under the PoC's LIFO worklist and the epoch cache,
// the parity view of every tuning ROM in the gate's scope hashed to its digest in
// bench/baseline/poc-digests.json, the bench rows equalled the PoC baseline (bench/baseline/poc-2026-10-16.json)
// with no difference at all, and the lockstep of every family set followed the PoC's log. That run was
// recorded, before 'poc-lifo' was deleted, as the `parity` member of bench/results.json
// (romlift-bench/parity-evidence@1); this gate checks that committed evidence, ties it to the commit it
// names (an ancestor of HEAD, so the evidence was recorded on this branch's history), and is historical
// once phase 2 lands. Nothing re-runs the lockstep: the oracle that replayed the PoC's log was deleted in
// the fix round of phase 2 (D59).
//
// One check (poc-parity-check.ts `parityCheck`) decides both states: `run` before phase 2 lands and
// `historicalCheck` after, so `historical` is recorded only when the gate's own check passes on its scope
// (gate-honesty-r2-1). The scope is every tuning ROM but those the owner scoped out (SCOPED_OUT: tmc, by
// the answer to Q1, D61 c), each printed as not applicable.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gate, type GateContext } from './gate.ts';
import { LOCKSTEP_SETS, parityCheck, SCOPED_OUT, type ParityEvidence, type PocDigests } from './poc-parity-check.ts';

async function check(cx: GateContext): Promise<void> {
  const results = JSON.parse(await readFile(path.join(cx.repoRoot, 'bench', 'results.json'), 'utf8')) as { readonly parity?: ParityEvidence };
  const digests = JSON.parse(await readFile(path.join(cx.repoRoot, 'bench', 'baseline', 'poc-digests.json'), 'utf8')) as PocDigests;
  const e = results.parity;
  const ancestor = e === undefined ? false : (await cx.exec('git', ['merge-base', '--is-ancestor', e.commit, 'HEAD'], { cwd: cx.repoRoot })).code === 0;
  const outcome = parityCheck({ evidence: e, digests, tuning: cx.datasets.map((d) => d.name), scopedOut: SCOPED_OUT, ancestor });
  for (const line of outcome.notApplicable) cx.note(line);
  for (const name of Object.keys(outcome.digests)) cx.digest(`parity:${name}`, outcome.digests[name] ?? '');
  if (outcome.problems.length > 0) throw new Error(`PoC parity: ${outcome.problems.join('; ')}`);
  cx.note(
    `${outcome.judged.length} tuning ROMs (${outcome.judged.join(', ')}): parity digests equal the PoC's, rows equal the PoC baseline, ${LOCKSTEP_SETS.length} lockstep sets follow the log ` +
      `(committed evidence recorded at ${e?.commit.slice(0, 7) ?? '?'}${e?.dirty === true ? ' with uncommitted M1 wiring' : ''}, an ancestor of HEAD; not re-run)`,
  );
}

gate({
  id: 'g2.poc-parity',
  phase: 2,
  tier: 'real',
  inputs: [],
  historicalAfter: 2,
  needs: [],
  historicalCheck: check,
  run: check,
});
