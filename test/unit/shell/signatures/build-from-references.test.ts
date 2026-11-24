// shell/signatures/build-from-references.ts (architecture §7.1, §7.2, D32, D40, roadmap 6.A): a spec on disk or in
// memory built from its reference datasets (a bench dataset, else a synthetic fixture, else a toolchain reference), the refusals of a sealed, an
// unknown or a malformed dataset, a ROM of another SHA-1 and a malformed spec, the repository a spec belongs to, and
// the written file.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { signatureFileText } from '../../../../src/core/signatures/extract.ts';
import { parseSignatureFile } from '../../../../src/core/signatures/schema.ts';
import type { SignatureSpec } from '../../../../src/core/signatures/spec.ts';
import { buildSignatures, readSignatureSpec, signaturesRepoOf, SYNTHETIC_COMMIT, TOOLCHAIN_REFERENCE_SCHEMA, toolchainReferencePaths, writeSignatureFile } from '../../../../src/shell/signatures/build-from-references.ts';
import { sha1Of } from '../../../../src/shell/hash.ts';
import { packageRoot } from '../../../../src/shell/project/read-inputs.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const LIBRARY = join(REPO, 'bench', 'dataset', 'synthetic', 'library');
const SPEC_PATH = join(LIBRARY, 'spec.json');
const GOLDEN = JSON.parse(readFileSync(join(LIBRARY, 'signatures.golden.json'), 'utf8')) as unknown;
const TMP = mkdtempSync(join(tmpdir(), 'romlift-signatures-build-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

/** A repository of its own under TMP: bench/dataset/real/<name>.json for each dataset given, a spec naming them. */
function repoWith(name: string, datasets: Readonly<Record<string, unknown>>, references: readonly string[]): string {
  const repo = join(TMP, name);
  mkdirSync(join(repo, 'bench', 'dataset', 'real'), { recursive: true });
  mkdirSync(join(repo, 'signatures', 'specs'), { recursive: true });
  for (const [dataset, json] of Object.entries(datasets)) writeFileSync(join(repo, 'bench', 'dataset', 'real', `${dataset}.json`), JSON.stringify(json));
  const spec = { library: 'libfix', versions: [{ id: '1', idNote: '', references: references.map((dataset) => ({ dataset, objects: ['fix_*.o'] })) }], reviewedNames: {} };
  const path = join(repo, 'signatures', 'specs', 'libfix.json');
  writeFileSync(path, JSON.stringify(spec));
  return path;
}

const fixtureFile = (ext: string): string => join(LIBRARY, 'build', `library.${ext}`);

test("the fixture spec builds from the synthetic fixtures to the committed golden, with the package's version", async () => {
  const built = await buildSignatures({ specPath: SPEC_PATH });
  assert.ok(built.ok, JSON.stringify(built.ok ? [] : built.diagnostics));
  assert.deepEqual(built.diagnostics, []);
  const golden = parseSignatureFile(GOLDEN);
  assert.ok(golden.ok);
  assert.deepEqual({ ...built.value, builtWith: golden.value.builtWith }, golden.value);
  assert.equal(built.value.versions[0]?.references[0]?.commit, SYNTHETIC_COMMIT);
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { readonly version: string };
  assert.equal(built.value.builtWith, pkg.version);
});

test('an in-memory spec leaves a reference out (the bench leave-one-out): no FixShort without library-ref2', async () => {
  const read = await readSignatureSpec(SPEC_PATH);
  assert.ok(read.ok);
  const version = read.value.versions[0];
  assert.ok(version !== undefined);
  const spec: SignatureSpec = { ...read.value, versions: [{ ...version, references: version.references.slice(0, 1) }] };
  const built = await buildSignatures({ spec, specPath: SPEC_PATH }, { builtWith: 'test' });
  assert.ok(built.ok);
  assert.equal(built.value.builtWith, 'test');
  assert.ok(!built.value.versions[0]?.functions.some((f) => f.id === 'FixShort@fix_short.o'));
  assert.deepEqual(built.value.versions[0]?.linkOrder.map((l) => l.reference), ['library']);
});

test('a sealed held-out dataset is refused before any of its files is read (D32)', async () => {
  const spec = repoWith('sealed', { hidden: { rom: 'nowhere.gba', elf: 'nowhere.elf', map: 'nowhere.map', sha1: 'x', elfCommit: 'y', heldout: true, revealed: [] } }, ['hidden']);
  const built = await buildSignatures({ specPath: spec });
  assert.equal(built.ok, false);
  assert.deepEqual(built.ok ? [] : built.diagnostics.map((d) => d.code), ['E_SIGNATURE_DATASET_SEALED']);
});

test('a revealed held-out dataset is tuning data: it resolves to its files', async () => {
  const dataset = { rom: fixtureFile('gba'), elf: fixtureFile('elf'), map: fixtureFile('map'), sha1: '0'.repeat(40), elfCommit: 'c', heldout: true, revealed: [{ at: 'x', commit: 'y', reason: 'z' }] };
  const built = await buildSignatures({ specPath: repoWith('revealed', { shown: dataset }, ['shown']) });
  assert.deepEqual(built.ok ? [] : built.diagnostics.map((d) => d.code), ['E_SIGNATURE_REFERENCE_SHA1'], 'read, then refused only for its SHA-1');
});

test('the datasets of a repository resolve against the bench root; the recorded SHA-1 and commit are checked and used', async () => {
  const sha1 = sha1Of(new Uint8Array(readFileSync(fixtureFile('gba'))));
  const dataset = { rom: 'library/build/library.gba', elf: 'library/build/library.elf', map: 'library/build/library.map', sha1, elfCommit: 'abc1234', heldout: false, revealed: [] };
  const built = await buildSignatures({ specPath: repoWith('real', { lib: dataset }, ['lib']) }, { benchRoot: join(REPO, 'bench', 'dataset', 'synthetic') });
  assert.ok(built.ok, JSON.stringify(built.ok ? [] : built.diagnostics));
  assert.deepEqual(built.value.versions[0]?.references, [{ dataset: 'lib', commit: 'abc1234', romSha1: sha1 }]);
});

test('refusals: an unknown dataset, a dataset without its map, a malformed or missing spec, a library that is no file name', async () => {
  const codes = async (specPath: string): Promise<readonly string[]> => {
    const built = await buildSignatures({ specPath });
    return built.ok ? [] : built.diagnostics.map((d) => d.code);
  };
  assert.deepEqual(await codes(repoWith('unknown', {}, ['no-such-dataset'])), ['E_SIGNATURE_DATASET_UNKNOWN']);
  assert.deepEqual(await codes(repoWith('mapless', { m: { rom: 'a', elf: 'b', sha1: 'c', elfCommit: 'd', heldout: false, revealed: [] } }, ['m'])), ['E_SIGNATURE_DATASET_INVALID']);
  const bad = join(TMP, 'bad.json');
  writeFileSync(bad, '{ not json');
  assert.deepEqual(await codes(bad), ['E_SIGNATURE_SPEC_INVALID']);
  writeFileSync(bad, JSON.stringify({ library: 'x', versions: [] }));
  assert.deepEqual(await codes(bad), ['E_SIGNATURE_SPEC_INVALID']);
  assert.deepEqual(await codes(join(TMP, 'absent.json')), ['E_IO_READ']);
  const spec: SignatureSpec = { library: '../escape', versions: [{ id: '1', idNote: '', references: [{ dataset: 'library', objects: ['fix_*.o'] }] }], reviewedNames: {} };
  const built = await buildSignatures({ spec, specPath: SPEC_PATH });
  assert.deepEqual(built.ok ? [] : built.diagnostics.map((d) => d.code), ['E_SIGNATURE_SPEC_INVALID']);
});

test('a toolchain reference resolves to its built image and record, and gives members but no link order (D123)', async () => {
  const specPath = repoWith('toolchain', {}, ['fixlib']);
  const repo = join(TMP, 'toolchain');
  const paths = toolchainReferencePaths(repo, 'fixlib');
  mkdirSync(paths.recipe, { recursive: true });
  const unbuilt = await buildSignatures({ specPath }, { builtWith: 'test' });
  assert.ok(!unbuilt.ok);
  assert.equal(unbuilt.diagnostic.code, 'E_SIGNATURE_TOOLCHAIN_UNBUILT');
  assert.match(unbuilt.diagnostic.message, /npm run toolchain -- build/);

  mkdirSync(paths.build, { recursive: true });
  for (const [ext, to] of [['gba', paths.rom], ['elf', paths.elf], ['map', paths.map]] as const) writeFileSync(to, readFileSync(fixtureFile(ext)));
  const record = { schema: TOOLCHAIN_REFERENCE_SCHEMA, name: 'fixlib', toolchain: 'agbcc', commit: 'abc1234', sha1: sha1Of(readFileSync(fixtureFile('gba'))), recipe: 'r' };
  writeFileSync(paths.record, JSON.stringify(record));
  const built = await buildSignatures({ specPath }, { builtWith: 'test' });
  assert.ok(built.ok, JSON.stringify(built.ok ? [] : built.diagnostics));
  const version = built.value.versions[0];
  assert.deepEqual(version?.references, [{ dataset: 'fixlib', commit: 'abc1234', romSha1: record.sha1 }]);
  assert.ok((version?.functions.length ?? 0) > 0);
  assert.deepEqual(version?.linkOrder, []);

  writeFileSync(paths.record, JSON.stringify({ ...record, sha1: '0'.repeat(40) }));
  const other = await buildSignatures({ specPath }, { builtWith: 'test' });
  assert.ok(!other.ok);
  assert.equal(other.diagnostic.code, 'E_SIGNATURE_REFERENCE_SHA1');
  writeFileSync(paths.record, JSON.stringify({ ...record, schema: 'other' }));
  const malformed = await buildSignatures({ specPath }, { builtWith: 'test' });
  assert.ok(!malformed.ok);
  assert.equal(malformed.diagnostic.code, 'E_SIGNATURE_DATASET_INVALID');
});

test("a spec's repository: the nearest ancestor holding bench/dataset, else the package root", async () => {
  assert.equal(await signaturesRepoOf(join(REPO, 'signatures', 'specs', 'm4a.json')), REPO);
  assert.equal(await signaturesRepoOf(SPEC_PATH), REPO);
  const lone = join(TMP, 'lone', 'spec.json');
  mkdirSync(join(TMP, 'lone'), { recursive: true });
  assert.equal(await signaturesRepoOf(lone), packageRoot());
});

test('writeSignatureFile creates the directory and writes <library>.json as signatureFileText gives it', async () => {
  const built = await buildSignatures({ specPath: SPEC_PATH }, { builtWith: 'w' });
  assert.ok(built.ok);
  const out = join(TMP, 'out', 'deeper');
  const written = await writeSignatureFile(out, built.value);
  assert.ok(written.ok);
  assert.equal(written.value, join(out, 'libfix.json'));
  assert.equal(readFileSync(written.value, 'utf8'), signatureFileText(built.value));
});
