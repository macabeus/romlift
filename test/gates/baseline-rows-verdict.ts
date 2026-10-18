// The per-ROM verdict of g2.baseline-rows (architecture §4.5 "What a row change may be", §13, D61 d), in
// one place: the gate calls it and test/unit/gates/baseline-rows-verdict.test.ts tests it.
//
// A ROM whose PoC reference is the pinned baseline (the five of the PoC) passes when every row that
// differs from it is an improvement listed in bench/baseline/accepted-diffs.json and no listed improvement
// is stale. A ROM revealed after the baseline was pinned (its reference the pinned PoC's own run of it,
// `poc.source` 'dump', D60 l) is judged the same way unless the owner made it a benchmark row
// (BENCHMARK_ROWS): then a non-improvement row that the dataset lists with a category (a `labels` or
// `untyped` row the run's row carries as `listed` with its `category`) is accepted and printed, every other
// unaccepted row (an extent change, an unlisted or uncategorised row) still fails, stale accepted diffs
// still fail, and the run's row must not fall below the floor the owner kept. A benchmark row is bound to
// the ROM and ELF it was decided on (dataset-binding.ts): for another build of that name it is stale and
// fails, and the ROM is judged as without it.

import { bindingMismatch, TMC_AT_D61, type DatasetBinding } from './dataset-binding.ts';

export interface RowDiff {
  readonly kind: string;
  readonly addr: string;
}

interface ListedRow {
  readonly addr: string;
  readonly listed: boolean;
  readonly category?: string;
}

/** What the verdict reads of one ROM's `bench run --json` row. */
export interface BaselineRowsInput {
  readonly name: string;
  readonly tp: number;
  readonly elfFunctions: number;
  readonly recall: number;
  readonly poc: { readonly source: 'baseline' | 'dump' | 'none' };
  readonly misses: readonly ListedRow[];
  readonly falseEntries: readonly ListedRow[];
  readonly baselineRows: { readonly diffs: readonly RowDiff[]; readonly unaccepted: readonly RowDiff[]; readonly staleAccepted: readonly RowDiff[] };
}

/** A ROM the owner kept as a benchmark row at its current numbers, not held to the PoC's run of it. */
export interface BenchmarkRow {
  readonly decided: string;
  readonly decision: string;
  readonly words: string;
  /** The dataset it was decided on. */
  readonly rom: DatasetBinding;
  /** The row later work must not regress: true positives and ELF functions when it was decided. */
  readonly floor: { readonly tp: number; readonly elfFunctions: number };
}

/**
 * The owner's answer to Q1 and Q2 of phase-2.md on 18 October 2026 (D61 d): tmc, revealed after the PoC
 * baseline was pinned, is a benchmark row at tp 8,631 of 8,636 (recall 99.94%).
 */
export const BENCHMARK_ROWS: Readonly<Record<string, BenchmarkRow>> = {
  tmc: {
    decided: '2026-10-18',
    decision: 'D61 d',
    words: "Keep tmc as 99.94%. It's a benchmark row that we can improve later",
    rom: TMC_AT_D61,
    floor: { tp: 8631, elfFunctions: 8636 },
  },
};

/** The non-improvement kinds a dataset row can carry: a miss or a false entry the run's row lists. */
const LISTABLE: Readonly<Record<string, 'misses' | 'falseEntries'>> = {
  'miss-added': 'misses',
  'miss-changed': 'misses',
  'false-entry-added': 'falseEntries',
  'false-entry-changed': 'falseEntries',
};

export interface BaselineRowsVerdict {
  readonly problems: readonly string[];
  /** The unaccepted rows a benchmark row accepts because the dataset lists them with a category. */
  readonly acceptedListed: readonly (RowDiff & { readonly category: string })[];
  readonly note: string;
}

function rows(list: readonly RowDiff[]): string {
  return list.slice(0, 8).map((d) => `${d.kind} ${d.addr}`).join(', ');
}

/** The verdict on one ROM's rows against its PoC reference; `dataset` is the ROM's dataset (its ROM SHA-1 and ELF SHA-256). */
export function baselineRowsVerdict(
  rom: BaselineRowsInput,
  dataset: { readonly sha1: string; readonly elfSha256?: string | undefined },
  benchmarkRows: Readonly<Record<string, BenchmarkRow>> = BENCHMARK_ROWS,
): BaselineRowsVerdict {
  const { diffs, unaccepted, staleAccepted } = rom.baselineRows;
  const named = rom.poc.source === 'dump' ? benchmarkRows[rom.name] : undefined;
  const unbound = named === undefined ? undefined : bindingMismatch(rom.name, named.decision, named.rom, dataset);
  const bench = unbound === undefined ? named : undefined;
  const problems: string[] = unbound === undefined ? [] : [unbound];
  const acceptedListed: (RowDiff & { readonly category: string })[] = [];
  const left: RowDiff[] = bench === undefined ? [...unaccepted] : [];
  if (bench !== undefined) {
    for (const d of unaccepted) {
      const list = LISTABLE[d.kind];
      const row = list === undefined ? undefined : rom[list].find((r) => r.addr === d.addr);
      if (row !== undefined && row.listed && row.category !== undefined) acceptedListed.push({ ...d, category: row.category });
      else left.push(d);
    }
    const floorRecall = bench.floor.tp / bench.floor.elfFunctions;
    if (rom.tp < bench.floor.tp) problems.push(`${rom.name}: true positives ${rom.tp}, below the benchmark row's ${bench.floor.tp} (${bench.decision})`);
    if (rom.recall < floorRecall) problems.push(`${rom.name}: recall ${(rom.recall * 100).toFixed(2)}%, below the benchmark row's ${(floorRecall * 100).toFixed(2)}% (${bench.decision})`);
  }
  if (left.length > 0) problems.push(`${rom.name}: ${left.length} rows differ from the PoC baseline without an accepted diff${bench === undefined ? '' : ' or a listed category'}: ${rows(left)}`);
  if (staleAccepted.length > 0) problems.push(`${rom.name}: ${staleAccepted.length} stale accepted diffs: ${rows(staleAccepted)}`);
  const accepted = diffs.length - unaccepted.length;
  const note =
    bench === undefined
      ? `${rom.name} ${accepted} accepted improvements${rom.poc.source === 'dump' ? " (against the PoC's own run, pinned in bench/baseline/poc-dump-rows.json)" : ''}`
      : `${rom.name} ${accepted} accepted improvements against the PoC's own run, and ${acceptedListed.length} rows the PoC's run did not have accepted as listed with a category ` +
        `(${acceptedListed.map((d) => `${d.addr} ${d.category}`).join(', ')}): a benchmark row by the owner on ${bench.decided} (${bench.decision}: "${bench.words}"), ` +
        `floor tp ${bench.floor.tp} of ${bench.floor.elfFunctions} (recall ${((bench.floor.tp / bench.floor.elfFunctions) * 100).toFixed(2)}%), now tp ${rom.tp} (${(rom.recall * 100).toFixed(2)}%)`;
  return { problems, acceptedListed, note };
}
