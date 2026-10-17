// g2.entries (architecture §8.4 "Entries (tuning)", §13; roadmap phase-2 thresholds): on every tuning ROM
// the dataset-against-ELF check passes, every miss is a `labels` row, every false entry an `untyped` row,
// raw precision is at least 99.7%, the raw true-positive count is at least the PoC's, and no listed row is
// stale (the lists only shrink).
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- dataset-check --json   the last line {ok, problems: []}   (frozen in phase 1)
//   npm run bench -- run --json             exit 0; the last stdout line is romlift/bench-run@1; --json
//   writes no committed file. Per tuning ROM in `roms[]` this gate reads
//     name
//     entries          entries found, counted from the end of the startup region
//     tp               entries that are ELF FUNC symbols (raw, before the exception lists)
//     poc: {tp}        the PoC baseline's true positives (bench/baseline/poc-2026-10-16.json)
//     misses:          [{addr, reason, listed}]   listed: the row is in the dataset's `labels`
//     falseEntries:    [{addr, origin, listed}]   listed: the row is in the dataset's `untyped`
//     staleExceptions: [{list, addr}]             `labels`/`untyped` rows this run no longer needs
import { gate, type ExecResult } from './gate.ts';

interface Miss {
  readonly addr: string;
  readonly reason: string;
  readonly listed: boolean;
}

interface FalseEntry {
  readonly addr: string;
  readonly origin: string;
  readonly listed: boolean;
}

interface BenchRunRom {
  readonly name: string;
  readonly entries: number;
  readonly tp: number;
  readonly poc: { readonly tp: number };
  readonly misses: readonly Miss[];
  readonly falseEntries: readonly FalseEntry[];
  readonly staleExceptions: readonly { readonly list: string; readonly addr: string }[];
}

interface BenchRun {
  readonly schema: string;
  readonly roms: readonly BenchRunRom[];
}

interface DatasetCheck {
  readonly ok: boolean;
  readonly problems: readonly unknown[];
}

const MIN_PRECISION = 0.997;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function percent(share: number): string {
  return `${(share * 100).toFixed(2)}%`;
}

gate({
  id: 'g2.entries',
  phase: 2,
  tier: 'real',
  inputs: ['roms', 'elfs'],
  needs: ['analyze', 'discover'],
  async run(cx) {
    const check = await cx.npm('bench', ['dataset-check', '--json']);
    if (check.code !== 0) throw new Error(`bench dataset-check --json exited ${check.code}:\n${tail(check)}`);
    const datasetCheck = cx.lastJson<DatasetCheck>(check.stdout);
    if (!datasetCheck.ok || datasetCheck.problems.length > 0) {
      throw new Error(`the dataset-against-ELF check fails: ${JSON.stringify(datasetCheck.problems.slice(0, 10))}`);
    }

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
      const precision = rom.entries === 0 ? 0 : rom.tp / rom.entries;
      if (precision < MIN_PRECISION) problems.push(`${rom.name}: raw precision ${percent(precision)} (${rom.tp}/${rom.entries}) < 99.70%`);
      if (rom.tp < rom.poc.tp) problems.push(`${rom.name}: ${rom.tp} true positives, fewer than the PoC's ${rom.poc.tp}`);
      const unlistedMisses = rom.misses.filter((m) => !m.listed);
      if (unlistedMisses.length > 0) problems.push(`${rom.name}: misses not in labels: ${unlistedMisses.slice(0, 8).map((m) => `${m.addr} (${m.reason})`).join(', ')}`);
      const unlistedFalse = rom.falseEntries.filter((f) => !f.listed);
      if (unlistedFalse.length > 0) problems.push(`${rom.name}: false entries not in untyped: ${unlistedFalse.slice(0, 8).map((f) => `${f.addr} (${f.origin})`).join(', ')}`);
      if (rom.staleExceptions.length > 0) problems.push(`${rom.name}: stale-exception rows: ${rom.staleExceptions.slice(0, 8).map((s) => `${s.list} ${s.addr}`).join(', ')}`);
      notes.push(`${rom.name} precision ${percent(precision)}, tp ${rom.tp} (PoC ${rom.poc.tp}), ${rom.misses.length} misses, ${rom.falseEntries.length} false`);
    }
    if (problems.length > 0) throw new Error(`entries: ${problems.join('; ')}`);
    cx.note(notes.join('; '));
  },
});
