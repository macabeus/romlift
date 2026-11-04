// The inputs digest of the round-trip corpus (D55): the one definition `npm run corpus` writes into
// summary.json and the bench checks before it carries the summary in results.json (the printer
// family). It covers every repository file the corpus run can depend on, found by following the
// relative imports of CORPUS_INPUT_ROOTS (so a module the corpus starts to import is covered the day
// it is imported), plus the first line of `as --version` and the options. Package imports
// (`romlift/...`, `node:*`) are not followed: the roots name the modules those imports reach.
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { readTextIfPresent } from '../fs.ts';
import { sha256Stream } from '../hash.ts';

/** Where the closure starts (repository-relative): the corpus core, its verdict, its runner, this digest and the driver. */
export const CORPUS_INPUT_ROOTS: readonly string[] = [
  'src/foundation/corpus/corpus.ts',
  'src/foundation/corpus/threshold.ts',
  'src/shell/toolchain/corpus.ts',
  'src/shell/toolchain/corpus-inputs.ts',
  'test/corpus/generate.ts',
];

/** `import … from '<spec>'`, `export … from '<spec>'` and `import '<spec>'`, at the start of a line. */
const STATIC_IMPORT = /^[ \t]*(?:import|export)\b[^'";]*?\bfrom[ \t]*'([^']+)'|^[ \t]*import[ \t]*'([^']+)'/gm;

/** The relative specifiers (`./x.ts`, `../y/z.ts`) of every static import and re-export of a module text. */
export function relativeImports(text: string): readonly string[] {
  const out: string[] = [];
  for (const match of text.matchAll(STATIC_IMPORT)) {
    const spec = match[1] ?? match[2];
    if (spec !== undefined && spec.startsWith('.')) out.push(spec);
  }
  return out;
}

/** A corpus input's text, or undefined when it does not exist; an input that cannot be read stops the digest. */
async function readText(path: string): Promise<string | undefined> {
  const read = await readTextIfPresent(path);
  if (!read.ok) throw new Error(read.diagnostic.message);
  return read.value;
}

/** The repository-relative files the corpus depends on, sorted by code unit; roots that do not exist are left out. */
export async function corpusInputFiles(repoRoot: string, roots: readonly string[] = CORPUS_INPUT_ROOTS): Promise<readonly string[]> {
  const seen = new Set<string>();
  const queue = [...roots];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (seen.has(next)) continue;
    const text = await readText(join(repoRoot, next));
    if (text === undefined) continue;
    seen.add(next);
    for (const spec of relativeImports(text)) queue.push(posix.normalize(posix.join(posix.dirname(next), spec)));
  }
  return [...seen].sort(compareCodeUnits);
}

/**
 * sha256 over the corpus inputs: for every file of corpusInputFiles in code-unit order of its
 * repository-relative path, `path\0`, its bytes and `\0`; then `as\0<as --version line>\0options\0`
 * and the options as JSON (`seed`, `armSample`, `blSample`, in that order) followed by `\0`.
 */
export async function corpusInputsDigest(repoRoot: string, asVersion: string, options: unknown): Promise<string> {
  const chunks: (string | Uint8Array)[] = [];
  for (const path of await corpusInputFiles(repoRoot)) {
    const bytes = await readFile(join(repoRoot, path));
    chunks.push(`${path}\0`, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), '\0');
  }
  chunks.push(`as\0${asVersion}\0options\0${JSON.stringify(options)}\0`);
  return sha256Stream(chunks);
}
