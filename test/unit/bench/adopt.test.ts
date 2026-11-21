// `bench adopt <rom>`: a new tuning dataset's lists are seeded from its run as unreviewed rows, the
// listed rows kept, the trailers printed; a sealed dataset is refused (D25).
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { adoptLists } from '../../../bench/src/adopt.ts';
import { type BenchIo, main } from '../../../bench/src/cli.ts';
import { dataset, row, withTempDir } from './fixtures.ts';
import { TINY_DEPS, syntheticTier } from './harness.ts';

function capture(): BenchIo & { readonly lines: string[]; readonly errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

test('adoptLists adds every unlisted miss and false entry as unreviewed, keeps the listed rows, sorts by address', () => {
  const d = dataset({ labels: [{ addr: '0x08000300', name: 'kept', category: 'loop-label', note: 'n' }] });
  const r = row({
    misses: [
      { addr: '0x08000300', name: 'kept', size: 0, reason: 'inside-code', listed: true, category: 'loop-label' },
      { addr: '0x08000200', name: 'new_label', size: 4, reason: 'unanchored', listed: false },
    ],
    falseEntries: [{ addr: '0x08000400', origin: 'gap-scan', size: 8, owner: 'host', listed: false }],
  });
  const adopted = adoptLists(d, r, 'abc1234');
  assert.deepEqual(adopted.labels, [
    {
      addr: '0x08000200',
      name: 'new_label',
      category: 'unreviewed',
      note: 'adopted at abc1234: missed (unanchored); classify with bench explain',
    },
    { addr: '0x08000300', name: 'kept', category: 'loop-label', note: 'n' },
  ]);
  assert.deepEqual(adopted.untyped, [
    {
      addr: '0x08000400',
      name: 'host',
      category: 'unreviewed',
      note: 'adopted at abc1234: reported via gap-scan, 8 bytes; classify with bench explain',
    },
  ]);
  assert.deepEqual(adopted.added, [
    { list: 'labels', addr: '0x08000200' },
    { list: 'untyped', addr: '0x08000400' },
  ]);
});

test('bench adopt rewrites the dataset with the new rows and prints the trailers; a sealed dataset is refused', async () => {
  await withTempDir('romlift-adopt-', async (root) => {
    const cx = await syntheticTier(root);
    const file = join(cx.repoRoot, 'bench', 'dataset', 'real', 'tiny.json');
    const before = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    const io = capture();
    assert.equal(await main(['adopt', 'tiny'], cx, io, TINY_DEPS), 0);
    const after = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(Object.keys(after), Object.keys(before));
    assert.deepEqual(
      (after['labels'] as { addr: string; category: string }[]).map((l) => [l.addr, l.category]),
      [['0x0800000E', 'unreviewed']],
    );
    assert.deepEqual(after['untyped'], before['untyped']);
    assert.match(io.lines[0] ?? '', /1 row\(s\) added as unreviewed/);
    assert.match(io.lines[1] ?? '', /^Bench-Exception: tiny 0x0800000E adopted labels row, unreviewed$/);
    // Adopting again adds nothing.
    assert.equal(await main(['adopt', 'tiny'], cx, capture(), TINY_DEPS), 0);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), after);

    await writeFile(
      join(cx.repoRoot, 'bench', 'dataset', 'real', 'held.json'),
      JSON.stringify({ ...before, name: 'held', heldout: true, revealed: [], labels: [], untyped: [] }),
    );
    const sealed = capture();
    assert.equal(await main(['adopt', 'held'], cx, sealed, TINY_DEPS), 1);
    assert.match(sealed.errors[0] ?? '', /held is sealed \(held out, never revealed\): adopt refuses it/);
    assert.deepEqual(
      JSON.parse(await readFile(join(cx.repoRoot, 'bench', 'dataset', 'real', 'held.json'), 'utf8'))['labels'],
      [],
    );
    assert.equal(await main(['adopt'], cx, capture(), TINY_DEPS), 2);
    assert.equal(await main(['adopt', 'nope'], cx, capture(), TINY_DEPS), 1);
  });
});
