// `romlift generate [--rom] [--dry-run] [--json] [--out]` (architecture §2.1, §6.4) in temporary projects made by
// `init`: right after init the dry run is keep only and the run changes no file or modification time; a deleted asm/
// is written again; --out writes elsewhere and leaves the project alone; romlift.toml is never written; the refusals
// (an illegal border, a misspelt key, another ROM, no project, a held lock) exit 1 and change nothing; --rom reads
// another copy of the right ROM; generate works from a subdirectory.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-cli-generate-'));
after(() => rm(TMP, { recursive: true, force: true }));
const FIXTURES = listSyntheticFixtures();
const COMPOSITE = FIXTURES.find((f) => f.name === 'composite') ?? assert.fail('composite');
const FAR_JUMP = FIXTURES.find((f) => f.name === 'far-jump') ?? assert.fail('far-jump');
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

async function initProject(rom: string = COMPOSITE.rom, args: readonly string[] = ['--module-size', '0x200']): Promise<string> {
  const dir = path.join(TMP, `p${fresh++}`);
  await mkdir(dir, { recursive: true });
  await copyFile(rom, path.join(dir, 'baserom.gba'));
  const out = await run(dir, ['init', 'baserom.gba', ...args]);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  return dir;
}

async function snapshot(dir: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) for (const [k, v] of await snapshot(dir, relative)) out.set(k, v);
    else out.set(relative, `${(await readFile(path.join(dir, relative))).toString('base64')} ${(await stat(path.join(dir, relative))).mtimeMs}`);
  }
  return out;
}

test('right after init: the dry run is keep only, and generate changes no file, manifest included, nor its modification time', async () => {
  const dir = await initProject();
  const before = await snapshot(dir);
  const dry = await run(dir, ['generate', '--dry-run', '--json']);
  assert.equal(dry.code, ExitCode.ok, dry.stdout);
  const parsed = lines(dry.stdout);
  const ops = parsed.filter((l) => l['type'] === 'op');
  assert.ok(ops.length > 0);
  assert.deepEqual([...new Set(ops.map((l) => l['op']))], ['keep']);
  assert.deepEqual(Object.keys(ops[0] ?? {}).sort(), ['op', 'path', 'type']);
  assert.equal(parsed.at(-1)?.['type'], 'summary');
  const real = await run(dir, ['generate', '--json']);
  assert.equal(real.code, ExitCode.ok, real.stdout);
  assert.deepEqual(lines(real.stdout).map((l) => l['type']), ['summary']);
  assert.deepEqual(await snapshot(dir), before);
});

test('a deleted asm/ is written again, the TOML untouched; from a subdirectory too; text mode lists the writes', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  const toml = await stat(path.join(dir, 'romlift.toml'));
  const asm = await snapshot(dir, 'asm');
  await rm(path.join(dir, 'asm'), { recursive: true });
  await mkdir(path.join(dir, 'src', 'deeper'), { recursive: true });
  const out = await run(path.join(dir, 'src', 'deeper'), ['generate']);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  assert.match(out.stdout, /^write  asm\//m);
  assert.match(out.stdout, /^generate: ok \(exit 0\): /m);
  const again = await snapshot(dir, 'asm');
  assert.deepEqual([...again.keys()], [...asm.keys()]);
  for (const [k, v] of asm) assert.equal(again.get(k)?.split(' ')[0], v.split(' ')[0], k);
  const after = await stat(path.join(dir, 'romlift.toml'));
  assert.deepEqual([after.ino, after.mtimeMs], [toml.ino, toml.mtimeMs]);
});

test('--out writes the tree into another directory and leaves the project alone', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  const before = await snapshot(dir);
  const out = path.join(TMP, `out-${fresh++}`);
  const run1 = await run(dir, ['generate', '--out', out, '--json']);
  assert.equal(run1.code, ExitCode.ok, run1.stdout);
  assert.deepEqual(await snapshot(dir), before);
  assert.ok((await stat(path.join(out, 'ldscript.txt'))).isFile());
  assert.ok((await stat(path.join(out, 'src', 'main.c'))).isFile());
  assert.ok((await stat(path.join(out, '.romlift', 'manifest.json'))).isFile());
});

