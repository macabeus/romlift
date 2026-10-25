// `init` with the signature layer on (its default since phase 6), then the confirm run, on each tuning ROM: no
// W_LISTED_INVALID, phase 4's listed-invalid premise (listed-invalid.test.ts holds it for init without signatures) now
// on the signature path too (phase-6.md Q10, the owner's option (c), D100). Before Q10 the set was 17 (measured at fix
// round 1, delivery-3): m4a entries the signatures list with `from = "sig:m4a@<version>"`, each an ELF FUNC of that
// size that a confirm run validates (D76 a), refused by the valid.* rules: on klonoa umul3232H32 0x0804F284 and
// SoundMainRAM 0x0804F318, Thumb entries that switch to ARM, their ARM code folded in as inner labels of mode arm, and
// ldrb_r3_r2 0x0804F73C, which falls through into chk_adr_r2; their counterparts on fe7j, pokeemerald, sa2 and sa3
// (three each) and two on tmc. The confirm run now judges a listed extent per inner label's mode and takes a
// fall-through into the next listed function as an exit (src/core/analysis/driver/listed-extent.ts), so the pinned set
// is empty; a warning here is a regression of that rule or a new signature placement the rules refuse.
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

/** The W_LISTED_INVALID addresses init's signature-folded config raises in its confirm run, per tuning ROM: none (Q10). */
const PINNED: Readonly<Record<string, readonly string[]>> = {
  fe7j: [],
  klonoa: [],
  pokeemerald: [],
  sa2: [],
  sa3: [],
  tmc: [],
};

const hex = (a: number | undefined): string => (a === undefined ? '-' : `0x${a.toString(16).toUpperCase().padStart(8, '0')}`);

const located = await locateSignatures({ packageRoot: REPO, env: process.env, cwd: REPO });
const noFiles = located.files.length === 0 ? `unavailable: no built signature file in ${located.dir} (run the build loop of the closing list)` : undefined;

for (const rom of Object.keys(PINNED)) {
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${rom}.json`), 'utf8')) as { readonly rom: string; readonly sha1: string };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  const unavailable = noFiles ?? (existsSync(romPath) ? undefined : `unavailable: rom ${romPath}`);
  test(`init with signatures, then confirm: no W_LISTED_INVALID: ${rom}`, { skip: REQUIRE ? false : (unavailable ?? false) }, (t) => {
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
