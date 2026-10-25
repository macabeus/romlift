// `init` with the signature layer on (its default since phase 6), then the confirm run, on each tuning ROM: the
// W_LISTED_INVALID warnings it raises are exactly the ones pinned below (phase-6 fix round 1, delivery-3; phase-6.md
// Q10). listed-invalid.test.ts holds phase 4's premise for init without signatures (initConfigOf with no file: no
// W_LISTED_INVALID); this test is the signature path that premise never ran. The pinned set is what the measured
// matcher gives today (measured at fix round 1): the same m4a entries on every tuning ROM, which the signatures list with
// `from = "sig:m4a@<version>"`, each an ELF FUNC of that size that a confirm run validates (D76 a) and the valid.* rules
// refuse: on klonoa umul3232H32 0x0804F284 and SoundMainRAM 0x0804F318, Thumb entries that switch to ARM, and
// ldrb_r3_r2 0x0804F73C, which falls through into chk_adr_r2; their counterparts on fe7j, pokeemerald, sa2 and sa3
// (three each) and two on tmc, 17 in all. Until the owner answers Q10 a change of this set is a decision, so it fails
// here first.
//
// The built signature files are the local ones the closing list builds (signatures/*.json, gitignored, D40; or
// $ROMLIFT_SIGNATURES), read with romlift/node's locateSignatures. Without them, or without a ROM, a test is
// `unavailable`, or fails when ROMLIFT_REQUIRE_LOCAL=1.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { confirmModel, initConfigOf, romFromBytes } from 'romlift';
import { locateSignatures, sha1Of } from 'romlift/node';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';

/** The W_LISTED_INVALID addresses init's signature-folded config raises in its confirm run, per tuning ROM (Q10). */
const PINNED: Readonly<Record<string, readonly string[]>> = {
  fe7j: ['0x080BE394', '0x080BE428', '0x080BE84C'],
  klonoa: ['0x0804F284', '0x0804F318', '0x0804F73C'],
  pokeemerald: ['0x082DF04C', '0x082DF0E0', '0x082DF864'],
  sa2: ['0x080945E8', '0x0809467C', '0x08094AA0'],
  sa3: ['0x080B9838', '0x080B98CC', '0x080B9CF0'],
  tmc: ['0x080AF310', '0x080AF75C'],
};

const hex = (a: number | undefined): string => (a === undefined ? '-' : `0x${a.toString(16).toUpperCase().padStart(8, '0')}`);

const located = await locateSignatures({ packageRoot: REPO, env: process.env, cwd: REPO });
const noFiles = located.files.length === 0 ? `unavailable: no built signature file in ${located.dir} (run the build loop of the closing list)` : undefined;

for (const rom of Object.keys(PINNED)) {
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${rom}.json`), 'utf8')) as { readonly rom: string; readonly sha1: string };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  const unavailable = noFiles ?? (existsSync(romPath) ? undefined : `unavailable: rom ${romPath}`);
  test(`init with signatures, then confirm: W_LISTED_INVALID exactly as pinned: ${rom}`, { skip: REQUIRE ? false : (unavailable ?? false) }, (t) => {
    assert.equal(unavailable, undefined, unavailable);
    const bytes = new Uint8Array(readFileSync(romPath));
    const sha1 = sha1Of(bytes);
    assert.equal(sha1, dataset.sha1, `${romPath} is not the dataset's ROM`);
    const r = romFromBytes(bytes, sha1);
    const init = initConfigOf(r, { signatureFiles: located.files });
    assert.ok(init.ok, `${rom}: init refused`);
    const signed = [...init.config.functions.values()].filter((f) => f.from?.startsWith('sig:') === true).length;
    const { analysis } = confirmModel({ rom: r, config: init.config });
    const listedInvalid = analysis.diagnostics.filter((d) => d.code === 'W_LISTED_INVALID').map((d) => hex(d.addr));
    t.diagnostic(`${rom}: ${signed} signature-named functions; W_LISTED_INVALID ${listedInvalid.length === 0 ? 'none' : listedInvalid.join(', ')}`);
    assert.ok(signed > 0, `${rom}: the signature layer named no function`);
    assert.deepEqual(listedInvalid, PINNED[rom], `${rom}: the W_LISTED_INVALID set of init with signatures`);
  });
}
