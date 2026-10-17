// g1.provenance (architecture §8.6, §13): the provenance checks of `provenance.yml` run and agree with
// the committed artifact: the source digest, the gate record of landed phases, the families gated so far,
// a judged artifact row for every dataset row, and no row of a held-out dataset.
//
// FROZEN output: the last stdout line of `npm run bench -- provenance --json` (exit 0):
//   {ok, checks: [{id, ok, detail}]}, ids: source-digest, gate-record, families, dataset-rows, heldout-rows
import { gate, type ExecResult } from './gate.ts';

interface ProvenanceCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

interface Provenance {
  readonly ok: boolean;
  readonly checks: readonly ProvenanceCheck[];
}

const CHECK_IDS: readonly string[] = ['source-digest', 'gate-record', 'families', 'dataset-rows', 'heldout-rows'];

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g1.provenance',
  phase: 1,
  tier: 'ci',
  needs: ['sha256Stream'],
  async run(cx) {
    const run = await cx.npm('bench', ['provenance', '--json']);
    if (run.code !== 0) throw new Error(`bench provenance --json exited ${run.code}:\n${tail(run)}`);
    const report = cx.lastJson<Provenance>(run.stdout);
    const problems: string[] = [];
    for (const id of CHECK_IDS) {
      const check = report.checks.find((c) => c.id === id);
      if (check === undefined) problems.push(`${id}: not run`);
      else if (!check.ok) problems.push(`${id}: ${check.detail}`);
    }
    if (problems.length > 0) throw new Error(`bench provenance: ${problems.join('; ')}`);
    if (!report.ok) throw new Error('bench provenance reported ok false with every check passing');
    cx.note(report.checks.map((c) => `${c.id}: ${c.detail}`).join('; '));
  },
});
