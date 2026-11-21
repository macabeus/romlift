// Writes the two committed pins of the PoC (architecture §4.5, D11, D50), from the read-only checkout
// at ROMLIFT_POC: bench/baseline/poc-source.json (the sha256 of every PoC source file) and
// bench/baseline/poc-2026-10-16.json (its bench/results.json meta and rows, minus the volatile
// `seconds` of each row and scaffold). Run once when the pin is made:
//
//   node --conditions=source bench/tools/pin-poc.ts
//
// It refuses to overwrite a pin that differs unless given --force: a changed PoC is a decision.
import { join } from 'node:path';

import { stripSeconds } from '../src/baseline.ts';
import { baselineDir, contextFromEnv } from '../src/context.ts';
import { BenchError, exists, isRecord, prettyJson, readJson, readText, writeText } from '../src/files.ts';
import { computePocSource, pocSourcePath } from '../src/poc-source.ts';

async function writePin(path: string, text: string, force: boolean): Promise<void> {
  if (!force && (await exists(path)) && (await readText(path)) !== text) {
    throw new BenchError(`${path} exists and differs; pass --force to replace the pin`);
  }
  await writeText(path, text);
  process.stdout.write(`wrote ${path}\n`);
}

async function main(): Promise<number> {
  const cx = contextFromEnv(process.env);
  const force = process.argv.includes('--force');
  const source = await computePocSource(cx.pocRoot);
  await writePin(pocSourcePath(cx), prettyJson(source), force);
  const results = await readJson(join(cx.pocRoot, 'bench', 'results.json'));
  if (!isRecord(results) || !Array.isArray(results['roms']))
    throw new BenchError('the PoC bench/results.json has no roms');
  const baseline = { meta: results['meta'], roms: results['roms'].map(stripSeconds) };
  await writePin(join(baselineDir(cx), 'poc-2026-10-16.json'), prettyJson(baseline), force);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
