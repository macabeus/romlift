import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { BenchContext } from '../../../bench/src/context.ts';
import { currentPrinterSummary, printerMember } from '../../../bench/src/printer.ts';
import { armCoverage, corpusSummary, summarizeCorpus } from '../../../src/foundation/corpus/corpus.ts';
import { corpusInputsDigest } from '../../../src/shell/toolchain/corpus-inputs.ts';
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
  'src/foundation/corpus/corpus.ts': "export * from '../isa/decode.ts';\n",
  'src/foundation/isa/decode.ts': 'decode',
  'test/corpus/generate.ts': 'generate',
};

function context(root: string): BenchContext {
  return { repoRoot: root, benchRoot: root, pocRoot: root };
}

async function writeSummary(root: string, summary: unknown): Promise<void> {
  await writeTree(root, { 'bench/.local/corpus/summary.json': JSON.stringify(summary) });
}

test('results.json takes the corpus summary only while it parses, matches as and its digest is current', async () => {
  await withTempDir('romlift-printer-', async (root) => {
    await writeTree(root, TREE);
    const cx = context(root);
    assert.equal(await currentPrinterSummary(cx, AS), undefined, 'no summary yet');
    const digest = await corpusInputsDigest(root, AS, OPTIONS);
    const summary = corpusSummary(
      { inputsDigest: digest, as: AS, options: OPTIONS },
      summarizeCorpus([], armCoverage()),
      true,
    );
    await writeSummary(root, summary);
    assert.deepEqual(await currentPrinterSummary(cx, AS), summary);
    assert.equal(await currentPrinterSummary(cx, null), undefined, 'no as on the PATH');
    assert.equal(await currentPrinterSummary(cx, `${AS}.1`), undefined, 'another as');
    await writeSummary(root, { ...summary, schema: 'romlift/corpus-summary@2' });
    assert.equal(await currentPrinterSummary(cx, AS), undefined, 'another schema');
    await writeSummary(root, { ...summary, encoderAgrees: { checked: 'many' } });
    assert.equal(await currentPrinterSummary(cx, AS), undefined, 'a summary that breaks the contract');
    await writeSummary(root, { ...summary, options: { ...OPTIONS, armSample: 5 } });
    assert.equal(await currentPrinterSummary(cx, AS), undefined, 'options that are not the digested ones');
    await writeSummary(root, summary);
    await writeTree(root, { 'src/foundation/isa/decode.ts': 'changed' });
    assert.equal(await currentPrinterSummary(cx, AS), undefined, 'a changed corpus input');
  });
});

test('a writing run keeps the previous printer member while it is current and never drops a stale one silently', async () => {
  await withTempDir('romlift-printer-', async (root) => {
    await writeTree(root, TREE);
    const cx = context(root);
    const digest = await corpusInputsDigest(root, AS, OPTIONS);
    const summary = corpusSummary(
      { inputsDigest: digest, as: AS, options: OPTIONS },
      summarizeCorpus([], armCoverage()),
      true,
    );
    assert.deepEqual(
      await printerMember(cx, AS, undefined),
      { ok: true, summary: undefined, from: 'none' },
      'nothing to keep, nothing to drop',
    );
    assert.deepEqual(
      await printerMember(cx, AS, summary),
      { ok: true, summary, from: 'previous' },
      'no local corpus run: the current member is kept',
    );
    await writeSummary(root, summary);
    assert.deepEqual(await printerMember(cx, AS, summary), { ok: true, summary, from: 'corpus' });
    await writeTree(root, { 'src/foundation/isa/decode.ts': 'changed' });
    const stale = await printerMember(cx, AS, summary);
    assert.equal(stale.ok, false, 'a changed corpus input with no fresh summary refuses');
    assert.match(stale.ok ? '' : stale.reason, /npm run corpus/);
    const noAs = await printerMember(cx, null, summary);
    assert.equal(noAs.ok, false, 'no as on the PATH cannot vouch for the previous member');
  });
});
