import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { sha256Of } from 'romlift/node';

import { comparePocSource, computePocSource, parsePocSource, pocSourceDigest } from '../../../bench/src/poc-source.ts';
import { withTempDir } from './fixtures.ts';

test('the PoC pin covers src/, signatures/, bench/dataset/ and package-lock.json', async () => {
  await withTempDir('romlift-poc-', async (poc) => {
    for (const [path, text] of [
      ['src/analysis.ts', 'a'],
      ['src/bench/run.ts', 'r'],
      ['signatures/m4a.json', 's'],
      ['bench/dataset/real/klonoa.json', 'k'],
      ['bench/results.json', 'not pinned'],
      ['README.md', 'not pinned'],
      ['package-lock.json', 'l'],
    ] as const) {
      await mkdir(join(poc, path, '..'), { recursive: true });
      await writeFile(join(poc, path), text);
    }
    const source = await computePocSource(poc);
    assert.deepEqual(Object.keys(source.files), [
      'bench/dataset/real/klonoa.json',
      'package-lock.json',
      'signatures/m4a.json',
      'src/analysis.ts',
      'src/bench/run.ts',
    ]);
    assert.equal(source.files['src/analysis.ts'], sha256Of('a'));
    const expected = sha256Of(
      Object.keys(source.files)
        .map((p) => `${p}\0${source.files[p] ?? ''}\n`)
        .join(''),
    );
    assert.equal(source.digest, expected);
    assert.deepEqual(comparePocSource(source, source), []);

    await writeFile(join(poc, 'src', 'analysis.ts'), 'changed');
    await writeFile(join(poc, 'src', 'extra.ts'), 'new');
    const changed = await computePocSource(poc);
    assert.deepEqual(comparePocSource(source, changed), [
      'src/analysis.ts differs from the pinned PoC source',
      'src/extra.ts is not in the pinned PoC source',
    ]);
    assert.deepEqual(comparePocSource(changed, source), [
      'src/analysis.ts differs from the pinned PoC source',
      'src/extra.ts is missing from the PoC checkout',
    ]);
    assert.deepEqual(comparePocSource({ ...source, digest: 'x' }, source), [
      'poc-source.json: its digest does not match its file list',
    ]);
  });
});

test('the committed pin is self-consistent', async () => {
  const pin = parsePocSource(
    JSON.parse(await readFile(new URL('../../../bench/baseline/poc-source.json', import.meta.url), 'utf8')),
    'poc-source.json',
  );
  assert.equal(pocSourceDigest(pin.files), pin.digest);
  assert.ok(Object.keys(pin.files).includes('src/bench/run.ts'));
  assert.ok(Object.keys(pin.files).includes('package-lock.json'));
});

test('a missing checkout is a BenchError naming ROMLIFT_POC', async () => {
  await assert.rejects(computePocSource('/nonexistent/romlift-poc'), /ROMLIFT_POC/);
});
