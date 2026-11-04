// bench/tools/signatures.ts, `npm run signatures -- build <spec> [--out <dir>] [--json]` (D108), as a child process: the
// fixture spec builds <out>/libfix.json, the golden apart from builtWith, with one version line and the summary; a
// relative spec resolves against the cwd; the default --out is the spec's repository's signatures/; a missing spec
// exits 1; a bad command line exits 2.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { sha1Of } from '../../../src/shell/hash.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TOOL = join(REPO, 'bench', 'tools', 'signatures.ts');
const LIBRARY = join(REPO, 'bench', 'dataset', 'synthetic', 'library');
const SPEC = join(LIBRARY, 'spec.json');
const GOLDEN = JSON.parse(readFileSync(join(LIBRARY, 'signatures.golden.json'), 'utf8')) as { readonly builtWith: string };
const TMP = mkdtempSync(join(tmpdir(), 'romlift-signatures-tool-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

function run(args: readonly string[], cwd: string = REPO): { readonly code: number | null; readonly stdout: string; readonly stderr: string } {
  const ran = spawnSync(process.execPath, ['--conditions=source', TOOL, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ROMLIFT_BENCH_ROOT: '' } });
  return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

function lines(stdout: string): readonly Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const withoutBuiltWith = (text: string): unknown => ({ ...(JSON.parse(text) as Record<string, unknown>), builtWith: GOLDEN.builtWith });

test('build <spec> --out <dir> --json: the file, one version line, the summary', () => {
  const out = join(TMP, 'json');
  const result = run(['build', SPEC, '--out', out, '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(lines(result.stdout), [
    { type: 'version', library: 'libfix', version: '1.0', functions: 13, tables: 1, references: ['library', 'library-ref2'] },
    { type: 'summary', ok: true, exitCode: 0 },
  ]);
  assert.deepEqual(withoutBuiltWith(readFileSync(join(out, 'libfix.json'), 'utf8')), GOLDEN);
});

test('build in text: the version line and the file written; a relative spec resolves against the cwd', () => {
  const out = join(TMP, 'text');
  const result = run(['build', 'bench/dataset/synthetic/library/spec.json', '--out', out]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ['libfix 1.0: 13 functions, 1 tables from library, library-ref2', `wrote ${join(out, 'libfix.json')}`, ''].join('\n'));
});

test("without --out the file goes to the spec's repository's signatures/", () => {
  const repo = join(TMP, 'repo');
  mkdirSync(join(repo, 'bench', 'dataset', 'real'), { recursive: true });
  mkdirSync(join(repo, 'signatures', 'specs'), { recursive: true });
  const at = (ext: string): string => join(LIBRARY, 'build', `library.${ext}`);
  const dataset = { rom: at('gba'), elf: at('elf'), map: at('map'), sha1: sha1Of(new Uint8Array(readFileSync(at('gba')))), elfCommit: 'c0ffee1', heldout: false, revealed: [] };
  writeFileSync(join(repo, 'bench', 'dataset', 'real', 'lib.json'), JSON.stringify(dataset));
  const spec = { library: 'libfix', versions: [{ id: '1', idNote: '', references: [{ dataset: 'lib', objects: ['fix_*.o'] }] }], reviewedNames: {} };
  writeFileSync(join(repo, 'signatures', 'specs', 'libfix.json'), JSON.stringify(spec));
  const result = run(['build', 'signatures/specs/libfix.json', '--json'], repo);
  assert.equal(result.code, 0, result.stderr);
  const file = JSON.parse(readFileSync(join(repo, 'signatures', 'libfix.json'), 'utf8')) as { readonly versions: readonly { readonly references: readonly unknown[] }[] };
  assert.deepEqual(file.versions[0]?.references, [{ commit: 'c0ffee1', dataset: 'lib', romSha1: dataset.sha1 }]);
});

test('a spec that does not exist: exit 1, its E_IO_READ and the summary, nothing written', () => {
  const result = run(['build', 'romlift-no-such-spec.json', '--out', join(TMP, 'none'), '--json']);
  assert.equal(result.code, 1);
  const all = lines(result.stdout);
  assert.deepEqual(all.map((l) => [l['type'], l['code']]), [['diagnostic', 'E_IO_READ'], ['summary', undefined]]);
  assert.deepEqual(all.at(-1), { type: 'summary', ok: false, exitCode: 1 });
});

test('usage errors exit 2: no verb, another verb, build without <spec>, an unknown option', () => {
  for (const args of [[], ['place', SPEC], ['build'], ['build', SPEC, '--nope']]) {
    const result = run(args);
    assert.equal(result.code, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, /usage: npm run signatures -- build <spec>/);
  }
});