test("the composite's illegal border is E_MODULE_BORDER (exit 1), and no file changes", async () => {
  const dir = await initProject();
  const expect = JSON.parse(await readFile(COMPOSITE.expect, 'utf8')) as { readonly illegalBorder: { readonly module: string; readonly start: string } };
  const file = path.join(dir, 'romlift.toml');
  const text = await readFile(file, 'utf8');
  const blocks = text.split('[[modules]]');
  const at = blocks.findIndex((b) => b.includes(`name = "${expect.illegalBorder.module}"`));
  assert.ok(at > 0);
  blocks[at] = (blocks[at] ?? '').replace(/start = 0x[0-9A-F]{8}/, `start = ${expect.illegalBorder.start}`);
  await writeFile(file, blocks.join('[[modules]]'));
  const before = await snapshot(dir);
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.errors);
  const parsed = lines(out.stdout);
  assert.ok(parsed.some((l) => l['code'] === 'E_MODULE_BORDER'));
  assert.deepEqual(parsed.at(-1), { type: 'summary', ok: false, exitCode: 1 });
  assert.deepEqual(await snapshot(dir), before);
});

test('a misspelt key and a repeated entry are refused with their codes (exit 1), and no file changes', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  const file = path.join(dir, 'romlift.toml');
  const text = await readFile(file, 'utf8');
  const line = text.split('\n').find((l) => /^0x0[0-9A-F]{7} = /.test(l)) ?? assert.fail('no entry');
  for (const [edited, code] of [
    [text.replace(line, line.replace(/^0x0/, '0x')), 'E_TOML_KEY_SPELLING'],
    [text.replace(line, `${line}\n${line}`), 'E_DUPLICATE_ADDRESS'],
  ] as const) {
    await writeFile(file, edited);
    const before = await snapshot(dir);
    const out = await run(dir, ['generate', '--json']);
    assert.equal(out.code, ExitCode.errors, code);
    assert.ok(lines(out.stdout).some((l) => l['code'] === code), code);
    assert.deepEqual(await snapshot(dir), before, code);
  }
});

test('another ROM is E_ROM_SHA1_MISMATCH; --rom reads another copy of the right one; no project is E_PROJECT_NOT_FOUND', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  await copyFile(COMPOSITE.rom, path.join(dir, 'baserom.gba'));
  const other = await run(dir, ['generate', '--json']);
  assert.equal(other.code, ExitCode.errors);
  assert.equal(lines(other.stdout)[0]?.['code'], 'E_ROM_SHA1_MISMATCH');
  const right = await run(dir, ['generate', '--rom', FAR_JUMP.rom, '--dry-run', '--json']);
  assert.equal(right.code, ExitCode.ok, right.stdout);
  const nowhere = path.join(TMP, `none-${fresh++}`);
  await mkdir(nowhere);
  const none = await run(nowhere, ['generate', '--json']);
  assert.equal(none.code, ExitCode.errors);
  assert.equal(lines(none.stdout)[0]?.['code'], 'E_PROJECT_NOT_FOUND');
});

test('a project another live run holds is E_PROJECT_LOCKED (exit 1); the dry run plans regardless', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  await writeFile(path.join(dir, '.romlift', 'lock'), `${JSON.stringify({ host: hostname(), pid: process.pid })}\n`);
  await rm(path.join(dir, 'ldscript.txt'));
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.errors);
  assert.ok(lines(out.stdout).some((l) => l['code'] === 'E_PROJECT_LOCKED'));
  await assert.rejects(stat(path.join(dir, 'ldscript.txt')));
  const dry = await run(dir, ['generate', '--dry-run', '--json']);
  assert.equal(dry.code, ExitCode.ok);
  assert.ok(lines(dry.stdout).some((l) => l['type'] === 'op' && l['op'] === 'write' && l['path'] === 'ldscript.txt'));
});

test('generate takes no positional and no stdin; --help prints its usage', async () => {
  assert.equal((await run(TMP, ['generate', 'extra'])).code, ExitCode.usage);
  const help = await run(TMP, ['generate', '--help']);
  assert.equal(help.code, ExitCode.ok);
  assert.match(help.stdout, /^Usage: romlift generate \[--rom <rom>\] \[--dry-run\] \[--json\] \[--out <dir>\]/);
});
