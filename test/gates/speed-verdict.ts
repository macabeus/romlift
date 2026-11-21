// g2.speed's verdict (architecture §8.4 "Speed", §13, D41, D76 b, D77 g), in one place: the gate calls it on the
// `bench speed --json` line and test/unit/gates/speed-verdict.test.ts tests it, so a bench that measures fewer runs
// than the owner's answer asks cannot pass, whatever its times (fix round 3, gate-honesty-a1-3).
//
// A report passes when its `runs.analysis` is ANALYSIS_RUNS, its calibration ratio is positive, and every tuning ROM
// is measured, over ANALYSIS_RUNS runs (`analysisRuns`), at most 1.5 x its baseline x the ratio. The limit and the run
// count are D76 b's: the median of nine serial runs per ROM, the ratchet and bench/baseline/speed.json unchanged.

export interface SpeedRomLine {
  readonly name: string;
  readonly analysisCpuMs: number;
  readonly analysisRuns?: number;
  readonly wallMs: number;
  readonly baselineCpuMs: number;
}

export interface SpeedLine {
  readonly schema: string;
  readonly runs?: { readonly analysis?: number };
  readonly calibration: { readonly cpuMs: number; readonly baselineCpuMs: number; readonly ratio: number };
  readonly roms: readonly SpeedRomLine[];
}

export const RATCHET = 1.5;
/** The serial runs behind each ROM's median (D76 b). */
export const ANALYSIS_RUNS = 9;

/** Why `speed` fails g2.speed for the tuning ROMs `datasets` (empty when it passes), and one note per measured ROM. */
export function speedVerdict(
  speed: SpeedLine,
  datasets: readonly string[],
): { readonly problems: readonly string[]; readonly notes: readonly string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  if (speed.schema !== 'romlift/bench-speed@1') problems.push(`bench speed printed schema '${String(speed.schema)}'`);
  if (speed.runs?.analysis !== ANALYSIS_RUNS)
    problems.push(
      `bench speed measured each ROM's analysis over ${String(speed.runs?.analysis)} runs, not ${ANALYSIS_RUNS} (D76 b)`,
    );
  const ratio = speed.calibration.ratio;
  if (!(ratio > 0)) problems.push(`the calibration ratio is ${ratio}`);
  for (const name of datasets) {
    const rom = speed.roms.find((r) => r.name === name);
    if (rom === undefined) {
      problems.push(`${name}: not measured`);
      continue;
    }
    if (rom.analysisRuns !== ANALYSIS_RUNS)
      problems.push(
        `${rom.name}: its median is of ${String(rom.analysisRuns)} measured runs, not ${ANALYSIS_RUNS} (D76 b)`,
      );
    const limit = RATCHET * rom.baselineCpuMs * ratio;
    if (!(rom.analysisCpuMs <= limit))
      problems.push(
        `${rom.name}: ${Math.round(rom.analysisCpuMs)} ms CPU > ${Math.round(limit)} ms (1.5 x ${Math.round(rom.baselineCpuMs)} x ${ratio.toFixed(3)})`,
      );
    notes.push(`${rom.name} ${Math.round(rom.analysisCpuMs)}/${Math.round(limit)} ms`);
  }
  return { problems, notes };
}
