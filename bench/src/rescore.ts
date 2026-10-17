// Scoring one tuning dataset from its PoC dump: reads the ROM and the ELF, refuses either when its
// digest differs from the dataset (D50), reads bench/.local/poc/<rom>/scored.json, and scores it.
import { join } from 'node:path';

import { parseElf } from 'romlift';
import { sha1Of, sha256Of } from 'romlift/node';

import { scoredPath, type BenchContext } from './context.ts';
import type { Dataset } from './dataset.ts';
import { BenchError, exists, readFileBytes, readJson } from './files.ts';
import type { BenchRow } from './row.ts';
import { scoreRun } from './score.ts';
import { parseScoredRun, type ScoredRun } from './scored-run.ts';
import { elfTruth, type Truth } from './truth.ts';

export interface DatasetInputs {
  readonly dataset: Dataset;
  readonly sha1: string;
  readonly elfSha256: string;
  readonly romSize: number;
  readonly truth: Truth;
  readonly dump: ScoredRun;
}

export async function readDatasetInputs(cx: BenchContext, d: Dataset): Promise<DatasetInputs> {
  const romPath = join(cx.benchRoot, d.rom);
  const elfPath = join(cx.benchRoot, d.elf);
  if (!(await exists(romPath))) throw new BenchError(`${d.name}: the ROM ${romPath} is missing`);
  if (!(await exists(elfPath))) throw new BenchError(`${d.name}: the ELF ${elfPath} is missing`);
  const rom = await readFileBytes(romPath);
  const sha1 = sha1Of(rom);
  if (sha1 !== d.sha1) throw new BenchError(`${d.name}: refusing ${d.rom}: SHA-1 ${sha1}, the dataset records ${d.sha1}`);
  const elfBytes = await readFileBytes(elfPath);
  const elfSha256 = sha256Of(elfBytes);
  if (elfSha256 !== d.elfSha256) throw new BenchError(`${d.name}: refusing ${d.elf}: sha256 ${elfSha256}, the dataset records ${d.elfSha256}`);
  const elf = parseElf(elfBytes);
  if (!elf.ok) throw new BenchError(`${d.name}: ${d.elf}: ${elf.error}`);
  const dumpPath = scoredPath(cx, d.name);
  if (!(await exists(dumpPath))) throw new BenchError(`${d.name}: ${dumpPath} is missing: run npm run export-poc -- --mode scored`);
  const dump = parseScoredRun(await readJson(dumpPath), dumpPath);
  if (dump.rom !== d.name || dump.sha1 !== d.sha1) throw new BenchError(`${d.name}: ${dumpPath} is the dump of ${dump.rom} (${dump.sha1})`);
  return { dataset: d, sha1, elfSha256, romSize: rom.length, truth: elfTruth(elf.value, rom.length), dump };
}

export function rowOf(inputs: DatasetInputs): BenchRow {
  return scoreRun({ dump: inputs.dump, truth: inputs.truth, dataset: inputs.dataset, sha1: inputs.sha1 });
}
