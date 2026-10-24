// The C scanner over the tuning checkouts' real decomp sources (fix round 6, architecture-b1-5): D81 a rests the
// scanner's conditional reading on a measurement over real `.c` files (35 unscannable before fix round 5, 2 after),
// which this test holds. scanC reads every `src/**/*.c` of the six tuning checkouts (klonoa's kleod, sa2, sa3, fe7j,
// pokeemerald, tmc; 1,729 files, D81 a's 1,739 less the 10 of the klonoa-empire-of-dreams working tree, which is no
// dataset checkout) and the files it cannot split must be exactly sa2's two `ASM_FUNC("…", void f(void))` shapes with no
// `;` against a definition. A scanner change that makes another real file unscannable fails here; one that makes these
// two scan updates this test and D81 a. Inputs: the checkouts under ROMLIFT_BENCH_ROOT (a missing one makes the test
// `unavailable`, or fails it when ROMLIFT_REQUIRE_LOCAL=1). test/local imports only the entry points and node.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanC } from 'romlift';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';

/** The tuning datasets (D60): each checkout is the first segment of its dataset's `rom` path. */
const TUNING = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3', 'tmc'] as const;
const CHECKOUTS = TUNING.map((rom) => (JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${rom}.json`), 'utf8')) as { readonly rom: string }).rom.split('/')[0] ?? rom);
const missing = CHECKOUTS.filter((checkout) => !existsSync(path.join(BENCH_ROOT, checkout, 'src')));
const unavailable = missing.length === 0 ? undefined : `unavailable: no src/ in ${missing.join(', ')}`;

/** Every `.c` under `dir`, as paths relative to the bench root, in code-unit order. */
function cFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.c')) out.push(path.relative(BENCH_ROOT, full).split(path.sep).join('/'));
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

test('scanC splits every real decomp .c of the tuning checkouts but sa2\'s two ASM_FUNC shapes (D81 a)', { skip: REQUIRE ? false : (unavailable ?? false) }, () => {
  assert.equal(unavailable, undefined, unavailable);
  const files = CHECKOUTS.flatMap((checkout) => cFiles(path.join(BENCH_ROOT, checkout, 'src')));
  const unscannable = files.filter((file) => scanC(readFileSync(path.join(BENCH_ROOT, file), 'utf8')).unscannable.length > 0);
  assert.equal(files.length, 1729, 'the six checkouts\' src/**/*.c as D81 a measured them (with klonoa-empire-of-dreams\' 10, 1,739)');
  assert.deepEqual(unscannable, ['sa2/src/game/sa2/cutscenes/final_ending_fall.c', 'sa2/src/game/shared/stage/item_tasks.c']);
});
