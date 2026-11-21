// g2.code-end (architecture §8.4 "Code end", §13): on every tuning ROM the code end the run found is
// within 16 bytes of the ELF's.
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- run --json   exit 0; the last stdout line is romlift/bench-run@1; --json writes no
//   committed file. Per tuning ROM in `roms[]` this gate reads
//     name
//     codeEnd: {found, elf, delta}   hex addresses; delta = found - elf in bytes (may be negative)
import { type ExecResult, gate } from './gate.ts';

interface BenchRunRom {
  readonly name: string;
  readonly codeEnd: { readonly found: string; readonly elf: string; readonly delta: number };
}

interface BenchRun {
  readonly schema: string;
  readonly roms: readonly BenchRunRom[];
}

const MAX_DELTA = 16;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g2.code-end',
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
      const { found, elf, delta } = rom.codeEnd;
      if (!Number.isFinite(delta) || Math.abs(delta) > MAX_DELTA)
        problems.push(`${rom.name}: code end ${found}, the ELF's ${elf} (delta ${delta} bytes)`);
      notes.push(`${rom.name} ${delta}`);
    }
    if (problems.length > 0) throw new Error(`code end beyond 16 bytes: ${problems.join('; ')}`);
    cx.note(`code-end deltas in bytes: ${notes.join(', ')}`);
  },
});
