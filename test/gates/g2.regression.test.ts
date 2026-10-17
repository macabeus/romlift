// g2.regression (architecture §8.5, §13): `bench regression` against the merge-base passes on the
// committed artifact and datasets: no fewer true positives, no new extent mismatch, no higher raw share, no
// lower readability share, and no `labels`/`untyped` row added without a `Bench-Exception:` trailer.
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- regression --json   exit 0 when it passes; the last stdout line is
//   {schema: 'romlift/bench-regression@1', ok, base, problems: [{kind, rom, detail}]}
import { gate, type ExecResult } from './gate.ts';

interface Regression {
  readonly schema: string;
  readonly ok: boolean;
  readonly base: string;
  readonly problems: readonly { readonly kind: string; readonly rom: string; readonly detail: string }[];
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g2.regression',
  phase: 2,
  tier: 'ci',
  needs: ['analyze', 'discover'],
  async run(cx) {
    const run = await cx.npm('bench', ['regression', '--json']);
    let report: Regression | undefined;
    try {
      report = cx.lastJson<Regression>(run.stdout);
    } catch {
      report = undefined;
    }
    if (report === undefined || report.schema !== 'romlift/bench-regression@1') {
      throw new Error(`bench regression --json exited ${run.code} without a report:\n${tail(run)}`);
    }
    if (report.problems.length > 0) {
      throw new Error(`regression against ${report.base}: ${report.problems.map((p) => `${p.rom} ${p.kind}: ${p.detail}`).join('; ')}`);
    }
    if (run.code !== 0 || !report.ok) throw new Error(`bench regression exited ${run.code} with ok ${String(report.ok)} and no problem listed`);
    cx.note(`no regression against ${report.base}`);
  },
});
