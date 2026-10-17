import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { BenchContext } from '../../../bench/src/context.ts';
import { corpusInputsDigest, currentPrinterSummary } from '../../../bench/src/printer.ts';
import { withTempDir } from './fixtures.ts';

const AS = 'GNU assembler (test) 2.45';
const OPTIONS = { seed: 1, armSample: 4, blSample: 2 };

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

const TREE = {
  'src/foundation/isa/decode.ts': 'decode',
  'src/foundation/asm/dialect.ts': 'dialect',
  'test/corpus/generate.ts': 'generate',
  'src/foundation/rom/rom.ts': 'not a corpus input',
};

function context(root: string): BenchContext {
  return { repoRoot: root, benchRoot: root, pocRoot: root };
}

async function writeSummary(root: string, summary: Record<string, unknown>): Promise<void> {
  await writeTree(root, { 'bench/.local/corpus/summary.json': JSON.stringify(summary) });
}

test('the corpus digest covers the ISA, the dialect, the driver, the as version and the options', async () => {
  await withTempDir('romlift-printer-', async (root) => {
    await writeTree(root, TREE);
    const base = await corpusInputsDigest(root, AS, OPTIONS);
    assert.equal(await corpusInputsDigest(root, AS, OPTIONS), base);
    assert.notEqual(await corpusInputsDigest(root, `${AS}.1`, OPTIONS), base);
    assert.notEqual(await corpusInputsDigest(root, AS, { ...OPTIONS, armSample: 5 }), base);
    await writeTree(root, { 'src/foundation/rom/rom.ts': 'changed, but not a corpus input' });
    assert.equal(await corpusInputsDigest(root, AS, OPTIONS), base);
    for (const path of ['src/foundation/isa/decode.ts', 'src/foundation/asm/dialect.ts', 'test/corpus/generate.ts']) {
      await writeTree(root, { [path]: 'changed' });
      const changed = await corpusInputsDigest(root, AS, OPTIONS);
      assert.notEqual(changed, base, path);
      await writeTree(root, { [path]: TREE[path as keyof typeof TREE] });
    }
    assert.equal(await corpusInputsDigest(root, AS, OPTIONS), base);
  });
});

test('results.json takes the corpus summary only while its digest is current', async () => {
  await withTempDir('romlift-printer-', async (root) => {
    await writeTree(root, TREE);
    const cx = context(root);
    assert.equal(await currentPrinterSummary(cx, AS), undefined, 'no summary yet');
    const digest = await corpusInputsDigest(root, AS, OPTIONS);
    const summary = { schema: 'romlift/corpus-summary@1', inputsDigest: digest, as: AS, options: OPTIONS, ok: true };
    await writeSummary(root, summary);
    assert.deepEqual(await currentPrinterSummary(cx, AS), summary);
    assert.equal(await currentPrinterSummary(cx, null), undefined, 'no as on the PATH');
    assert.equal(await currentPrinterSummary(cx, `${AS}.1`), undefined, 'another as');
    await writeSummary(root, { ...summary, schema: 'romlift/corpus-summary@2' });
    assert.equal(await currentPrinterSummary(cx, AS), undefined, 'another schema');
    await writeSummary(root, { ...summary, options: { ...OPTIONS, armSample: 5 } });
    assert.equal(await currentPrinterSummary(cx, AS), undefined, 'options that are not the digested ones');
    await writeSummary(root, summary);
    await writeTree(root, { 'src/foundation/isa/decode.ts': 'changed' });
    assert.equal(await currentPrinterSummary(cx, AS), undefined, 'a changed ISA source');
  });
});
