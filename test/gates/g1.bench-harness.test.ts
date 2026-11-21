// g1.bench-harness (architecture §4.5, §13): rescoring the PoC's `scored.json` dumps reproduces
// bench/baseline/poc-2026-10-16.json row for row, the PoC's scaffold reproduces the SHA-1 on all five
// tuning ROMs, and two PoC runs give one digest.
//
// FROZEN output: the last stdout line of `npm run bench -- poc-check --json` (exit 0):
//   {ok, roms: [{name, rowsEqual, pocRowEqual, diffs, scaffoldOk, deterministic, pocSourceDigestOk}]}
import { type ExecResult, gate } from './gate.ts';

interface PocCheckRom {
  readonly name: string;
  readonly rowsEqual: boolean;
  readonly pocRowEqual: boolean;
  /** The rows that differ: a count or the rows themselves. */
  readonly diffs: number | readonly unknown[];
  readonly scaffoldOk: boolean;
  readonly deterministic: boolean;
  readonly pocSourceDigestOk: boolean;
}

interface PocCheck {
  readonly ok: boolean;
  readonly roms: readonly PocCheckRom[];
}

const TUNING_ROMS: readonly string[] = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3'];
const FLAGS = ['rowsEqual', 'pocRowEqual', 'scaffoldOk', 'deterministic', 'pocSourceDigestOk'] as const;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function diffCount(diffs: PocCheckRom['diffs']): number {
  return typeof diffs === 'number' ? diffs : diffs.length;
}

gate({
  id: 'g1.bench-harness',
  phase: 1,
  tier: 'real',
  inputs: ['roms', 'elfs', 'poc', 'toolchain'],
  needs: ['parseElf', 'canonicalJson', 'sha256Stream', 'MISS_REASONS', 'ORIGINS'],
  async run(cx) {
    const run = await cx.npm('bench', ['poc-check', '--json']);
    if (run.code !== 0) throw new Error(`bench poc-check --json exited ${run.code}:\n${tail(run)}`);
    const check = cx.lastJson<PocCheck>(run.stdout);
    const problems: string[] = [];
    for (const name of TUNING_ROMS) {
      const rom = check.roms.find((r) => r.name === name);
      if (rom === undefined) {
        problems.push(`${name}: absent`);
        continue;
      }
      const failed = FLAGS.filter((flag) => rom[flag] !== true);
      if (failed.length > 0) problems.push(`${name}: ${failed.join(', ')} false`);
      if (diffCount(rom.diffs) !== 0) problems.push(`${name}: ${diffCount(rom.diffs)} rows differ from the baseline`);
    }
    if (problems.length > 0) throw new Error(`bench poc-check: ${problems.join('; ')}`);
    if (!check.ok) throw new Error('bench poc-check reported ok false with every ROM passing');
    cx.note(
      `${TUNING_ROMS.length} tuning ROMs: rows equal the baseline, PoC rows equal, scaffold SHA-1 ok, deterministic, PoC source pinned`,
    );
  },
});
