// g1.dataset-elf (architecture §8.3, §13): every `labels` row of a tuning dataset is an ELF FUNC symbol
// inside a function the run found, and every `untyped` row is not a FUNC symbol.
//
// FROZEN output: the last stdout line of `npm run bench -- dataset-check --json` (exit 0):
//   {ok, problems: []}   (each problem names its dataset, list and address)
import { gate, type ExecResult } from './gate.ts';

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
    cx.note(`labels and untyped rows of ${cx.datasets.length} tuning datasets agree with their ELFs`);
  },
});
