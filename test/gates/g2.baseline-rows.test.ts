// g2.baseline-rows (architecture §4.5 "What a row change may be", §13): the bench rows of every tuning ROM
// equal the PoC baseline except the improvements listed in bench/baseline/accepted-diffs.json, and no
// listed improvement is stale (one that no longer differs from the baseline fails). tmc, revealed after
// the baseline was pinned, is a benchmark row by the owner's answer to Q1 and Q2 (D61 d, "Keep tmc as
// 99.94%. It's a benchmark row that we can improve later"): its rows that the dataset lists with a category
// are accepted and printed, and its tp 8,631 of 8,636 is a floor (baseline-rows-verdict.ts); the record is
// bound to tmc's ROM and ELF, and fails as stale when tmc is not a tuning dataset or its PoC reference is
// not the PoC's own run of it (staleBenchmarkRows, as g2.poc-parity and g2.confirm-equals-discover do).
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
//   For a ROM the owner kept as a benchmark row (baseline-rows-verdict.ts BENCHMARK_ROWS: tmc, D61 d) it
//   also reads tp, elfFunctions, recall and misses[]/falseEntries[] ({addr, listed, category}).
import { type BaselineRowsInput, baselineRowsVerdict, staleBenchmarkRows } from './baseline-rows-verdict.ts';
import { type ExecResult, gate, noPocReference } from './gate.ts';

interface BenchRun {
  readonly schema: string;
  readonly roms: readonly BaselineRowsInput[];
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
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
    const problems: string[] = [
      ...staleBenchmarkRows(
        cx.datasets.map((d) => d.name),
        result.roms,
      ),
    ];
    const notes: string[] = [];
    for (const dataset of cx.datasets) {
      const rom = result.roms.find((r) => r.name === dataset.name);
      if (rom === undefined) {
        problems.push(`${dataset.name}: not scored`);
        continue;
      }
      const missing = noPocReference(rom);
      if (missing !== undefined) {
        problems.push(missing);
        continue;
      }
      const verdict = baselineRowsVerdict(rom, dataset);
      problems.push(...verdict.problems);
      notes.push(verdict.note);
    }
    if (problems.length > 0) throw new Error(`baseline rows: ${problems.join('; ')}`);
    cx.note(notes.join(', '));
  },
});
