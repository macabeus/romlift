// Analysis memory is bounded (correctness-2 of the phase-2 review, D42, D59): a 32 MiB image that is
// mostly zeros, with candidates in the zeros and in a long run of never-branching Thumb data, is
// analysed in a child process under a 256 MiB V8 heap without running out of memory. Before
// LIMITS.zeroRun and LIMITS.walkInsns each candidate walked to the end of the image, and a 4 MiB
// cartridge padded with 4 MiB of zeros ran out of heap.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHILD = fileURLToPath(new URL('../../helpers/large-zero-rom.ts', import.meta.url));
const HEAP_MIB = 256;

test('a 32 MiB mostly-zero image is analysed under a 256 MiB heap; walks over data stop at the walk limit with W_WALK_LIMIT', () => {
  const child = spawnSync(process.execPath, ['--conditions=source', `--max-old-space-size=${HEAP_MIB}`, CHILD], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(child.status, 0, child.stderr);
  const out = JSON.parse(child.stdout.trim().split('\n').pop() ?? '{}') as { functions: number; diagnostics: string[]; rssMiB: number };
  assert.ok(out.functions >= 1, 'the entry function is found');
  assert.equal(out.diagnostics.filter((c) => c === 'W_WALK_LIMIT').length, 8, 'one per candidate in the data run, none in the zeros');
  assert.ok(out.rssMiB < 1024, `peak RSS ${out.rssMiB} MiB`);
});
