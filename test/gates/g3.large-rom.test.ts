// g3.large-rom (architecture §9.4, §13, D42): on the deterministic 32 MiB synthetic ROM (fixture code
// tiled with seeded data), the peak RSS of `init` and of `generate` (in phase 3, their workflow
// equivalents) stays below 512 MiB.
//
// Expected output, for the phase-3 lead to align (bench/src/large-rom.ts, test/helpers/large-rom.ts; the
// command is not in architecture §8.5 yet):
//   npm run bench -- large-rom --json   exit 0; the last stdout line is
//   {schema: 'romlift/bench-large-rom@1', romBytes, sha1,
//    runs: [{command: 'init' | 'generate', exitCode, maxRssMiB, treeDigest?}]}
//   each run is its own process; maxRssMiB is that process's peak resident set (process.resourceUsage).
import { gate, type ExecResult } from './gate.ts';

interface LargeRomRun {
  readonly command: string;
  readonly exitCode: number;
  readonly maxRssMiB: number;
  readonly treeDigest?: string;
}

interface LargeRom {
  readonly schema: string;
  readonly romBytes: number;
  readonly sha1: string;
  readonly runs: readonly LargeRomRun[];
}

const ROM_BYTES = 32 * 1024 * 1024;
const MAX_RSS_MIB = 512;
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
      else if (measured.exitCode !== 0) problems.push(`${command}: exited ${measured.exitCode}`);
      else if (!(measured.maxRssMiB < MAX_RSS_MIB)) problems.push(`${command}: peak RSS ${measured.maxRssMiB.toFixed(1)} MiB >= ${MAX_RSS_MIB} MiB`);
    }
    if (problems.length > 0) throw new Error(`large ROM: ${problems.join('; ')}`);
    cx.note(`32 MiB ROM ${report.sha1}: ${report.runs.map((r) => `${r.command} maxRssMiB ${r.maxRssMiB.toFixed(1)}${r.treeDigest ? ` tree ${r.treeDigest}` : ''}`).join(', ')}`);
  },
});
