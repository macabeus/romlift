// Milestone M2 step (c) (architecture §4.2, D13): the internal 'epoch-reuse' cache carries a Thumb reading
// across an epoch boundary only when every fact it read is unchanged, so on each tuning ROM its analysis
// digest equals the 'epoch' one (it also held under the PoC's LIFO worklist until 'poc-lifo' was deleted). A missing ROM makes the ROM's test `unavailable`,
// or fails it when ROMLIFT_REQUIRE_LOCAL=1.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalJson, profileById, romFromBytes, type AnalysisResult, type JsonValue } from 'romlift';
import { sha1Of, sha256Stream } from 'romlift/node';
import { analyzeTuned } from 'romlift/internal';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const TUNING = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3'] as const;

const profile = profileById('agbcc');
if (profile === undefined) throw new Error('the agbcc profile is not registered');

const digest = (r: AnalysisResult): string => sha256Stream(canonicalJson(r as unknown as JsonValue));

for (const rom of TUNING) {
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${rom}.json`), 'utf8')) as { readonly rom: string; readonly sha1: string };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  const unavailable = existsSync(romPath) ? undefined : `unavailable: rom ${romPath}`;
  test(`'epoch-reuse' gives the 'epoch' analysis digest: ${rom}`, { skip: REQUIRE ? false : (unavailable ?? false) }, (t) => {
    assert.equal(unavailable, undefined, unavailable);
    const bytes = new Uint8Array(readFileSync(romPath));
    const sha1 = sha1Of(bytes);
    assert.equal(sha1, dataset.sha1, `${romPath} is not the dataset's ROM`);
    const r = romFromBytes(bytes, sha1);
    const run = (cache: 'epoch' | 'epoch-reuse'): string => digest(analyzeTuned(r, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, { worklist: 'ascending', cache, disabled: [] }));
    const epoch = run('epoch');
    t.diagnostic(`${rom}: ${epoch}`);
    assert.equal(run('epoch-reuse'), epoch, rom);
  });
}
