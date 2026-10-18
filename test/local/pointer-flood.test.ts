// Analysis memory is bounded by the number of candidates (D12, D59 m), measured in a child process per
// image under a V8 heap limit (test/helpers/pointer-flood-rom.ts). A stress tier: each case takes about
// ten seconds and over a gigabyte of resident memory, so it runs with test:local, not npm test; the
// budget's logic has its unit tests (grow.test.ts, epoch.test.ts).
//
// - A 32 MiB image whose last 28 MiB are Thumb pointers into themselves (about 7.3 million harvest
//   candidates) analyses under a 512 MiB heap, with both budget warnings once each.
// - klonoa with 8 MiB of such pointers appended (several grow rounds) finds klonoa's functions, and its
//   rejections stay within the run-wide candidate budget plus klonoa's own: later grow rounds judge no
//   fresh candidate once the budget is spent. A missing ROM makes it `unavailable`, or fails it when
//   ROMLIFT_REQUIRE_LOCAL=1.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LIMITS } from 'romlift/internal';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const CHILD = path.join(REPO, 'test', 'helpers', 'pointer-flood-rom.ts');
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';

interface FloodRun {
  readonly functions: number;
  readonly diagnostics: readonly string[];
  readonly rejections: number;
  readonly seconds: number;
  readonly rssMiB: number;
}

function flood(heapMiB: number, args: readonly string[]): FloodRun {
  const child = spawnSync(process.execPath, ['--conditions=source', `--max-old-space-size=${heapMiB}`, CHILD, ...args], { encoding: 'utf8', timeout: 300_000 });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim().split('\n').pop() ?? '{}') as FloodRun;
}

const once = (out: FloodRun, code: string): number => out.diagnostics.filter((c) => c === code).length;

test('a 32 MiB image flooded with self-referencing Thumb pointers is analysed under a 512 MiB heap, with each budget warning once', (t) => {
  const out = flood(512, ['28']);
  t.diagnostic(JSON.stringify(out));
  assert.ok(out.functions >= 1, 'the entry function is found');
  assert.equal(once(out, 'W_CANDIDATE_BUDGET'), 1, out.diagnostics.join(', '));
  assert.equal(once(out, 'W_READING_BUDGET'), 1, out.diagnostics.join(', '));
  assert.ok(out.rejections <= LIMITS.candidateBudget + 1024, `${out.rejections} rejections`);
  assert.ok(out.rssMiB < 2048, `peak RSS ${out.rssMiB} MiB`);
});

const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', 'klonoa.json'), 'utf8')) as { readonly rom: string };
const klonoa = path.join(BENCH_ROOT, dataset.rom);
const unavailable = existsSync(klonoa) ? undefined : `unavailable: rom ${klonoa}`;

test('klonoa with 8 MiB of pointers appended keeps its functions; its rejections stay within the run-wide budget over several grow rounds', { skip: REQUIRE ? false : (unavailable ?? false) }, (t) => {
  assert.equal(unavailable, undefined, unavailable);
  const plain = flood(1024, ['0', klonoa]);
  const out = flood(1024, ['8', klonoa]);
  t.diagnostic(`plain ${JSON.stringify(plain)}; flooded ${JSON.stringify(out)}`);
  assert.equal(out.functions, plain.functions, 'the flood adds and removes no function');
  assert.equal(once(out, 'W_CANDIDATE_BUDGET'), 1, out.diagnostics.join(', '));
  assert.ok(out.rejections <= LIMITS.candidateBudget + plain.rejections, `${out.rejections} rejections, budget ${LIMITS.candidateBudget}, klonoa alone ${plain.rejections}`);
  assert.ok(out.rssMiB < 2048, `peak RSS ${out.rssMiB} MiB`);
});
