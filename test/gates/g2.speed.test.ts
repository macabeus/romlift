// g2.speed (architecture §8.4 "Speed", §9.3, §13, D41): the median CPU time of the analysis of every
// tuning ROM is at most 1.5 times its time in bench/baseline/speed.json, scaled by the calibration ratio of
// this machine against the baseline's.
//
// The median is of nine serial runs per ROM (five until phase 4): the owner's answer to Q2 of phase-4.md,
// "Median of more runs" (option c, a gate change the owner authorised on 20 October 2026, D76 b). The limit
// (1.5 x baseline x calibration ratio) and bench/baseline/speed.json are unchanged, and the calibration stays the
// median of five. The gate requires each ROM's measured analysis samples (`analysisRuns`, the length of the sample
// list behind its median, and `runs.analysis`, the fewest of them) to be nine, so a bench that measured fewer cannot
// pass it (D77 g). The verdict is test/gates/speed-verdict.ts's, which a unit test holds (fix round 3, D78 e).
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- speed --json   exit 0; serial, one ROM at a time, a warm-up then the median of 9
//   (process.cpuUsage; the calibration a warm-up then the median of 5); the last stdout line is
//   {schema: 'romlift/bench-speed@1',
//    runs: {calibration: 5, analysis: 9, emission: 5},
//    calibration: {cpuMs, baselineCpuMs, ratio},       ratio = cpuMs / baselineCpuMs
//    roms: [{name, analysisCpuMs, budgetAnalysisCpuMs, analysisRuns, wallMs, baselineCpuMs}]}
import { gate, type ExecResult } from './gate.ts';
import { ANALYSIS_RUNS, speedVerdict, type SpeedLine } from './speed-verdict.ts';

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g2.speed',
  phase: 2,
  tier: 'real',
  inputs: ['roms'],
  needs: ['analyze'],
  async run(cx) {
    const run = await cx.npm('bench', ['speed', '--json']);
    if (run.code !== 0) throw new Error(`bench speed --json exited ${run.code}:\n${tail(run)}`);
    const speed = cx.lastJson<SpeedLine>(run.stdout);
    // The verdict is speed-verdict.ts's (D77 g; tested by test/unit/gates/speed-verdict.test.ts).
    const { problems, notes } = speedVerdict(speed, cx.datasets.map((d) => d.name));
    if (problems.length > 0) throw new Error(`speed: ${problems.join('; ')}`);
    cx.note(`median of ${ANALYSIS_RUNS} runs; calibration ratio ${speed.calibration.ratio.toFixed(3)}; CPU/limit: ${notes.join(', ')}`);
  },
});
