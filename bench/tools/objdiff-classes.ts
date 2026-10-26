// `node --conditions=source bench/tools/objdiff-classes.ts [--only <rom>] [--json] [--write-ceiling]`: the objdiff family
// of `bench run --scaffold` on each tuning ROM (the seedless discover run, its readable bases, objdiff-cli against the
// reference objects), every difference sorted into the classes of bench/src/objdiff-classes.ts, one row per ROM: the
// count per class, the differences D34 as the owner amended it gates (D102: the classes that differ in a word, are
// unverified or were scored apart), the uncompared functions, the same-word differences, and every difference but
// unnamed-target (what D34 gated before D102). The facts of phase-3.md Q1 and phase-6.md Q6 and Q15 are this tool's
// output. It reads the ROMs, ELFs, maps and objects the datasets name and gives the family each dataset's map (so each
// function's reference object is the one the map links at its entry, and the archive members the map links are
// reference objects too). It writes nothing, except with `--write-ceiling`: bench/baseline/objdiff-ceiling.json, each
// measured ROM's ceiling lowered to its gated count, never raised, a ROM without one refused (objdiff-ceiling.ts
// lowerCeilings; g6.objdiff reads it and pins the owner's values, D104 b).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGnuMap, type GnuMap } from 'romlift';

import { analysisTuning, benchProfile, DEFAULT_RUN_TUNING, discoverOptions, readRealInputs, ROMLIFT_RUNNER } from '../src/analysis-run.ts';
import { parseArgs, UsageError } from '../src/args.ts';
import { contextFromEnv } from '../src/context.ts';
import { loadDatasets, tuningDatasets } from '../src/dataset.ts';
import { BenchError, prettyJson, writeText } from '../src/files.ts';
import { compareFunctions, objdiffDifferences } from '../src/objdiff.ts';
import { ceilingPath, lowerCeilings, readCeilings } from '../src/objdiff-ceiling.ts';
import { classCounts, classTotals, nameAddresses, OBJDIFF_CLASSES, type ClassTotals, type ObjdiffClass } from '../src/objdiff-classes.ts';
import { elfSymbols, referenceObjects } from '../src/run.ts';
import { locateObjdiff } from '../src/toolchain.ts';

export interface ClassRow extends ClassTotals {
  readonly rom: string;
  readonly scored: number;
  readonly classes: Readonly<Record<ObjdiffClass, number>>;
}

/** The dataset's reference map, parsed; undefined when it records none. */
async function datasetMap(benchRoot: string, path: string | undefined): Promise<GnuMap | undefined> {
  if (path === undefined) return undefined;
  const parsed = parseGnuMap(await readFile(join(benchRoot, path), 'utf8'));
  if (!parsed.ok) throw new BenchError(`${path}: ${parsed.error}`);
  return parsed.value;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { options: ['only'], flags: ['json', 'write-ceiling'] });
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
    });
    const classes = classCounts(compared.flatMap(objdiffDifferences), nameAddresses(symbols));
    rows.push({ rom: d.name, scored: compared.length, classes, ...classTotals(classes) });
  }
  if (args.flags.has('write-ceiling')) {
    const ceilings = lowerCeilings(await readCeilings(cx), Object.fromEntries(rows.map((r) => [r.rom, r.gated] as const)));
    await writeText(ceilingPath(cx), prettyJson(ceilings));
  }
  if (args.flags.has('json')) {
    process.stdout.write(`${JSON.stringify({ schema: 'romlift-bench/objdiff-classes@2', rows })}\n`);
    return 0;
  }
  const header = ['class', ...rows.map((r) => r.rom)];
  const totals: readonly (readonly [string, keyof ClassTotals])[] = [
    ['gated (D34 as amended, D102)', 'gated'],
    ['uncompared (missing-symbol, tool)', 'uncompared'],
    ['same word (reported)', 'sameWord'],
    ['every class but unnamed-target (D34 before D102)', 'beforeAmendment'],
  ];
  const table = [header, ...OBJDIFF_CLASSES.map((c) => [c, ...rows.map((r) => String(r.classes[c]))]), ...totals.map(([title, key]) => [title, ...rows.map((r) => String(r[key]))])];
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
