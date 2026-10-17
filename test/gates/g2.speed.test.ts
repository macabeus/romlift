// g2.speed (architecture §8.4 "Speed", §9.3, §13, D41): the median CPU time of the analysis of every
// tuning ROM is at most 1.5 times its time in bench/baseline/speed.json, scaled by the calibration ratio of
// this machine against the baseline's.
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- speed --json   exit 0; serial, one ROM at a time, a warm-up then the median of 5
//   (process.cpuUsage); the last stdout line is
//   {schema: 'romlift/bench-speed@1',
//    calibration: {cpuMs, baselineCpuMs, ratio},       ratio = cpuMs / baselineCpuMs
//    roms: [{name, analysisCpuMs, wallMs, baselineCpuMs}]}
import { gate, type ExecResult } from './gate.ts';

interface SpeedRom {
  readonly name: string;
  readonly analysisCpuMs: number;
  readonly wallMs: number;
  readonly baselineCpuMs: number;
}

interface Speed {
  readonly schema: string;
  readonly calibration: { readonly cpuMs: number; readonly baselineCpuMs: number; readonly ratio: number };
  readonly roms: readonly SpeedRom[];
}

const RATCHET = 1.5;

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
    const speed = cx.lastJson<Speed>(run.stdout);
    if (speed.schema !== 'romlift/bench-speed@1') throw new Error(`bench speed printed schema '${String(speed.schema)}'`);
    const ratio = speed.calibration.ratio;
    if (!(ratio > 0)) throw new Error(`the calibration ratio is ${ratio}`);
    const problems: string[] = [];
    const notes: string[] = [];
    for (const dataset of cx.datasets) {
      const rom = speed.roms.find((r) => r.name === dataset.name);
      if (rom === undefined) {
        problems.push(`${dataset.name}: not measured`);
        continue;
      }
      const limit = RATCHET * rom.baselineCpuMs * ratio;
      if (!(rom.analysisCpuMs <= limit)) problems.push(`${rom.name}: ${Math.round(rom.analysisCpuMs)} ms CPU > ${Math.round(limit)} ms (1.5 x ${Math.round(rom.baselineCpuMs)} x ${ratio.toFixed(3)})`);
      notes.push(`${rom.name} ${Math.round(rom.analysisCpuMs)}/${Math.round(limit)} ms`);
    }
    if (problems.length > 0) throw new Error(`speed: ${problems.join('; ')}`);
    cx.note(`calibration ratio ${ratio.toFixed(3)}; CPU/limit: ${notes.join(', ')}`);
  },
});
