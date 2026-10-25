// `node --conditions=source bench/tools/objdiff-classes.ts [--only <rom>] [--own-spelling] [--json]`: the objdiff family of
// `bench run --scaffold` on each tuning ROM (the seedless discover run, its readable bases, objdiff-cli against
// the reference objects), every difference sorted into the classes of bench/src/objdiff-classes.ts, one row per
// ROM: the count per class, the total D34 gates and what Q1's option (b) would still gate. The facts of
// phase-3.md Q1 are this tool's output. It reads the ROMs, ELFs, maps and objects the datasets name, gives the
// family each dataset's map (so each function's reference object is the one the map links at its entry, and the
// archive members the map links are reference objects too), and writes nothing. `--own-spelling` scores romlift's own
// pool-word spelling, without the bench's objectWords rewrite (phase-6.md Q15 option a, delivery-r1-1).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGnuMap, type GnuMap } from 'romlift';

import { analysisTuning, benchProfile, DEFAULT_RUN_TUNING, discoverOptions, readRealInputs, ROMLIFT_RUNNER } from '../src/analysis-run.ts';
import { parseArgs, UsageError } from '../src/args.ts';
import { contextFromEnv } from '../src/context.ts';
import { loadDatasets, tuningDatasets } from '../src/dataset.ts';
import { BenchError } from '../src/files.ts';
import { compareFunctions, objdiffDifferences } from '../src/objdiff.ts';
import { classCounts, gatedTotals, nameAddresses, OBJDIFF_CLASSES, type ObjdiffClass } from '../src/objdiff-classes.ts';
import { elfSymbols, referenceObjects } from '../src/run.ts';
import { locateObjdiff } from '../src/toolchain.ts';

export interface ClassRow {
  readonly rom: string;
  readonly scored: number;
  readonly classes: Readonly<Record<ObjdiffClass, number>>;
  readonly gated: number;
  readonly gatedUnderOptionB: number;
}

/** The dataset's reference map, parsed; undefined when it records none. */
async function datasetMap(benchRoot: string, path: string | undefined): Promise<GnuMap | undefined> {
  if (path === undefined) return undefined;
  const parsed = parseGnuMap(await readFile(join(benchRoot, path), 'utf8'));
  if (!parsed.ok) throw new BenchError(`${path}: ${parsed.error}`);
  return parsed.value;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { options: ['only'], flags: ['json', 'own-spelling'] });
  const cx = contextFromEnv(process.env);
  const objdiff = await locateObjdiff(cx);
  if (objdiff === undefined) throw new BenchError('objdiff-cli not found (AGENTS.md, ROMLIFT_OBJDIFF)');
  const { datasets } = await loadDatasets(cx);
  const rows: ClassRow[] = [];
  for (const d of tuningDatasets(datasets, args.options['only'])) {
    if (d.objectsDir === undefined) continue;
    const inputs = await readRealInputs(cx, d);
    const analysis = ROMLIFT_RUNNER.analyze(inputs.rom, benchProfile(), discoverOptions(), analysisTuning(DEFAULT_RUN_TUNING));
    const objects = await referenceObjects(cx, d);
    const symbols = await elfSymbols(cx, d);
    const map = await datasetMap(cx.benchRoot, d.map);
    const compared = await compareFunctions({
      ...(map === undefined ? {} : { map }),
      rom: inputs.rom,
      analysis,
      truth: inputs.truth,
      symbols,
      objectsDir: objects.dir,
      objdiff: objdiff.bin,
      ...(objects.linked === undefined ? {} : { linkedObjects: objects.linked }),
      ...(args.flags.has('own-spelling') ? { ownSpelling: true } : {}),
    });
    const classes = classCounts(compared.flatMap(objdiffDifferences), nameAddresses(symbols));
    rows.push({ rom: d.name, scored: compared.length, classes, ...gatedTotals(classes) });
  }
  if (args.flags.has('json')) {
    process.stdout.write(`${JSON.stringify({ schema: 'romlift-bench/objdiff-classes@1', rows })}\n`);
    return 0;
  }
  const header = ['class', ...rows.map((r) => r.rom)];
  const table = [header, ...OBJDIFF_CLASSES.map((c) => [c, ...rows.map((r) => String(r.classes[c]))]), ['gated (D34)', ...rows.map((r) => String(r.gated))], ['gated under option (b)', ...rows.map((r) => String(r.gatedUnderOptionB))]];
  process.stdout.write(`${table.map((row) => `| ${row.join(' | ')} |`).join('\n')}\n`);
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = error instanceof UsageError ? 2 : 1;
    },
  );
}
