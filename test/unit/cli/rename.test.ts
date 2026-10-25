// `romlift rename <old> <new> [--json]` (architecture §2.1, §6.6, D92) in a project init wrote: exit 0 with NDJSON edit
// lines, the patch line and the summary; exit 1 on a refusal, which changes nothing; exit 2 on a usage error; the text
// output names each edited file and the TOML.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-cli-rename-'));
after(() => rm(TMP, { recursive: true, force: true }));
const COMPOSITE = listSyntheticFixtures().find((f) => f.name === 'composite') ?? assert.fail('composite');
let fresh = 0;

async function run(cwd: string, argv: readonly string[]): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = { ...capturingIo(), cwd };
  const code = await main(argv, io);
  return { code, stdout: io.out.join(''), stderr: io.err.join('') };
}

function lines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((text) => JSON.parse(text) as Record<string, unknown>);
}

async function project(): Promise<{ readonly dir: string; readonly names: readonly string[] }> {
  const dir = path.join(TMP, `p${fresh++}`);
  await mkdir(dir, { recursive: true });
  await copyFile(COMPOSITE.rom, path.join(dir, 'baserom.gba'));
  const init = await run(dir, ['init', 'baserom.gba']);
  assert.equal(init.code, ExitCode.ok, init.stderr);
  const main = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  return { dir, names: [...main.matchAll(/INCLUDE_ASM\("asm\/nonmatchings\/main", (sub_[0-9A-F]{8})\);/g)].map((m) => m[1] ?? '') };
}

test('rename --json: one edit line per file, the patch line, then the summary; exit 0', async () => {
  const { dir, names } = await project();
  const [old = ''] = names;
  const out = await run(dir, ['rename', old, 'GameInit', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  const records = lines(out.stdout);
  assert.deepEqual(records.slice(0, -1), [
    { type: 'edit', path: 'src/main.c', op: 'edit', identifiers: 1 },
    { type: 'patch', path: 'romlift.toml', written: true },
  ]);
  assert.deepEqual(records.at(-1), { type: 'summary', ok: true, exitCode: 0, counts: { files: 1, identifiers: 1, toml: 1, diagnostics: 0 } });
  assert.ok((await readFile(path.join(dir, 'romlift.toml'), 'utf8')).includes('"GameInit"'));
});

test('rename in text: the edited files and the TOML, then the summary', async () => {
  const { dir, names } = await project();
  const out = await run(dir, ['rename', names[1] ?? '', 'GameLoop']);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  assert.equal(out.stdout, 'edit   src/main.c (1 identifier)\npatch  romlift.toml\nrename: ok (exit 0): diagnostics 0, files 1, identifiers 1, toml 1\n');
});

test('a refusal exits 1, prints its diagnostic and the summary, and changes nothing', async () => {
  const { dir, names } = await project();
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const c = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  for (const [args, code] of [
    [['NoSuchName', 'X'], 'E_RENAME_UNKNOWN'],
    [[names[0] ?? '', names[1] ?? ''], 'E_RENAME_EXISTS'],
    [[names[0] ?? '', '9lives'], 'E_RENAME_INVALID'],
  ] as const) {
    const out = await run(dir, ['rename', ...args, '--json']);
    assert.equal(out.code, ExitCode.errors, args.join(' '));
    const records = lines(out.stdout);
    assert.deepEqual(records.filter((r) => r['type'] === 'diagnostic').map((r) => r['code']), [code]);
    assert.deepEqual(records.at(-1), { type: 'summary', ok: false, exitCode: 1, counts: { files: 0, identifiers: 0, toml: 0, diagnostics: 1 } });
    assert.ok(!records.some((r) => r['type'] === 'edit'));
  }
  const text = await run(dir, ['rename', 'NoSuchName', 'X']);
  assert.equal(text.code, ExitCode.errors);
  assert.match(text.stderr, /E_RENAME_UNKNOWN/);
  assert.equal(await readFile(path.join(dir, 'romlift.toml'), 'utf8'), toml);
  assert.equal(await readFile(path.join(dir, 'src', 'main.c'), 'utf8'), c);
});

test('usage: a missing or an extra positional, an unknown option exit 2; --help prints the usage', async () => {
  const dir = path.join(TMP, `u${fresh++}`);
  await mkdir(dir);
  for (const argv of [['rename'], ['rename', 'A'], ['rename', 'A', 'B', 'C'], ['rename', 'A', 'B', '--nope']]) {
    assert.equal((await run(dir, argv)).code, ExitCode.usage, argv.join(' '));
  }
  const help = await run(dir, ['rename', '--help']);
  assert.equal(help.code, ExitCode.ok);
  assert.ok(help.stdout.startsWith('Usage: romlift rename <old> <new> [--json]'), help.stdout);
  const none = await run(dir, ['rename', 'A', 'B', '--json']);
  assert.equal(none.code, ExitCode.errors);
  assert.equal(lines(none.stdout)[0]?.['code'], 'E_PROJECT_NOT_FOUND');
});
