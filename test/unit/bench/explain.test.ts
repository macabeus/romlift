// `bench explain <rom> <addr>`: two runs (the second with trail 'full' filtered to explainFilter), the
// analysis explanation of romlift/internal, its text and its --json line; a sealed dataset is refused.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { TrailEvent } from 'romlift';

import { main, type BenchIo } from '../../../bench/src/cli.ts';
import { claimName } from 'romlift';
import { parseExplainAddr, type ExplainReport } from '../../../bench/src/explain.ts';
import { withTempDir } from './fixtures.ts';
import { syntheticTier, tinyDeps, tinyResult } from './harness.ts';

function capture(): BenchIo & { readonly lines: string[]; readonly errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

const EVENTS: readonly TrailEvent[] = [{ kind: 'reject', at: 0x0800_000e, rule: 'valid.dense', round: 2, cites: [0x0800_000e], detail: 'not-dense: 9 holes' }];

test('addresses are hex or decimal; claim kinds have names', () => {
  assert.equal(parseExplainAddr('0x0800000E'), 0x0800_000e);
  assert.equal(parseExplainAddr('134217742'), 0x0800_000e);
  assert.equal(parseExplainAddr('0xZZ'), undefined);
  assert.equal(claimName(0), 'free');
  assert.equal(claimName(2), 'pool');
});

test('bench explain re-runs with the filtered full trail and explains the address', async () => {
  await withTempDir('romlift-explain-', async (root) => {
    const cx = await syntheticTier(root);
    const calls: { trail: string; filter?: { start: number; end: number } }[] = [];
    const deps = tinyDeps(tinyResult(), { events: EVENTS, onAnalyze: (c) => calls.push(c) });
    const io = capture();
    assert.equal(await main(['explain', 'tiny', '0x08000010', '--json'], cx, io, deps), 0);
    assert.deepEqual(calls, [
      { trail: 'off', disabled: [] },
      { trail: 'full', disabled: [], filter: { start: 0x0800_0000, end: 0x0800_0100 } },
    ]);
    const report = JSON.parse(io.lines.at(-1) ?? '') as ExplainReport;
    assert.equal(report.schema, 'romlift/bench-explain@1');
    assert.equal(report.rom, 'tiny');
    assert.equal(report.explanation.addr, 0x0800_0010);
    assert.deepEqual(report.explanation.owner, { entry: 0x0800_0010, origin: 'gap-scan', provenance: [{ rule: 'seed.call', round: 0, cites: [] }] });
    assert.deepEqual(report.explanation.events, EVENTS);
    assert.match(io.lines[0] ?? '', /^0x08000010 in tiny: free$/);
    assert.match(io.lines[1] ?? '', /^ {2}owner 0x08000010 \(origin gap-scan\)$/);
    assert.ok(io.lines.some((l) => /reject {2}0x0800000E valid\.dense round 2 cites 0x0800000E: not-dense: 9 holes/.test(l)));
  });
});

test('a sealed dataset is never explained; an unknown name or a bad address is refused', async () => {
  await withTempDir('romlift-explain-sealed-', async (root) => {
    const cx = await syntheticTier(root);
    const tiny = JSON.parse(await readFile(join(cx.repoRoot, 'bench', 'dataset', 'real', 'tiny.json'), 'utf8')) as Record<string, unknown>;
    await writeFile(join(cx.repoRoot, 'bench', 'dataset', 'real', 'held.json'), JSON.stringify({ ...tiny, name: 'held', heldout: true, revealed: [], labels: [], untyped: [] }));
    const io = capture();
    assert.equal(await main(['explain', 'held', '0x08000010'], cx, io, tinyDeps()), 1);
    assert.match(io.errors[0] ?? '', /held is sealed: an explanation prints addresses/);
    assert.deepEqual(io.lines, []);
    assert.equal(await main(['explain', 'nope', '0x08000010'], cx, capture(), tinyDeps()), 1);
    assert.equal(await main(['explain', 'tiny', 'here'], cx, capture(), tinyDeps()), 2);
    assert.equal(await main(['explain', 'tiny'], cx, capture(), tinyDeps()), 2);
  });
});
