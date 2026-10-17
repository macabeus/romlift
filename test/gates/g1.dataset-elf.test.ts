// g1.dataset-elf (architecture §8.3, §13): every `labels` row of a tuning dataset is an ELF FUNC symbol
// inside a function the run found, and every `untyped` row is not a FUNC symbol; the tuning datasets
// are exactly the five of docs/benchmark-roms.md (dataset-check pins them to the PoC baseline, and
// this gate to the names below), so a tuning dataset flipped to `heldout` fails here.
//
// FROZEN output: the last stdout line of `npm run bench -- dataset-check --json` (exit 0):
//   {ok, problems: []}   (each problem names its dataset, list and address)
import { gate, type ExecResult } from './gate.ts';

/** The tuning set of docs/benchmark-roms.md. */
const TUNING = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3'];

interface DatasetCheck {
  readonly ok: boolean;
  readonly problems: readonly unknown[];
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g1.dataset-elf',
  phase: 1,
  tier: 'real',
  inputs: ['roms', 'elfs', 'poc'],
  needs: ['parseElf'],
  async run(cx) {
    const run = await cx.npm('bench', ['dataset-check', '--json']);
    if (run.code !== 0) throw new Error(`bench dataset-check --json exited ${run.code}:\n${tail(run)}`);
    const check = cx.lastJson<DatasetCheck>(run.stdout);
    if (check.problems.length > 0) {
      throw new Error(`${check.problems.length} dataset rows disagree with their ELF: ${JSON.stringify(check.problems.slice(0, 10))}`);
    }
    if (!check.ok) throw new Error('bench dataset-check reported ok false with no problem');
    const names = cx.datasets.map((d) => d.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (names.join(',') !== TUNING.join(',')) throw new Error(`the tuning datasets are ${names.join(', ')}, expected ${TUNING.join(', ')}`);
    cx.note(`labels and untyped rows of ${cx.datasets.length} tuning datasets agree with their ELFs`);
  },
});
