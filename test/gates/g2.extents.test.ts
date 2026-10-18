// g2.extents (architecture §8.4 "Extents", §13; roadmap phase-2 thresholds): on every tuning ROM no
// function whose extent agreed with its ELF size in the PoC baseline stops agreeing, and at least 99.9% of
// the sized ELF functions the run found agree.
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- run --json   exit 0; the last stdout line is romlift/bench-run@1; --json writes no
//   committed file. Per tuning ROM in `roms[]` this gate reads
//     name
//     extents: {
//       sized       found functions whose ELF symbol has a size
//       agree       of those, the ones whose extent equals the ELF size (4-byte padding allowance)
//       mismatches: [{addr, elf, found}]
//       lost:       [{addr, elf, found}]   agreeing in the PoC reference (bench/baseline/poc-2026-10-16.json, or
//                                          the pinned PoC's own run of a ROM revealed after it, D60), not now
//     }
//     poc: {tp, source}   source 'none' (no PoC reference) fails: no vacuous `lost`
import { gate, noPocReference, type ExecResult } from './gate.ts';

interface ExtentRow {
  readonly addr: string;
  readonly elf: number;
  readonly found: number;
}

interface BenchRunRom {
  readonly name: string;
  readonly poc?: { readonly tp: number; readonly source?: 'baseline' | 'dump' | 'none' };
  readonly extents: { readonly sized: number; readonly agree: number; readonly mismatches: readonly ExtentRow[]; readonly lost: readonly ExtentRow[] };
}

interface BenchRun {
  readonly schema: string;
  readonly roms: readonly BenchRunRom[];
}

const MIN_SHARE = 0.999;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g2.extents',
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
      const missing = noPocReference(rom, ', so no lost extent can be judged');
      if (missing !== undefined) problems.push(missing);
      const { sized, agree, lost } = rom.extents;
      const share = sized === 0 ? 0 : agree / sized;
      if (share < MIN_SHARE) problems.push(`${rom.name}: ${agree}/${sized} sized extents agree (${(share * 100).toFixed(3)}%) < 99.9%`);
      if (lost.length > 0) problems.push(`${rom.name}: ${lost.length} extents stopped agreeing: ${lost.slice(0, 8).map((e) => `${e.addr} elf ${e.elf} found ${e.found}`).join(', ')}`);
      notes.push(`${rom.name} ${agree}/${sized} (${(share * 100).toFixed(3)}%${rom.poc?.source === 'dump' ? ", lost against the PoC's own run" : ''})`);
    }
    if (problems.length > 0) throw new Error(`extents: ${problems.join('; ')}`);
    cx.note(`agreeing extents: ${notes.join(', ')}`);
  },
});
