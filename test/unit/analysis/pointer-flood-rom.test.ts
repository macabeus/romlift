// Analysis memory is bounded by the number of candidates too (correctness-r1-4 of the phase-2 review):
// a 32 MiB image whose last 28 MiB are Thumb pointers into themselves is analysed in a child process
// under a 512 MiB V8 heap. Every word is a harvest candidate (about 7.3 million); a grow round judges
// LIMITS.candidateBudget of them (W_CANDIDATE_BUDGET) and an epoch holds LIMITS.epochReadingBytes of
// their readings (W_READING_BUDGET). Without the two budgets the child runs out of heap.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHILD = fileURLToPath(new URL('../../helpers/pointer-flood-rom.ts', import.meta.url));
const HEAP_MIB = 512;

test('a 32 MiB image flooded with self-referencing Thumb pointers is analysed under a 512 MiB heap, with both budget warnings', () => {
  const child = spawnSync(process.execPath, ['--conditions=source', `--max-old-space-size=${HEAP_MIB}`, CHILD, '28'], { encoding: 'utf8', timeout: 300_000 });
  assert.equal(child.status, 0, child.stderr);
  const out = JSON.parse(child.stdout.trim().split('\n').pop() ?? '{}') as { functions: number; diagnostics: string[]; rejections: number; rssMiB: number };
  assert.ok(out.functions >= 1, 'the entry function is found');
  assert.ok(out.diagnostics.includes('W_CANDIDATE_BUDGET'), out.diagnostics.join(', '));
  assert.ok(out.diagnostics.includes('W_READING_BUDGET'), out.diagnostics.join(', '));
  assert.equal(out.diagnostics.filter((c) => c === 'W_READING_BUDGET').length, 1, 'raised once per run');
  assert.ok(out.rssMiB < 2048, `peak RSS ${out.rssMiB} MiB`);
});
