// The real half of g6.signatures-rebuild, run locally (architecture §7.1, D31, roadmap 6.A): every committed spec of
// signatures/specs/ built twice with buildSignatures gives one canonical text, and m4a, libagbsyscall and libgcc equal
// the PoC's files converted to schema 3 (bench/tools/convert-poc-signatures.ts, run as a child process), apart from
// builtWith and the names the spec reviews. Needs the tuning ROMs, ELFs and maps of the references and the PoC
// checkout; a missing input makes the test `unavailable`, or fails it with ROMLIFT_REQUIRE_LOCAL=1.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { signatureFileText, type SignatureFile, type SignatureSpec } from 'romlift';
import { buildSignatures, readSignatureSpec } from 'romlift/node';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const POC_ENV = process.env['ROMLIFT_POC'];
const POC_ROOT = POC_ENV ? path.resolve(REPO, POC_ENV) : path.join(BENCH_ROOT, 'romlift-poc');
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const SPECS = path.join(REPO, 'signatures', 'specs');
const POC_LIBRARIES = ['libagbsyscall', 'libgcc', 'm4a'];
const TMP = mkdtempSync(path.join(tmpdir(), 'romlift-local-signatures-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The ROM, ELF and map paths of a dataset that are missing here. */
function missingInputs(dataset: string): readonly string[] {
  const json = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${dataset}.json`), 'utf8')) as Record<string, unknown>;
  return ['rom', 'elf', 'map'].map((k) => path.join(BENCH_ROOT, String(json[k]))).filter((p) => !existsSync(p));
}

/** The text of a file with builtWith left out and `spec`'s reviewed names applied, for the PoC comparison. */
function comparable(file: SignatureFile, spec?: SignatureSpec): string {
  const rename = <M extends { readonly id: string; readonly name: string }>(m: M): M => ({ ...m, name: spec?.reviewedNames[m.id as keyof SignatureSpec['reviewedNames']]?.name ?? m.name });
  const versions = file.versions.map((v) => ({ ...v, functions: v.functions.map(rename), tables: v.tables.map(rename) }));
  return signatureFileText({ ...file, builtWith: '-', versions });
}

const specFiles = readdirSync(SPECS).filter((f) => f.endsWith('.json')).sort(byCodeUnit);
let converted: string | undefined;

for (const name of specFiles) {
  const library = name.replace(/\.json$/, '');
  const specText = JSON.parse(readFileSync(path.join(SPECS, name), 'utf8')) as { readonly versions: readonly { readonly references: readonly { readonly dataset: string }[] }[] };
  const missing = [...new Set(specText.versions.flatMap((v) => v.references.map((r) => r.dataset)))].flatMap(missingInputs);
  const needsPoc = POC_LIBRARIES.includes(library);
  if (needsPoc && !existsSync(path.join(POC_ROOT, 'signatures', name))) missing.push(path.join(POC_ROOT, 'signatures', name));
  const unavailable = missing.length === 0 ? undefined : `unavailable: ${missing.join(', ')}`;
  test(`signatures rebuild: ${library} builds twice identically${needsPoc ? " and equals the PoC's converted file" : ''}`, { skip: REQUIRE ? false : (unavailable ?? false) }, async () => {
    assert.equal(unavailable, undefined, unavailable);
    const specPath = path.join(SPECS, name);
    const first = await buildSignatures({ specPath }, { benchRoot: BENCH_ROOT });
    const second = await buildSignatures({ specPath }, { benchRoot: BENCH_ROOT });
    assert.ok(first.ok, JSON.stringify(first.ok ? [] : first.diagnostics));
    assert.ok(second.ok);
    assert.equal(signatureFileText(first.value), signatureFileText(second.value));
    assert.equal(first.value.schema, 3);
    if (!needsPoc) return;
    if (converted === undefined) {
      converted = path.join(TMP, 'poc');
      execFileSync(process.execPath, ['--conditions=source', path.join(REPO, 'bench', 'tools', 'convert-poc-signatures.ts'), '--out', converted], {
        cwd: REPO,
        env: { ...process.env, ROMLIFT_BENCH_ROOT: BENCH_ROOT, ROMLIFT_POC: POC_ROOT },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    const poc = JSON.parse(readFileSync(path.join(converted, name), 'utf8')) as SignatureFile;
    const spec = await readSignatureSpec(specPath);
    assert.ok(spec.ok);
    assert.equal(comparable(first.value), comparable(poc, spec.value));
  });
}
