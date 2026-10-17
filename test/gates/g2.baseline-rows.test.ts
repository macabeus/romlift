// g2.baseline-rows (architecture §4.5 "What a row change may be", §13): the bench rows of every tuning ROM
// equal the PoC baseline except the improvements listed in bench/baseline/accepted-diffs.json, and no
// listed improvement is stale (one that no longer differs from the baseline fails).
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- run --json   exit 0; the last stdout line is romlift/bench-run@1; --json writes no
//   committed file. Per tuning ROM in `roms[]` this gate reads
//     name
//     baselineRows: {
//       diffs:         [{kind, addr}]   every row that differs from the PoC reference: bench/baseline/
//                                        poc-2026-10-16.json, or for a ROM revealed after it was pinned
//                                        the pinned PoC's own run of it (poc.source 'dump', D60)
//       unaccepted:    [{kind, addr}]   the diffs accepted-diffs.json does not list (a regression, or an unlisted change)
//       staleAccepted: [{kind, addr}]   listed improvements that no longer differ from the baseline
//     }
//   kind is one of 'miss-removed', 'false-entry-removed', 'extent-agrees' (improvements) or any other
//   name the bench gives a change.
import { gate, type ExecResult } from './gate.ts';

interface RowDiff {
  readonly kind: string;
  readonly addr: string;
}

interface BenchRunRom {
  readonly name: string;
  readonly poc?: { readonly tp: number; readonly source?: 'baseline' | 'dump' | 'none' };
  readonly baselineRows: { readonly diffs: readonly RowDiff[]; readonly unaccepted: readonly RowDiff[]; readonly staleAccepted: readonly RowDiff[] };
}

interface BenchRun {
  readonly schema: string;
  readonly roms: readonly BenchRunRom[];
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function rows(list: readonly RowDiff[]): string {
  return list.slice(0, 8).map((d) => `${d.kind} ${d.addr}`).join(', ');
}

gate({
  id: 'g2.baseline-rows',
  phase: 2,
  tier: 'real',
  inputs: ['roms', 'elfs'],
  needs: ['analyze', 'discover'],
  async run(cx) {
    const run = await cx.npm('bench', ['run', '--json']);
    if (run.code !== 0) throw new Error(`bench run --json exited ${run.code}:\n${tail(run)}`);
    const result = cx.lastJson<BenchRun>(run.stdout);
    if (result.schema !== 'romlift/bench-run@1') throw new Error(`bench run printed schema '${String(result.schema)}'`);
    const problems: string[] = [];
    const notes: string[] = [];
    for (const dataset of cx.datasets) {
      const rom = result.roms.find((r) => r.name === dataset.name);
      if (rom === undefined) {
        problems.push(`${dataset.name}: not scored`);
        continue;
      }
      if (rom.poc?.source === 'none') {
        problems.push(`${rom.name}: no PoC reference (no baseline row and no PoC dump): run npm run export-poc -- --mode scored`);
        continue;
      }
      const { diffs, unaccepted, staleAccepted } = rom.baselineRows;
      if (unaccepted.length > 0) problems.push(`${rom.name}: ${unaccepted.length} rows differ from the PoC baseline without an accepted diff: ${rows(unaccepted)}`);
      if (staleAccepted.length > 0) problems.push(`${rom.name}: ${staleAccepted.length} stale accepted diffs: ${rows(staleAccepted)}`);
      notes.push(`${rom.name} ${diffs.length} accepted improvements${rom.poc?.source === 'dump' ? " (against the PoC's own run: no pinned baseline row)" : ''}`);
    }
    if (problems.length > 0) throw new Error(`baseline rows: ${problems.join('; ')}`);
    cx.note(notes.join(', '));
  },
});
