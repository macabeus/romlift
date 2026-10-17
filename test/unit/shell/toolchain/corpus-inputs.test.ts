// The corpus inputs digest (D55): it follows the relative imports of its roots, so it covers every
// module the corpus run depends on; on the real repository the closure it finds equals the one the
// TypeScript compiler resolves.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { corpusInputFiles, corpusInputsDigest, CORPUS_INPUT_ROOTS, relativeImports } from '../../../../src/shell/toolchain/corpus-inputs.ts';
import { withTempDir } from '../../bench/fixtures.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const AS = 'GNU assembler (test) 2.45';
const OPTIONS = { seed: 1, armSample: 4, blSample: 2 };

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

const TREE = {
  'src/foundation/corpus/corpus.ts': "export { a } from './cases.ts';\nimport type { T } from '../util/prng.ts';\n",
  'src/foundation/corpus/cases.ts': "import {\n  x,\n} from '../isa/decode.ts';\nexport const a = 'from here';\n",
  'src/foundation/isa/decode.ts': 'export const x = 1;\n',
  'src/foundation/util/prng.ts': 'export type T = number;\n',
  'src/shell/toolchain/corpus.ts': "import { readFile } from 'node:fs/promises';\nimport { b } from './binutils.ts';\n",
  'src/shell/toolchain/binutils.ts': 'export const b = 2;\n',
  'test/corpus/generate.ts': "import { runCorpus } from 'romlift/internal';\nimport { parseArgs } from '../../bench/src/args.ts';\n",
  'bench/src/args.ts': 'export const parseArgs = 0;\n',
  'src/foundation/rom/rom.ts': 'not imported by the corpus\n',
};

test('relativeImports reads static imports and re-exports, multi-line ones too, and skips packages', () => {
  assert.deepEqual(relativeImports(TREE['src/foundation/corpus/corpus.ts']), ['./cases.ts', '../util/prng.ts']);
  assert.deepEqual(relativeImports(TREE['src/foundation/corpus/cases.ts']), ['../isa/decode.ts']);
  assert.deepEqual(relativeImports("import './side-effect.ts';\nconst s = 'import x from \"./no.ts\"';\n"), ['./side-effect.ts']);
  assert.deepEqual(relativeImports(TREE['test/corpus/generate.ts']), ['../../bench/src/args.ts']);
});

test('the digest covers the import closure of its roots, the as version and the options', async () => {
  await withTempDir('romlift-corpus-inputs-', async (root) => {
    await writeTree(root, TREE);
    assert.deepEqual(await corpusInputFiles(root), [
      'bench/src/args.ts',
      'src/foundation/corpus/cases.ts',
      'src/foundation/corpus/corpus.ts',
      'src/foundation/isa/decode.ts',
      'src/foundation/util/prng.ts',
      'src/shell/toolchain/binutils.ts',
      'src/shell/toolchain/corpus.ts',
      'test/corpus/generate.ts',
    ]);
    const base = await corpusInputsDigest(root, AS, OPTIONS);
    assert.equal(await corpusInputsDigest(root, AS, OPTIONS), base);
    assert.notEqual(await corpusInputsDigest(root, `${AS}.1`, OPTIONS), base);
    assert.notEqual(await corpusInputsDigest(root, AS, { ...OPTIONS, armSample: 5 }), base);
    await writeTree(root, { 'src/foundation/rom/rom.ts': 'changed, but not a corpus input' });
    assert.equal(await corpusInputsDigest(root, AS, OPTIONS), base);
    for (const path of ['src/foundation/util/prng.ts', 'src/shell/toolchain/binutils.ts', 'bench/src/args.ts', 'test/corpus/generate.ts']) {
      const before = await readFile(join(root, path), 'utf8');
      await writeTree(root, { [path]: `${before}// changed\n` });
      assert.notEqual(await corpusInputsDigest(root, AS, OPTIONS), base, path);
      await writeTree(root, { [path]: before });
    }
    // A module the corpus starts to import is covered from that commit on.
    await writeTree(root, { 'src/foundation/isa/decode.ts': "import { r } from '../rom/rom.ts';\nexport const x = 1;\n" });
    assert.ok((await corpusInputFiles(root)).includes('src/foundation/rom/rom.ts'));
  });
});

/** The closure TypeScript resolves from the roots, relative imports only, as repository-relative paths. */
function typescriptClosure(): string[] {
  const seen = new Set<string>();
  const queue = [...CORPUS_INPUT_ROOTS];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const info = ts.preProcessFile(ts.sys.readFile(join(REPO, next)) ?? '', true, false);
    for (const ref of info.importedFiles) {
      if (!ref.fileName.startsWith('.')) continue;
      queue.push(join(next, '..', ref.fileName).split('\\').join('/'));
    }
  }
  return [...seen].sort();
}

test('on the repository, the closure equals what TypeScript resolves and reaches every corpus module', async () => {
  const ours = await corpusInputFiles(REPO);
  assert.deepEqual([...ours], typescriptClosure());
  for (const path of ['src/foundation/corpus/cases.ts', 'src/foundation/isa/decode.ts', 'src/foundation/util/prng.ts', 'src/foundation/asm/dialect.ts', 'src/shell/toolchain/binutils.ts', 'src/foundation/diagnostics/diagnostic.ts', 'bench/src/args.ts']) {
    assert.ok(ours.includes(path), path);
  }
});
