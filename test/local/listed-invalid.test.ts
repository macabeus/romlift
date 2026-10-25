// The confirm run takes the functions configFromDiscover listed without the valid.* rules (phase-3.md Q5 c, the
// owner's answer of 19 October 2026, D68 e; D74): on each tuning ROM, initConfigOf without signature files (`init
// --no-signatures`, as phase 4 had it; the signature path is listed-invalid-signatures.test.ts, delivery-3) then the
// confirm analysis over
// that config (what `generate` runs right after `init`) raises no W_LISTED_INVALID and records no listedInvalid
// row, while its other diagnostics stay as phase 3 measured them (sa3's four W_WALK_LIMIT, tmc's
// W_UNLISTED_FUNCTION at 0x080B1A28, none elsewhere). The same config with every seed marked `validate: true`
// (the phase-3 behaviour) must give the same analysis apart from listedInvalid and its warnings, so skipping the
// check changes no other decision; its W_LISTED_INVALID count is printed (phase 3: fe7j 5, klonoa 4, pokeemerald 6,
// sa2 4, sa3 4, tmc 24). A missing ROM makes the ROM's test `unavailable`, or fails it when ROMLIFT_REQUIRE_LOCAL=1.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyze, canonicalJson, confirmModel, confirmOptions, initConfigOf, profileById, romFromBytes, type AnalysisResult, type JsonValue } from 'romlift';
import { sha1Of, sha256Stream } from 'romlift/node';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';

/** The confirm diagnostics other than W_LISTED_INVALID that phase 3 measured on each tuning ROM (phase-3.md Q5 c). */
const OTHERS: Readonly<Record<string, readonly string[]>> = {
  fe7j: [],
  klonoa: [],
  pokeemerald: [],
  sa2: [],
  sa3: ['W_WALK_LIMIT 0x08520D40', 'W_WALK_LIMIT 0x085311DC', 'W_WALK_LIMIT 0x08532DDC', 'W_WALK_LIMIT 0x08537310'],
  tmc: ['W_UNLISTED_FUNCTION 0x080B1A28'],
};

const profile = profileById('agbcc');
if (profile === undefined) throw new Error('the agbcc profile is not registered');

const hex = (a: number | undefined): string => (a === undefined ? '-' : `0x${a.toString(16).toUpperCase().padStart(8, '0')}`);

/** The result without listedInvalid, its W_LISTED_INVALID warnings and the seeds' validate flags, as a digest. */
function digestApartFromValidation(r: AnalysisResult): string {
  const seeds = r.options.seeds.map(({ validate: _validate, ...seed }) => seed);
  const rest = { ...r, options: { ...r.options, seeds }, diagnostics: r.diagnostics.filter((d) => d.code !== 'W_LISTED_INVALID'), ...(r.mode === 'confirm' ? { listedInvalid: [] } : {}) };
  return sha256Stream(canonicalJson(rest as unknown as JsonValue));
}

for (const rom of Object.keys(OTHERS)) {
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${rom}.json`), 'utf8')) as { readonly rom: string; readonly sha1: string };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  const unavailable = existsSync(romPath) ? undefined : `unavailable: rom ${romPath}`;
  test(`init without signatures then confirm raises no W_LISTED_INVALID: ${rom}`, { skip: REQUIRE ? false : (unavailable ?? false) }, (t) => {
    assert.equal(unavailable, undefined, unavailable);
    const bytes = new Uint8Array(readFileSync(romPath));
    const sha1 = sha1Of(bytes);
    assert.equal(sha1, dataset.sha1, `${romPath} is not the dataset's ROM`);
    const r = romFromBytes(bytes, sha1);
    const init = initConfigOf(r);
    assert.ok(init.ok, `${rom}: init refused`);
    const { analysis } = confirmModel({ rom: r, config: init.config });
    assert.equal(analysis.mode, 'confirm');
    if (analysis.mode !== 'confirm') return;

    const listedInvalid = analysis.diagnostics.filter((d) => d.code === 'W_LISTED_INVALID');
    const others = analysis.diagnostics.filter((d) => d.code !== 'W_LISTED_INVALID').map((d) => `${d.code} ${hex(d.addr)}`);
    const options = confirmOptions(init.config);
    const validated = analyze(r, profile, { ...options, seeds: options.seeds.map((s) => ({ ...s, validate: true as const })) });
    const before = validated.diagnostics.filter((d) => d.code === 'W_LISTED_INVALID').length;
    t.diagnostic(`${rom}: W_LISTED_INVALID ${listedInvalid.length} (expected 0; ${before} with every listed entry validated); other diagnostics: ${others.length === 0 ? 'none' : others.join(', ')}`);

    assert.deepEqual(listedInvalid.map((d) => hex(d.addr)), [], `${rom}: W_LISTED_INVALID on functions configFromDiscover listed`);
    assert.deepEqual(analysis.listedInvalid, [], `${rom}: listedInvalid rows`);
    assert.deepEqual(others, OTHERS[rom], `${rom}: the other confirm diagnostics`);
    assert.equal(digestApartFromValidation(analysis), digestApartFromValidation(validated), `${rom}: skipping validation changed a decision other than listedInvalid`);
  });
}
