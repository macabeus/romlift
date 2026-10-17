// g3.readability (architecture §8.4 "Readability", §13): on all five tuning ROMs the readable printer's
// shares of mnemonics (against raw instructions), symbolic branches and symbolic pool loads are no lower
// than their floor, the first value committed for that ROM, so they only increase.
//
// Expected output, for the phase-3 lead to align (architecture §8.5):
//   npm run bench -- run --json   exit 0; the last stdout line is romlift/bench-run@1; --json writes no
//   committed file. Per tuning ROM in `roms[]` this gate reads
//     name
//     readability: {mnemonicShare, symbolicBranchShare, symbolicPoolShare,    each in [0, 1]
//                   floor: {mnemonicShare, symbolicBranchShare, symbolicPoolShare}}   the first committed values
import { gate, type ExecResult } from './gate.ts';

const SHARES = ['mnemonicShare', 'symbolicBranchShare', 'symbolicPoolShare'] as const;
type ShareName = (typeof SHARES)[number];
type Shares = Readonly<Record<ShareName, number>>;

interface BenchRunRom {
  readonly name: string;
  readonly readability: Shares & { readonly floor: Shares };
}

interface BenchRun {
  readonly schema: string;
  readonly roms: readonly BenchRunRom[];
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function pct(x: number): string {
  return `${(x * 100).toFixed(3)}%`;
}

gate({
  id: 'g3.readability',
  phase: 3,
  tier: 'real',
  inputs: ['roms', 'elfs'],
  needs: ['buildModel', 'emitTree', 'printChunk'],
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
      for (const share of SHARES) {
        const value = rom.readability[share];
        const floor = rom.readability.floor[share];
        if (!(value >= floor)) problems.push(`${rom.name}: ${share} ${pct(value)} below its floor ${pct(floor)}`);
      }
      notes.push(`${rom.name} ${SHARES.map((s) => pct(rom.readability[s])).join('/')}`);
    }
    if (problems.length > 0) throw new Error(`readability fell: ${problems.join('; ')}`);
    cx.note(`mnemonic/branch/pool shares: ${notes.join(', ')}`);
  },
});
