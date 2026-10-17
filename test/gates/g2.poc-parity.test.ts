// g2.poc-parity (architecture §4.5 milestone M1, §13): with the PoC's LIFO worklist and the epoch cache,
// the parity view of every tuning ROM hashes to its digest in bench/baseline/poc-digests.json, and the
// bench rows equal the PoC baseline (bench/baseline/poc-2026-10-16.json) with no difference at all.
// Historical once phase 2 lands: 'poc-lifo' is deleted then, and the committed evidence stays.
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- run --json --worklist poc-lifo   exit 0; the last stdout line is romlift/bench-run@1;
//   --json writes no committed file (bench/timings.json only). Per tuning ROM in `roms[]` this gate reads
//     name
//     parity: {digest, expected}       sha256 of this run's parity view; the committed PoC digest
//     baselineRows: {diffs: [{kind, addr}]}   every row that differs from the PoC baseline, accepted or not
import { gate, type ExecResult } from './gate.ts';

interface BenchRunRom {
  readonly name: string;
  readonly parity: { readonly digest: string; readonly expected: string };
  readonly baselineRows: { readonly diffs: readonly { readonly kind: string; readonly addr: string }[] };
}

interface BenchRun {
  readonly schema: string;
  readonly roms: readonly BenchRunRom[];
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g2.poc-parity',
  phase: 2,
  tier: 'real',
  inputs: ['roms', 'elfs', 'poc'],
  historicalAfter: 2,
  needs: ['analyzeTuned', 'encodeAnalysis'],
  async run(cx) {
    const run = await cx.npm('bench', ['run', '--json', '--worklist', 'poc-lifo']);
    if (run.code !== 0) throw new Error(`bench run --json --worklist poc-lifo exited ${run.code}:\n${tail(run)}`);
    const result = cx.lastJson<BenchRun>(run.stdout);
    if (result.schema !== 'romlift/bench-run@1') throw new Error(`bench run printed schema '${String(result.schema)}'`);
    const problems: string[] = [];
    for (const dataset of cx.datasets) {
      const rom = result.roms.find((r) => r.name === dataset.name);
      if (rom === undefined) {
        problems.push(`${dataset.name}: not scored`);
        continue;
      }
      cx.digest(`parity:${rom.name}`, rom.parity.digest);
      if (rom.parity.digest !== rom.parity.expected) problems.push(`${rom.name}: parity digest ${rom.parity.digest}, the PoC's is ${rom.parity.expected}`);
      const diffs = rom.baselineRows.diffs;
      if (diffs.length > 0) problems.push(`${rom.name}: ${diffs.length} rows differ from the PoC baseline, first ${diffs.slice(0, 5).map((d) => `${d.kind} ${d.addr}`).join(', ')}`);
    }
    if (problems.length > 0) throw new Error(`PoC parity: ${problems.join('; ')}`);
    cx.note(`${cx.datasets.length} tuning ROMs: parity digests equal the PoC's, rows equal the PoC baseline`);
  },
});
