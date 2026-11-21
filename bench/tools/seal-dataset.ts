// Creates a sealed held-out dataset, bench/dataset/real/<name>.json (architecture §8.4, D25):
//
//   node --conditions=source bench/tools/seal-dataset.ts --name <n> --rom <path> --elf <path> --map <path>
//     --family <f> --checkout <dir> [--build-note <text>]
//
// Paths are relative to ROMLIFT_BENCH_ROOT. It records the ROM's SHA-1, the ELF's sha256 and the
// checkout's `git rev-parse --short HEAD`, with `heldout: true` and empty `revealed`, `labels` and
// `untyped`. It never overwrites a dataset (`heldout` is set at creation and never edited), never reads
// the ELF's symbols, and prints only the file it wrote and the digests: nothing of a held-out ROM's
// contents is ever shown.
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { sha1Of, sha256Of } from 'romlift/node';

import { UsageError, parseArgs } from '../src/args.ts';
import { contextFromEnv, datasetDir } from '../src/context.ts';
import { parseDataset } from '../src/dataset.ts';
import { BenchError, exists, isDirectory, prettyJson, readFileBytes } from '../src/files.ts';
import { runProcess } from '../src/process.ts';
import { sealedDataset } from '../src/seal.ts';

const USAGE =
  'usage: seal-dataset --name <n> --rom <path> --elf <path> --map <path> --family <f> --checkout <dir> [--build-note <text>]';
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** A path under the benchmark root, as the dataset records it. */
function benchPath(option: string, value: string): string {
  const path = normalize(value);
  if (isAbsolute(path) || path === '..' || path.startsWith('../'))
    throw new UsageError(`--${option} must be a path relative to ROMLIFT_BENCH_ROOT`);
  return path;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2), {
    options: ['name', 'rom', 'elf', 'map', 'family', 'checkout', 'build-note'],
  });
  const need = (key: string): string => {
    const value = args.options[key];
    if (value === undefined || value === '') throw new UsageError(`--${key} is required\n${USAGE}`);
    return value;
  };
  const name = need('name');
  const family = need('family');
  if (!ID.test(name)) throw new UsageError('--name must be lower-case letters, digits and dashes');
  if (!ID.test(family)) throw new UsageError('--family must be lower-case letters, digits and dashes');
  const rom = benchPath('rom', need('rom'));
  const elf = benchPath('elf', need('elf'));
  const map = benchPath('map', need('map'));
  const checkout = benchPath('checkout', need('checkout'));
  const buildNote = args.options['build-note'] ?? 'unchanged';

  const cx = contextFromEnv(process.env);
  const file = join(datasetDir(cx), `${name}.json`);
  if (await exists(file))
    throw new BenchError(`${file} exists; a dataset is sealed once, at creation, and never rewritten`);
  for (const [option, path] of [
    ['rom', rom],
    ['elf', elf],
    ['map', map],
  ] as const) {
    if (!(await exists(join(cx.benchRoot, path))))
      throw new BenchError(`--${option}: ${join(cx.benchRoot, path)} is missing`);
  }
  const checkoutDir = join(cx.benchRoot, checkout);
  if (!(await isDirectory(checkoutDir))) throw new BenchError(`--checkout: ${checkoutDir} is not a directory`);
  const head = await runProcess('git', ['-C', checkoutDir, 'rev-parse', '--short', 'HEAD']);
  if (head.code !== 0) throw new BenchError(`--checkout: ${checkoutDir} is not a git checkout`);

  const dataset = sealedDataset({
    name,
    rom,
    elf,
    map,
    sha1: sha1Of(await readFileBytes(join(cx.benchRoot, rom))),
    elfCommit: head.stdout.trim(),
    elfSha256: sha256Of(await readFileBytes(join(cx.benchRoot, elf))),
    family,
    buildNote,
  });
  const parsed = parseDataset(dataset, `bench/dataset/real/${name}.json`);
  if (parsed.dataset === undefined) throw new BenchError(parsed.problems.map((p) => p.detail).join('; '));
  // 'wx' fails if the file appeared since the check: a dataset is never overwritten.
  await writeFile(file, prettyJson(dataset), { flag: 'wx' });
  process.stdout.write(
    `wrote ${file}\nsha1 ${dataset.sha1}\nelfSha256 ${dataset.elfSha256}\nelfCommit ${dataset.elfCommit}\n`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(error instanceof UsageError ? 2 : 1);
  },
);
