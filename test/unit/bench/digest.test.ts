import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { digestOf, sourceDigest, sourceDigestPaths } from '../../../bench/src/digest.ts';
import { withTempDir } from './fixtures.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('digestOf does not depend on the order files are given in', () => {
  const a = { path: 'src/a.ts', bytes: enc('a') };
  const b = { path: 'src/b.ts', bytes: enc('b') };
  assert.equal(digestOf([a, b], 24), digestOf([b, a], 24));
  assert.notEqual(digestOf([a, b], 24), digestOf([a, b], 22));
  assert.notEqual(digestOf([a, b], 24), digestOf([a, { ...b, bytes: enc('c') }], 24));
  assert.notEqual(digestOf([a, b], 24), digestOf([a, { ...b, path: 'src/c.ts' }], 24));
});

async function writeTree(root: string, files: readonly (readonly [string, string])[]): Promise<void> {
  for (const [path, text] of files) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

const FILES: ReadonlyArray<readonly [string, string]> = [
  ['src/index.ts', 'export {};'],
  ['src/core/x.ts', 'x'],
  ['bench/src/cli.ts', 'cli'],
  ['bench/dataset/real/a.json', '{}'],
  ['bench/baseline/poc-source.json', '{}'],
  ['test/gates/g1.a.test.ts', 'g'],
  ['test/corpus/generate.ts', 'c'],
  ['package.json', '{}'],
  ['package-lock.json', '{}'],
  ['tsconfig.json', '{}'],
  ['tsconfig.build.json', '{}'],
];

test('sourceDigest is stable under file creation order and covers exactly the documented inputs', async () => {
  await withTempDir('romlift-digest-a-', async (first) => {
    await withTempDir('romlift-digest-b-', async (second) => {
      await writeTree(first, FILES);
      await writeTree(second, [...FILES].reverse());
      assert.equal(await sourceDigest(first, 24), await sourceDigest(second, 24));
      const before = await sourceDigest(first, 24);
      // Outside the inputs: README, results.json, bench/.local, test/unit, a macOS .DS_Store.
      await writeTree(first, [
        ['README.md', 'r'],
        ['bench/results.json', '{}'],
        ['bench/.local/poc/x/scored.json', '{}'],
        ['test/unit/x.test.ts', 't'],
        ['src/.DS_Store', 'junk'],
      ]);
      assert.equal(await sourceDigest(first, 24), before);
      assert.deepEqual(await sourceDigestPaths(first), [
        'bench/baseline/poc-source.json',
        'bench/dataset/real/a.json',
        'bench/src/cli.ts',
        'package-lock.json',
        'package.json',
        'src/core/x.ts',
        'src/index.ts',
        'test/corpus/generate.ts',
        'test/gates/g1.a.test.ts',
        'tsconfig.build.json',
        'tsconfig.json',
      ]);
      await writeTree(first, [['templates/Makefile', 'm']]);
      assert.notEqual(await sourceDigest(first, 24), before);
    });
  });
});
