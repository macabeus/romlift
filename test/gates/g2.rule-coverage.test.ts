// g2.rule-coverage (architecture §13, §12 "overfit" mitigation, D7): every analysis rule is cited as
// decisive in at least one fixture trail, and disabling it changes at least one fixture outcome; a rule that
// does neither stays only when a decision record in docs/decisions.md names it (in backticks) together
// with `g2.rule-coverage` and says why.
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- ablate <rule> --tier synthetic --json   exit 0; the last stdout line is
//   {schema: 'romlift/bench-ablate@1', rule, tier: 'synthetic',
//    decisiveIn: [fixture names whose trail cites the rule as decisive],
//    changed:    [fixture names whose outcome (entries, extents, code end) moves with the rule disabled]}
// Rule ids come from `RULES` (romlift/internal, see g2.rule-registry).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type ExecResult, byCodeUnit, gate } from './gate.ts';

interface Ablation {
  readonly schema: string;
  readonly rule: string;
  readonly decisiveIn: readonly string[];
  readonly changed: readonly string[];
}

type Rules = Readonly<Record<string, unknown>>;


function tail(run: ExecResult, lines = 20): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** Rule ids exempted by a decision: a `## D<n>` section naming the id in backticks and this gate. */
function exemptions(decisions: string, ids: readonly string[]): ReadonlySet<string> {
  const sections = decisions.split(/^## /m).filter((section) => section.includes('g2.rule-coverage'));
  return new Set(ids.filter((id) => sections.some((section) => section.includes(`\`${id}\``))));
}

gate({
  id: 'g2.rule-coverage',
  phase: 2,
  tier: 'ci',
  needs: ['RULES', 'PROFILES', 'analyzeTuned'],
  async run(cx) {
    const ids = Object.keys(cx.need<Rules>('RULES')).sort(byCodeUnit);
    if (ids.length === 0) throw new Error('RULES is empty');
    if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    const exempt = exemptions(await readFile(path.join(cx.repoRoot, 'docs', 'decisions.md'), 'utf8'), ids);

    const uncovered: string[] = [];
    let covered = 0;
    for (const id of ids) {
      const run = await cx.npm('bench', ['ablate', id, '--tier', 'synthetic', '--json']);
      if (run.code !== 0) throw new Error(`bench ablate ${id} --tier synthetic --json exited ${run.code}:\n${tail(run)}`);
      const ablation = cx.lastJson<Ablation>(run.stdout);
      if (ablation.schema !== 'romlift/bench-ablate@1' || ablation.rule !== id) throw new Error(`bench ablate ${id} printed another schema or rule`);
      const decisive = ablation.decisiveIn.length > 0;
      const moves = ablation.changed.length > 0;
      if (decisive && moves) covered++;
      else if (!exempt.has(id)) uncovered.push(`${id} (${decisive ? 'decisive' : 'never decisive'}, ${moves ? 'moves an outcome' : 'moves nothing'})`);
    }
    if (uncovered.length > 0) throw new Error(`${uncovered.length} rules lack fixture coverage and a decision record: ${uncovered.join(', ')}`);
    cx.note(`${covered} of ${ids.length} rules decisive and load-bearing on ${cx.fixtures.length} fixtures; ${exempt.size} kept by a decision`);
  },
});
