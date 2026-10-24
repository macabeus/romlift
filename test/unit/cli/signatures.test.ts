// `romlift signatures build <spec> [--out <dir>] [--json]` (architecture §2.1, §7.1, roadmap 6.A): in process through
// `main`. The fixture spec builds <out>/libfix.json, the golden apart from builtWith, with one version line and the
// summary; the default --out is the spec's repository's signatures/; a missing spec exits 1 with the summary; any
// other first positional is the matcher's `signatures <rom>`, a usage error until p6-signatures-match lands it.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MATCHER_PENDING } from '../../../src/cli/commands/signatures.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { capturingIo } from './fake.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const LIBRARY = join(REPO, 'bench', 'dataset', 'synthetic', 'library');
const SPEC = join(LIBRARY, 'spec.json');
const GOLDEN = JSON.parse(readFileSync(join(LIBRARY, 'signatures.golden.json'), 'utf8')) as { readonly builtWith: string };
const TMP = mkdtempSync(join(tmpdir(), 'romlift-cli-signatures-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

async function run(argv: readonly string[], cwd: string = REPO): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = { ...capturingIo(), cwd };
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { ...io, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

function lines(stdout: string): readonly Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const withoutBuiltWith = (text: string): unknown => ({ ...(JSON.parse(text) as Record<string, unknown>), builtWith: GOLDEN.builtWith });

test('signatures build <spec> --out <dir> --json: the file, one version line, the summary', async () => {
  const out = join(TMP, 'json');
  const result = await run(['signatures', 'build', SPEC, '--out', out, '--json']);
  assert.equal(result.code, ExitCode.ok, result.stderr);
  assert.deepEqual(lines(result.stdout), [
    { type: 'version', library: 'libfix', version: '1.0', functions: 13, tables: 1, references: ['library', 'library-ref2'] },
    { type: 'summary', ok: true, exitCode: 0, counts: { diagnostics: 0, functions: 13, tables: 1, versions: 1, written: 1 } },
  ]);
  assert.deepEqual(withoutBuiltWith(readFileSync(join(out, 'libfix.json'), 'utf8')), GOLDEN);
});

test('signatures build in text: the version line, the file written, the summary; a relative spec resolves against the cwd', async () => {
  const out = join(TMP, 'text');
  const result = await run(['signatures', 'build', 'bench/dataset/synthetic/library/spec.json', '--out', out]);
  assert.equal(result.code, ExitCode.ok, result.stderr);
  assert.equal(
    result.stdout,
    [
      'libfix 1.0: 13 functions, 1 tables from library, library-ref2',
      `wrote ${join(out, 'libfix.json')}`,
      'signatures build: ok (exit 0): diagnostics 0, functions 13, tables 1, versions 1, written 1',
      '',
    ].join('\n'),
  );
});

test("without --out the file goes to the spec's repository's signatures/", async () => {
  const repo = join(TMP, 'repo');
  mkdirSync(join(repo, 'bench', 'dataset', 'real'), { recursive: true });
  mkdirSync(join(repo, 'signatures', 'specs'), { recursive: true });
  const at = (ext: string): string => join(LIBRARY, 'build', `library.${ext}`);
  const dataset = { rom: at('gba'), elf: at('elf'), map: at('map'), sha1: sha1Of(new Uint8Array(readFileSync(at('gba')))), elfCommit: 'c0ffee1', heldout: false, revealed: [] };
  writeFileSync(join(repo, 'bench', 'dataset', 'real', 'lib.json'), JSON.stringify(dataset));
  const spec = { library: 'libfix', versions: [{ id: '1', idNote: '', references: [{ dataset: 'lib', objects: ['fix_*.o'] }] }], reviewedNames: {} };
  writeFileSync(join(repo, 'signatures', 'specs', 'libfix.json'), JSON.stringify(spec));
  const result = await run(['signatures', 'build', 'signatures/specs/libfix.json', '--json'], repo);
  assert.equal(result.code, ExitCode.ok, result.stderr);
  const file = JSON.parse(readFileSync(join(repo, 'signatures', 'libfix.json'), 'utf8')) as { readonly versions: readonly { readonly references: readonly unknown[] }[] };
  assert.deepEqual(file.versions[0]?.references, [{ commit: 'c0ffee1', dataset: 'lib', romSha1: dataset.sha1 }]);
});

test('a spec that does not exist: exit 1, its E_IO_READ and the summary, nothing written', async () => {
  const out = join(TMP, 'none');
  const result = await run(['signatures', 'build', 'romlift-no-such-spec.json', '--out', out, '--json']);
  assert.equal(result.code, ExitCode.errors);
  const all = lines(result.stdout);
  assert.deepEqual(all.map((l) => [l['type'], l['code']]), [['diagnostic', 'E_IO_READ'], ['summary', undefined]]);
  assert.deepEqual(all.at(-1), { type: 'summary', ok: false, exitCode: 1, counts: { diagnostics: 1, functions: 0, tables: 0, versions: 0, written: 0 } });
});

test('signatures <rom> is the matcher (wave 3): a usage error that says so; build without <spec> is one too', async () => {
  const rom = await run(['signatures', 'baserom.gba', '--json']);
  assert.equal(rom.code, ExitCode.usage);
  assert.ok(rom.stderr.includes(MATCHER_PENDING), rom.stderr);
  const bare = await run(['signatures', 'build']);
  assert.equal(bare.code, ExitCode.usage);
  assert.match(bare.stderr, /build needs <spec>/);
  assert.equal((await run(['signatures', 'build', SPEC, 'extra'])).code, ExitCode.usage);
});
