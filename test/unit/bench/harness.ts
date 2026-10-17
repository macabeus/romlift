// A whole synthetic real tier in a temporary directory: a repository with one dataset, its PoC dump,
// the PoC pins and a baseline row, and a benchmark root holding a self-made 48-byte "ROM" and the
// committed tiny.elf fixture. The bench commands run against it exactly as against the real tier.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sha1Of, sha256Of } from 'romlift/node';

import { stripSeconds } from '../../../bench/src/baseline.ts';
import type { BenchContext } from '../../../bench/src/context.ts';
import { pocSourceDigest } from '../../../bench/src/poc-source.ts';
import type { ScoredRun } from '../../../bench/src/scored-run.ts';
import { dataset, dump, fn } from './fixtures.ts';

export const TINY_ELF = new URL('../../fixtures/formats/tiny.elf', import.meta.url);
export const ROM_BYTES = Uint8Array.from({ length: 0x30 }, (_, i) => (i * 7) & 0xff);

/** The row score.ts must produce for the synthetic dump (and the PoC's own row, as the baseline holds it). */
export const EXPECTED_ROW = {
  name: 'tiny',
  sha1: sha1Of(ROM_BYTES),
  elfCommit: 'abc1234',
  elfFunctions: 3,
  entries: 3,
  startup: { end: '0x08000008', pieces: 1, elfFunctions: 1 },
  thumb: 3,
  arm: 0,
  tp: 2,
  precision: 2 / 3,
  recall: 2 / 3,
  misses: [{ addr: '0x0800000E', name: 'thumb_two', size: 10, reason: 'unanchored', listed: false }],
  falseEntries: [{ addr: '0x08000010', origin: 'gap-scan', size: 4, owner: 'thumb_two', listed: true, category: 'unreviewed' }],
  extents: { sized: 2, agree: 2, mismatches: [] },
  codeEnd: { found: '0x0800001C', elf: '0x0800001C', delta: 0 },
  deterministic: true,
  scaffold: { ok: true },
} as const;

const POC_ROW = { ...EXPECTED_ROW, seconds: 0.1, scaffold: { ok: true, seconds: 0.2, summary: 'built' }, signatures: { functions: 0, seconds: 0 }, datasetProblems: [] };

export function tinyDump(overrides: Partial<ScoredRun> = {}): ScoredRun {
  return dump({
    sha1: sha1Of(ROM_BYTES),
    pocSourceDigest: pocSourceDigest({}),
    analysis: {
      functions: [
        fn('0x08000000', '0x08000008', 'rom entry', 'arm'),
        fn('0x08000008', '0x0800000E', 'call'),
        fn('0x08000010', '0x08000014', 'gap scan'),
        fn('0x08000018', '0x0800001C', 'call'),
      ],
      startup: { end: '0x08000008', entries: ['0x08000000'] },
      codeRange: ['0x08000000', '0x0800001C'],
    },
    misses: [{ addr: '0x0800000E', reason: 'valid but not accepted: anchored at start, has push {.., lr}' }],
    scaffold: { ok: true, summary: 'built' },
    pocRow: stripSeconds(POC_ROW) as Record<string, unknown>,
    ...overrides,
  });
}

async function put(path: string, text: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text);
}

/** Lays out the synthetic real tier under `root`; returns its context. */
export async function syntheticTier(root: string, options: { readonly dump?: ScoredRun; readonly datasetOverrides?: Record<string, unknown> } = {}): Promise<BenchContext> {
  const repoRoot = join(root, 'repo');
  const benchRoot = join(root, 'bench');
  const pocRoot = join(root, 'poc');
  await mkdir(join(benchRoot, 'tiny'), { recursive: true });
  await mkdir(pocRoot, { recursive: true });
  await writeFile(join(benchRoot, 'tiny', 'tiny.gba'), ROM_BYTES);
  await copyFile(TINY_ELF, join(benchRoot, 'tiny', 'tiny.elf'));
  await writeFile(join(benchRoot, 'tiny', 'tiny.map'), '');
  const elfSha256 = sha256Of(new Uint8Array(await readFile(TINY_ELF)));
  const d = {
    ...dataset({ sha1: sha1Of(ROM_BYTES), elfSha256, untyped: [{ addr: '0x08000010', category: 'unreviewed', note: 'inside thumb_two' }] }),
    ...options.datasetOverrides,
  };
  await put(join(repoRoot, 'package.json'), JSON.stringify({ name: 'romlift', version: '1.2.3' }));
  await put(join(repoRoot, 'bench', 'dataset', 'real', 'tiny.json'), JSON.stringify(d));
  await put(join(repoRoot, 'bench', 'baseline', 'poc-source.json'), JSON.stringify({ files: {}, digest: pocSourceDigest({}) }));
  await put(join(repoRoot, 'bench', 'baseline', 'poc-2026-10-16.json'), JSON.stringify({ meta: {}, roms: [stripSeconds(POC_ROW)] }));
  await put(join(repoRoot, 'bench', '.local', 'poc', 'tiny', 'scored.json'), JSON.stringify(options.dump ?? tinyDump()));
  await put(join(repoRoot, 'test', 'gates', 'phase.json'), '{ "landed": 0 }');
  await put(join(repoRoot, 'src', 'index.ts'), 'export {};\n');
  return { repoRoot, benchRoot, pocRoot };
}
