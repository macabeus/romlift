// `romlift model --rom <rom> [--json]` (architecture §2.1, §3.4): --json is exactly encodeModel's NDJSON of the
// model generate emits (the confirm run over the config configFromDiscover builds), then the analysis diagnostics
// and the summary; text mode a module table and the counts; exit 0, 1 (unreadable, not a cartridge) and 2 (usage);
// and a run with stdin closed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { encodeModel, MODEL_JSON_SCHEMA } from '../../../src/core/model/codec.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { confirmModel } from '../../../src/core/workflow/generate.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FAR_JUMP = listSyntheticFixtures().find((f) => f.name === 'far-jump');
if (FAR_JUMP === undefined) throw new Error('the far-jump fixture is missing');
const TMP = mkdtempSync(join(tmpdir(), 'romlift-model-test-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

async function run(argv: readonly string[]): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = capturingIo();
  const code = await main(argv, io);
  return { code, stdout: io.out.join(''), stderr: io.err.join('') };
}

function lines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((text) => JSON.parse(text) as Record<string, unknown>);
}

test('model --json prints encodeModel of the model generate emits, then the summary with its counts', async () => {
  const out = await run(['model', '--rom', FAR_JUMP.rom, '--json']);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  const rom = readFixtureRom(FAR_JUMP);
  const { model } = confirmModel({ rom, config: configFromDiscover(rom, discover(rom)) });
  const encoded = [...encodeModel(model, rom)].join('');
  assert.ok(out.stdout.startsWith(encoded));
  const parsed = lines(out.stdout);
  assert.equal(parsed[0]?.['schema'], MODEL_JSON_SCHEMA);
  assert.equal(parsed.length, 1 + model.chunks.length + 1);
  assert.deepEqual(parsed.at(-1), {
    type: 'summary',
    ok: true,
    exitCode: 0,
    counts: { chunks: model.chunks.length, functions: model.functions.length, items: model.items.count, modules: model.modules.length },
  });
});

test('model text: one row per module and the summary', async () => {
  const out = await run(['model', '--rom', FAR_JUMP.rom]);
  assert.equal(out.code, ExitCode.ok);
  assert.match(out.stdout, /^module {6}kind {2}span {20}chunks {2}compiler\nrom_header {2}asm {3}0x08000000\.\.0x080000C0 {2}1 {7}agbcc\n/);
  assert.match(out.stdout, /\nmodel: ok \(exit 0\): chunks \d+, functions \d+, items \d+, modules 3\n$/);
});

test('usage errors exit 2; no project, an unreadable ROM and an image that is not a cartridge exit 1 with a summary', async () => {
  const missing = await run(['model', '--json']);
  assert.equal(missing.code, ExitCode.errors);
  assert.equal(lines(missing.stdout)[0]?.['code'], 'E_PROJECT_NOT_FOUND');
  assert.equal((await run(['model', 'x.gba', '--rom', FAR_JUMP.rom])).code, ExitCode.usage);
  assert.equal((await run(['model', '--rom', FAR_JUMP.rom, '--link'])).code, ExitCode.usage);
  const absent = await run(['model', '--rom', join(TMP, 'absent.gba'), '--json']);
  assert.equal(absent.code, ExitCode.errors);
  assert.equal(lines(absent.stdout)[0]?.['code'], 'E_IO_READ');
  assert.deepEqual(lines(absent.stdout).at(-1), { type: 'summary', ok: false, exitCode: 1 });
  const file = join(TMP, 'not-a-rom.gba');
  writeFileSync(file, new Uint8Array(0x40));
  const out = await run(['model', '--rom', file, '--json']);
  assert.equal(out.code, ExitCode.errors);
  assert.equal(lines(out.stdout)[0]?.['code'], 'E_ROM_NOT_GBA');
  assert.deepEqual(lines(out.stdout).at(-1), { type: 'summary', ok: false, exitCode: 1 });
});

test('a child process with stdin closed: every line JSON, the summary last with the exit code', () => {
  const result = spawnSync(process.execPath, ['--conditions=source', 'src/cli/main.ts', 'model', '--rom', FAR_JUMP.rom, '--json'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = lines(result.stdout);
  assert.deepEqual(parsed.at(-1)?.['type'], 'summary');
  assert.equal(parsed.at(-1)?.['exitCode'], 0);
});

// Phase 4: model inside a project (its ROM and romlift.toml), without --rom.

test('inside a project model --json is encodeModel of the confirm run over its romlift.toml, names included', async () => {
  const dir = mkdtempSync(join(TMP, 'project-'));
  writeFileSync(join(dir, 'baserom.gba'), readFileSync(FAR_JUMP.rom));
  assert.equal(await main(['init', 'baserom.gba'], { ...capturingIo(), cwd: dir }), ExitCode.ok);
  const file = join(dir, 'romlift.toml');
  writeFileSync(file, readFileSync(file, 'utf8').replace('"sub_08000104"', '"FarJumpCaller"'));
  const io = { ...capturingIo(), cwd: dir };
  assert.equal(await main(['model', '--json'], io), ExitCode.ok);
  const parsed = lines(io.out.join(''));
  const header = parsed[0] as { readonly functions?: readonly { readonly name?: string }[] };
  assert.ok(header.functions?.some((f) => f.name === 'FarJumpCaller'));
  assert.equal(parsed.at(-1)?.['type'], 'summary');
  const rom = readFixtureRom(FAR_JUMP);
  const plain = await run(['model', '--rom', FAR_JUMP.rom, '--json']);
  assert.equal(lines(plain.stdout).length, parsed.length, 'the same chunks as the bare ROM');
  assert.ok(!plain.stdout.includes('FarJumpCaller'));
  assert.equal(rom.sha1.length, 40);
});
