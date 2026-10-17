// Milestone M1's parity (architecture §4.5): a plain analysis of each tuning ROM (worklist 'poc-lifo',
// cache 'epoch', no oracle, the registered rules) has the parity digest the PoC has in
// bench/baseline/poc-digests.json. It passes only on equality. While a family's rules are not all
// registered (wave 1 of phase 2 is still merging), the analysis cannot run: each ROM's test is then
// skipped as pending and reports which families are real and which rule ids are missing, or fails
// when ROMLIFT_REQUIRE_LOCAL=1. A missing ROM makes it `unavailable` (naming the ROM), or fails it
// under ROMLIFT_REQUIRE_LOCAL=1.
//
// test/local imports romlift only through its entry points (architecture §2), so the bench's parity
// module is loaded by a non-literal dynamic import and typed by the surface below.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { familyOf, profileById, romFromBytes, type AnalysisResult, type RuleId } from 'romlift';
import { sha1Of } from 'romlift/node';
import { analyzeTuned, RULES } from 'romlift/internal';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface ParityModule {
  resultParityDigest(result: AnalysisResult): string;
}

async function parityModule(): Promise<ParityModule> {
  const module: unknown = await import(pathToFileURL(path.join(REPO, 'bench', 'src', 'parity.ts')).href);
  return module as ParityModule;
}

const profile = profileById('agbcc');
if (profile === undefined) throw new Error('the agbcc profile is not registered');

const p = profile.pipeline;
const ids: readonly RuleId[] = [...p.seed, ...p.harvest, ...p.queue, ...p.walk, ...p.bl, ...p.validity, ...p.accept, ...p.claim, p.gap.absorb, p.gap.head, ...p.gap.forward, p.gap.prefer, p.gap.skip, p.gap.endAnchor, p.gap.backward, ...p.region];
const missing = ids.filter((id) => !Object.hasOwn(RULES, id));
const families = [...new Set(ids.map(familyOf))];
const real = families.filter((f) => !missing.some((id) => familyOf(id) === f));
const absent = families.filter((f) => !real.includes(f)).map((f) => `${f} (${missing.filter((id) => familyOf(id) === f).length} of ${ids.filter((id) => familyOf(id) === f).length})`);
const pending = missing.length === 0 ? undefined : `pending: real families [${real.join(', ')}]; rules not registered in ${absent.join(', ')}`;

const digests = JSON.parse(readFileSync(path.join(REPO, 'bench', 'baseline', 'poc-digests.json'), 'utf8')) as { readonly roms: Readonly<Record<string, string>> };

for (const rom of Object.keys(digests.roms).sort(byCodeUnit)) {
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${rom}.json`), 'utf8')) as { readonly rom: string; readonly sha1: string };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  const unavailable = existsSync(romPath) ? undefined : `unavailable: rom ${romPath}`;
  const skip = REQUIRE ? false : (unavailable ?? pending ?? false);
  test(`a plain analysis has the PoC's parity digest: ${rom}`, { skip }, async (t) => {
    assert.equal(unavailable, undefined, unavailable);
    assert.equal(pending, undefined, pending);
    const bytes = new Uint8Array(readFileSync(romPath));
    const sha1 = sha1Of(bytes);
    assert.equal(sha1, dataset.sha1, `${romPath} is not the dataset's ROM`);
    const result = analyzeTuned(romFromBytes(bytes, sha1), profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, { worklist: 'poc-lifo', cache: 'epoch', disabled: [] });
    const { resultParityDigest } = await parityModule();
    const digest = resultParityDigest(result);
    t.diagnostic(`${rom}: ${result.functions.length} functions, digest ${digest}`);
    assert.equal(digest, digests.roms[rom], 'the parity digest equals the PoC digest in bench/baseline/poc-digests.json');
  });
}
