// g3.large-rom (architecture §9.4, §13, D42, D68 b, D69): on the deterministic 32 MiB synthetic ROM (fixture code
// tiled with seeded data), `init` and `generate` (in phase 3, their workflow equivalents) each run under the heap
// cap the `romlift` bin passes to Node (`--max-old-space-size=384`: the owner's answer to Q6, "384 MiB for bin and
// gate", which replaces Q2's 256), exit 0, and keep their peak RSS below the budget, set from the recorded runs under
// that cap with a stated margin (D69).
//
// The command (aligned by the phase-3 lead, D62): p3-generate writes bench/src/large-rom.ts on
// test/helpers/large-rom.ts, and p3-bench-scaffold registers `bench large-rom`:
//   npm run bench -- large-rom --json   exit 0; the last stdout line is
//   {schema: 'romlift/bench-large-rom@1', romBytes, sha1,
//    runs: [{command: 'init' | 'generate', exitCode, maxRssMiB, maxOldSpaceSizeMiB, treeDigest?}]}
//   each run is its own process; maxRssMiB is that process's peak resident set (process.resourceUsage), and
//   maxOldSpaceSizeMiB the --max-old-space-size of its own command line (null without one).
import { gate, type ExecResult } from './gate.ts';

interface LargeRomRun {
  readonly command: string;
  readonly exitCode: number;
  readonly maxRssMiB: number;
  readonly maxOldSpaceSizeMiB?: number | null;
  readonly treeDigest?: string;
  readonly detail?: string;
}

interface LargeRom {
  readonly schema: string;
  readonly romBytes: number;
  readonly sha1: string;
  readonly runs: readonly LargeRomRun[];
}

const ROM_BYTES = 32 * 1024 * 1024;
/**
 * The budget, set from the recorded runs of this ROM under the 384 MiB cap (D69 b): the largest peak, 866.5 MiB
 * (`init`), plus a 25% margin, rounded up to a multiple of 64 MiB (phase-3.md, "Measured numbers").
 */
const MAX_RSS_MIB = 1088;
/** The heap cap of the `romlift` bin (src/cli/main.ts's first line), which every measured run must run under. */
const HEAP_CAP_MIB = 384;
const COMMANDS: readonly string[] = ['init', 'generate'];

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g3.large-rom',
  phase: 3,
  tier: 'ci',
  needs: ['buildModel', 'emitTree', 'planWrites'],
  async run(cx) {
    const run = await cx.npm('bench', ['large-rom', '--json']);
    if (run.code !== 0) throw new Error(`bench large-rom --json exited ${run.code}:\n${tail(run)}`);
    const report = cx.lastJson<LargeRom>(run.stdout);
    if (report.schema !== 'romlift/bench-large-rom@1') throw new Error(`bench large-rom printed schema '${String(report.schema)}'`);
    if (report.romBytes !== ROM_BYTES) throw new Error(`the synthetic ROM has ${report.romBytes} bytes, expected ${ROM_BYTES}`);
    cx.digest('large-rom', report.sha1);
    const problems: string[] = [];
    for (const command of COMMANDS) {
      const measured = report.runs.find((r) => r.command === command);
      if (measured === undefined) problems.push(`${command}: not run`);
      else if (measured.exitCode !== 0) problems.push(`${command}: exited ${measured.exitCode} under the ${HEAP_CAP_MIB} MiB heap cap (${(measured.detail ?? '').slice(0, 160)})`);
      else if (measured.maxOldSpaceSizeMiB !== HEAP_CAP_MIB) problems.push(`${command}: ran under heap cap ${String(measured.maxOldSpaceSizeMiB)}, not the romlift bin's ${HEAP_CAP_MIB} MiB`);
      else if (!(measured.maxRssMiB < MAX_RSS_MIB)) problems.push(`${command}: peak RSS ${measured.maxRssMiB.toFixed(1)} MiB >= ${MAX_RSS_MIB} MiB`);
    }
    if (problems.length > 0) throw new Error(`large ROM: ${problems.join('; ')}`);
    cx.note(`32 MiB ROM ${report.sha1}, heap cap ${HEAP_CAP_MIB} MiB: ${report.runs.map((r) => `${r.command} maxRssMiB ${r.maxRssMiB.toFixed(1)}${r.treeDigest ? ` tree ${r.treeDigest}` : ''}`).join(', ')}`);
  },
});
