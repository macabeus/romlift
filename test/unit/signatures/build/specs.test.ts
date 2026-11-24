// The committed signature specs (signatures/specs/*.json, architecture §7.1, §7.4, D31, D32, roadmap 6.A): the six
// libraries of phase 6, each valid for parseSignatureSpec, named after its library, with references to tuning
// datasets only (never a sealed one), and a reason for every reviewed name. The PoC's three keep its references, in
// its order, and its idNotes.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseSignatureSpec } from '../../../../src/core/signatures/spec.ts';
import type { SignatureSpec } from '../../../../src/core/signatures/spec.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SPECS = join(REPO, 'signatures', 'specs');
const DATASETS = join(REPO, 'bench', 'dataset', 'real');
const TOOLCHAIN = join(REPO, 'bench', 'dataset', 'toolchain');
const M4A_TABLES = ['gMPlayJumpTableTemplate', 'gScaleTable', 'gFreqTable', 'gPcmSamplesPerVBlankTable', 'gCgbScaleTable', 'gCgbFreqTable', 'gNoiseTable', 'gCgb3Vol', 'gClockTable', 'gXcmdTable'];

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function specs(): ReadonlyMap<string, SignatureSpec> {
  const out = new Map<string, SignatureSpec>();
  for (const file of readdirSync(SPECS).filter((f) => f.endsWith('.json')).sort(byCodeUnit)) {
    const parsed = parseSignatureSpec(JSON.parse(readFileSync(join(SPECS, file), 'utf8')));
    assert.ok(parsed.ok, `${file}: ${parsed.ok ? '' : parsed.error}`);
    assert.equal(`${parsed.value.library}.json`, file, `${file} is named after its library`);
    out.set(parsed.value.library, parsed.value);
  }
  return out;
}

test('the six libraries of phase 6 and libc (D123) have a spec each', () => {
  assert.deepEqual([...specs().keys()], ['agb_flash', 'libagbsyscall', 'libc', 'libgcc', 'librfu', 'm4a', 'siirtc']);
});

test('every reference names a tuning dataset, never a sealed one (D32), or a toolchain reference (D123), and every reviewed name gives a reason', () => {
  for (const [library, spec] of specs()) {
    for (const version of spec.versions) {
      assert.ok(version.idNote.length > 0, `${library} ${version.id}: an idNote`);
      for (const ref of version.references) {
        // A toolchain reference is a recipe of this repository: an archive of a compiler, never a ROM.
        if (existsSync(join(TOOLCHAIN, ref.dataset, 'build.mk'))) continue;
        const dataset = JSON.parse(readFileSync(join(DATASETS, `${ref.dataset}.json`), 'utf8')) as { readonly heldout: boolean; readonly revealed: readonly unknown[] };
        assert.ok(!dataset.heldout || dataset.revealed.length > 0, `${library} ${version.id}: ${ref.dataset} is sealed`);
      }
    }
    for (const [id, review] of Object.entries(spec.reviewedNames)) assert.ok(review.reason.length > 20 && review.name !== id.split('@')[0], `${library}: ${id}`);
  }
});

test("the PoC's three libraries keep its references, objects, tables and idNotes; libgcc reviews fp-bit.o's _fpadd_parts", () => {
  const all = specs();
  const m4a = all.get('m4a');
  assert.deepEqual(
    m4a?.versions.map((v) => [v.id, v.references.map((r) => [r.dataset, r.objects, r.tables])]),
    [
      ['2001', [['sa2', ['src/lib/m4a/m4a0.o', 'src/lib/m4a/m4a.o'], M4A_TABLES]]],
      ['2004', [['pokeemerald', ['src/m4a_1.o', 'src/m4a.o'], M4A_TABLES]]],
    ],
  );
  assert.deepEqual(all.get('libagbsyscall')?.versions.map((v) => v.references.map((r) => [r.dataset, r.objects])), [
    [
      ['pokeemerald', ['libagbsyscall.a(*)']],
      ['sa2', ['libagbsyscall.a(*)']],
      ['fe7j', ['asm/gba-syscall.o']],
      ['klonoa', ['asm/libagbsyscall.o']],
    ],
  ]);
  const libgcc = all.get('libgcc');
  assert.deepEqual(libgcc?.versions.map((v) => v.references.map((r) => r.dataset)), [['pokeemerald', 'sa2', 'fe7j']]);
  assert.deepEqual(Object.keys(libgcc?.reviewedNames ?? {}), ['_fpadd_parts@fp-bit.o']);
  assert.match(libgcc?.versions[0]?.idNote ?? '', /^agbcc's libgcc\.a; references merged/);
});

test('the serial libraries come from Emerald, one version each', () => {
  const all = specs();
  for (const library of ['agb_flash', 'siirtc', 'librfu']) {
    const spec = all.get(library);
    assert.equal(spec?.versions.length, 1, library);
    assert.deepEqual(spec?.versions[0]?.references.map((r) => r.dataset), ['pokeemerald'], library);
  }
});
