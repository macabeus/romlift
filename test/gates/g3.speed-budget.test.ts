// g3.speed-budget (architecture §9.3, §13, D41): calibrated to this machine, the analysis of every tuning
// ROM takes at most 3 s of CPU, and on Emerald `generate` takes at most 10 s and the `init` equivalent at
// most 15 s (CPU, as the speed family gates). Every budget is multiplied by the calibration ratio.
//
// Expected output, for the phase-3 lead to align (architecture §8.5; the phase-3 extension of bench speed):
//   npm run bench -- speed --json   exit 0; the last stdout line is
//   {schema: 'romlift/bench-speed@1',
//    calibration: {cpuMs, baselineCpuMs, ratio},
//    roms: [{name, analysisCpuMs, wallMs, baselineCpuMs, generateCpuMs?, initCpuMs?}]}
//   generateCpuMs and initCpuMs are required for pokeemerald.
import { gate, type ExecResult } from './gate.ts';

interface SpeedRom {
  readonly name: string;
  readonly analysisCpuMs: number;
  readonly generateCpuMs?: number;
  readonly initCpuMs?: number;
}

interface Speed {
  readonly schema: string;
  readonly calibration: { readonly ratio: number };
  readonly roms: readonly SpeedRom[];
}

const ANALYSIS_MS = 3000;
const GENERATE_MS = 10000;
const INIT_MS = 15000;
const EMERALD = 'pokeemerald';

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g3.speed-budget',
  phase: 3,
  tier: 'real',
  inputs: ['roms'],
  needs: ['buildModel', 'emitTree', 'planWrites'],
  async run(cx) {
    const run = await cx.npm('bench', ['speed', '--json']);
    if (run.code !== 0) throw new Error(`bench speed --json exited ${run.code}:\n${tail(run)}`);
    const speed = cx.lastJson<Speed>(run.stdout);
    if (speed.schema !== 'romlift/bench-speed@1') throw new Error(`bench speed printed schema '${String(speed.schema)}'`);
    const ratio = speed.calibration.ratio;
    if (!(ratio > 0)) throw new Error(`the calibration ratio is ${ratio}`);
    const problems: string[] = [];
    const notes: string[] = [];
    const within = (label: string, value: number | undefined, budget: number): void => {
      const limit = budget * ratio;
      if (value === undefined) problems.push(`${label}: not measured`);
      else if (!(value <= limit)) problems.push(`${label}: ${Math.round(value)} ms CPU > ${Math.round(limit)} ms`);
      else notes.push(`${label} ${Math.round(value)}/${Math.round(limit)} ms`);
    };
    for (const dataset of cx.datasets) {
      const rom = speed.roms.find((r) => r.name === dataset.name);
      within(`${dataset.name} analysis`, rom?.analysisCpuMs, ANALYSIS_MS);
      if (dataset.name === EMERALD) {
        within(`${EMERALD} generate`, rom?.generateCpuMs, GENERATE_MS);
        within(`${EMERALD} init`, rom?.initCpuMs, INIT_MS);
      }
    }
    if (!cx.datasets.some((d) => d.name === EMERALD)) problems.push(`${EMERALD} is not a tuning dataset`);
    if (problems.length > 0) throw new Error(`speed budget: ${problems.join('; ')}`);
    cx.note(`calibration ratio ${ratio.toFixed(3)}; ${notes.join(', ')}`);
  },
});
