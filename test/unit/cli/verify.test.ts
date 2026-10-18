// `romlift verify --rom <rom> [--assemble] [--link] [--printer raw] [--json]` (architecture §2.1, §6.4): the
// NDJSON contract the g3 gates freeze (check lines in CHECK_IDS order, diagnostics, the summary last, its exit
// code the process's), the exit codes (0 ok, 3 a failed check, 1 an error diagnostic of the input or the
// toolchain, 2 usage), the toolchain checks in a temporary directory that link to the ROM's SHA-1, and a run
// with stdin closed. In process through `main` with a capturing CliIo, except the one child process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { toolchainChecks, verifyExitCode, verifyNdjson, verifyText, VERIFY_TEMP_PREFIX } from '../../../src/cli/commands/verify.ts';
import type { VerifyOutcome } from '../../../src/cli/commands/verify.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import type { Printer } from '../../../src/core/emit/tree.ts';
import { CHECK_IDS, checkResult } from '../../../src/core/verify/report.ts';
import type { CheckResult } from '../../../src/core/verify/report.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { generate, generatedEntries } from '../../../src/core/workflow/generate.ts';
import { diagnostic } from '../../../src/foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { ShellCodes } from '../../../src/shell/codes.ts';
import { findBinutils } from '../../../src/shell/toolchain/binutils.ts';
import { VerifyCodes } from '../../../src/core/verify/codes.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = listSyntheticFixtures();
const FAR_JUMP = FIXTURES.find((f) => f.name === 'far-jump');
if (FAR_JUMP === undefined) throw new Error('the far-jump fixture is missing');
const TMP = mkdtempSync(join(tmpdir(), 'romlift-verify-test-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
const tools = findBinutils(process.env);
const noToolchain = 'code' in tools ? 'unavailable: toolchain' : false;
const PRINTERS: readonly Printer[] = ['readable', 'raw'];
const SELF_CHECKS = CHECK_IDS.filter((id) => id !== 'assemble' && id !== 'link');


async function run(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = {}): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = { ...capturingIo(), env };
  const code = await main(argv, io);
  return { code, stdout: io.out.join(''), stderr: io.err.join('') };
}

function lines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((text) => JSON.parse(text) as Record<string, unknown>);
}

/** The NDJSON contract of the g3 gates: check lines first, in CHECK_IDS order, then diagnostics, then the summary. */
function assertContract(stdout: string, code: ExitCode): Record<string, unknown>[] {
  const parsed = lines(stdout);
  const summary = parsed.at(-1);
  assert.equal(summary?.['type'], 'summary');
  assert.equal(summary?.['exitCode'], code);
  assert.equal(summary?.['ok'], code === ExitCode.ok);
  const types = parsed.map((l) => l['type']);
  const firstNonCheck = types.findIndex((t) => t !== 'check');
  assert.ok(types.slice(firstNonCheck, -1).every((t) => t === 'diagnostic'), types.join(','));
  const ids = parsed.filter((l) => l['type'] === 'check').map((l) => l['id']);
  assert.deepEqual(ids, CHECK_IDS.filter((id) => ids.includes(id)));
  for (const l of parsed.filter((x) => x['type'] === 'check')) {
    assert.ok(l['status'] === 'ok' || l['status'] === 'fail');
    assert.equal(typeof l['detail'], 'string');
  }
  return parsed;
}

function outcomeWith(checks: readonly CheckResult[], diagnostics: VerifyOutcome['diagnostics'] = []): VerifyOutcome {
  return { report: { ok: checks.every((c) => c.ok), checks }, diagnostics, files: 3 };
}

test('verify without --rom, with an unknown printer, or an unknown option is a usage error (exit 2)', async () => {
  const missing = await run(['verify', '--json']);
  assert.equal(missing.code, ExitCode.usage);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /verify: needs --rom <rom>/);
  const printer = await run(['verify', '--rom', FAR_JUMP.rom, '--printer', 'pretty']);
  assert.equal(printer.code, ExitCode.usage);
  assert.match(printer.stderr, /--printer is 'readable' or 'raw', not 'pretty'/);
  assert.equal((await run(['verify', '--rom', FAR_JUMP.rom, '--no-such-option'])).code, ExitCode.usage);
  assert.equal((await run(['verify', 'positional', '--rom', FAR_JUMP.rom])).code, ExitCode.usage);
});

test('an unreadable ROM and an image that is not a cartridge are error diagnostics (exit 1), with a summary', async () => {
  const absent = await run(['verify', '--rom', join(TMP, 'absent.gba'), '--json']);
  assert.equal(absent.code, ExitCode.errors);
  const parsedAbsent = lines(absent.stdout);
  assert.equal(parsedAbsent[0]?.['code'], 'E_IO_READ');
  assert.deepEqual(parsedAbsent.at(-1), { type: 'summary', ok: false, exitCode: 1 });
  const file = join(TMP, 'not-a-rom.gba');
  writeFileSync(file, new Uint8Array(0x40));
  const out = await run(['verify', '--rom', file, '--json']);
  assert.equal(out.code, ExitCode.errors);
  const parsed = lines(out.stdout);
  assert.equal(parsed[0]?.['code'], 'E_ROM_NOT_GBA');
  assert.deepEqual(parsed.at(-1), { type: 'summary', ok: false, exitCode: 1 });
  const text = await run(['verify', '--rom', file]);
  assert.equal(text.code, ExitCode.errors);
  assert.match(text.stderr, /^E_ROM_NOT_GBA error/);
  assert.match(text.stdout, /^verify: failed \(exit 1\)\n$/);
});

test('verify --json on a fixture: the five self-checks in order, every line JSON, the summary last with the exit code', async () => {
  for (const printer of PRINTERS) {
    const out = await run(['verify', '--rom', FAR_JUMP.rom, '--printer', printer, '--json']);
    assert.ok(out.code === ExitCode.ok || out.code === ExitCode.verifyFailed, `exit ${out.code}: ${out.stderr}`);
    const parsed = assertContract(out.stdout, out.code);
    assert.deepEqual(
      parsed.filter((l) => l['type'] === 'check').map((l) => l['id']),
      SELF_CHECKS,
    );
    for (const id of ['tiling', 'reencode', 'module-size', 'text-layout']) assert.equal(parsed.find((l) => l['id'] === id)?.['status'], 'ok', `${printer} ${id}`);
    assert.equal(out.stderr, '');
  }
});

test('--link and --assemble are reported after the self-checks, and not run while a self-check fails', async () => {
  const out = await run(['verify', '--rom', FAR_JUMP.rom, '--assemble', '--link', '--json']);
  const parsed = assertContract(out.stdout, out.code);
  assert.deepEqual(
    parsed.filter((l) => l['type'] === 'check').map((l) => l['id']),
    [...SELF_CHECKS, 'assemble', 'link'],
  );
  const failedSelfCheck = parsed.some((l) => l['type'] === 'check' && SELF_CHECKS.includes(l['id'] as never) && l['status'] === 'fail');
  if (failedSelfCheck) {
    assert.equal(out.code, ExitCode.verifyFailed);
    assert.match(String(parsed.find((l) => l['id'] === 'link')?.['detail']), /^not run: /);
    assert.equal(parsed.at(-1)?.['sha1'], undefined);
  }
});

test('the exit code: 0 all ok; 3 a failed check (a self-check error, or a check without a diagnostic); 1 an error that is no self-check', () => {
  const ok = checkResult('tiling', [], 'fine');
  assert.equal(verifyExitCode(outcomeWith([ok])), ExitCode.ok);
  const text = checkResult('text-layout', [diagnostic(VerifyCodes, 'E_SELF_CHECK_TEXT', 'differs', { path: 'asm/x.s', addr: 0x0800_0000 })], 'differs');
  assert.equal(verifyExitCode(outcomeWith([ok, text])), ExitCode.verifyFailed);
  const link: CheckResult = { id: 'link', ok: false, detail: 'the image differs at 0x08000010', diagnostics: [] };
  assert.equal(verifyExitCode(outcomeWith([ok, link])), ExitCode.verifyFailed);
  const missing: CheckResult = { id: 'link', ok: false, detail: 'binutils not found', diagnostics: [diagnostic(ShellCodes, 'E_TOOLCHAIN_MISSING', 'not on the PATH')] };
  assert.equal(verifyExitCode(outcomeWith([ok, missing])), ExitCode.errors);
  const border = diagnostic(VerifyCodes, 'E_MODULE_SIZE', 'x');
  assert.equal(verifyExitCode(outcomeWith([ok], [{ ...border, code: 'E_MODULE_BORDER' }])), ExitCode.errors);
  assert.equal(verifyExitCode(outcomeWith([ok], [{ ...border, code: 'W_LISTED_INVALID', severity: 'warning' }])), ExitCode.ok);
});

test('an injected failing check prints status fail and its diagnostic, and exits 3; text mode says the same', () => {
  const failing = checkResult('paths', [diagnostic(VerifyCodes, 'E_PATH_CASE_COLLISION', 'the stream emits asm/a.s twice', { path: 'asm/a.s' })], 'the stream emits asm/a.s twice');
  const outcome = outcomeWith([checkResult('tiling', [], 'tiles'), failing]);
  const code = verifyExitCode(outcome);
  assert.equal(code, ExitCode.verifyFailed);
  const summary = { ok: false, exitCode: code, counts: { checks: 2 } } as const;
  const parsed = assertContract(verifyNdjson(outcome, summary), code);
  assert.deepEqual(parsed[1], { type: 'check', id: 'paths', status: 'fail', detail: 'the stream emits asm/a.s twice' });
  assert.equal(parsed[2]?.['code'], 'E_PATH_CASE_COLLISION');
  const text = verifyText(outcome, { ...summary, sha1: 'abc' });
  assert.match(text.stdout, /^tiling {2}ok {4}tiles\npaths {3}FAIL {2}the stream emits asm\/a\.s twice\nlinked SHA-1 abc\nverify: failed \(exit 3\): checks 2\n$/);
  assert.match(text.stderr, /^E_PATH_CASE_COLLISION error asm\/a\.s: the stream emits asm\/a\.s twice\n$/);
});

/** The fixture's config, as configFromDiscover builds it from the discover run. */
function discovered(rom: Rom): RomliftConfig {
  return configFromDiscover(rom, discover(rom));
}

test('the toolchain checks write the tree into a fresh temporary directory, assemble every module and link to the SHA-1', { skip: noToolchain }, async () => {
  const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith(VERIFY_TEMP_PREFIX)));
  for (const fixture of FIXTURES.filter((f) => ['far-jump', 'code-copied-to-ram', 'arm-pools-in-front', 'adr-label-and-data'].includes(f.name))) {
    const rom = readFixtureRom(fixture);
    for (const printer of PRINTERS) {
      const result = generate({ rom, config: discovered(rom), decomp: { defined: new Set() }, printer });
      assert.ok(result.report.ok, `${fixture.name} ${printer}: ${result.report.checks.map((c) => c.detail).join('; ')}`);
      const outcome = await toolchainChecks(rom, result, { assemble: true, link: true }, { ...capturingIo(), env: process.env });
      assert.deepEqual(
        outcome.checks.map((c) => [c.id, c.ok, c.detail]),
        [
          ['assemble', true, outcome.checks[0]?.detail],
          ['link', true, outcome.checks[1]?.detail],
        ],
      );
      assert.equal(outcome.sha1, rom.sha1, `${fixture.name} ${printer}`);
    }
  }
  const after = readdirSync(tmpdir()).filter((n) => n.startsWith(VERIFY_TEMP_PREFIX) && !before.has(n));
  assert.deepEqual(after, [], 'every temporary directory is removed');
});

test('binutils missing from the environment is E_TOOLCHAIN_MISSING on both toolchain checks, which exits 1', async () => {
  const rom = readFixtureRom(FAR_JUMP);
  const result = generate({ rom, config: discovered(rom), decomp: { defined: new Set() }, printer: 'readable' });
  const outcome = await toolchainChecks(rom, result, { assemble: true, link: true }, { ...capturingIo(), env: { PATH: '' } });
  assert.deepEqual(
    outcome.checks.map((c) => [c.id, c.ok, c.diagnostics.map((d) => d.code)]),
    [
      ['assemble', false, ['E_TOOLCHAIN_MISSING']],
      ['link', false, ['E_TOOLCHAIN_MISSING']],
    ],
  );
  assert.equal(verifyExitCode({ report: { ok: false, checks: [...result.report.checks, ...outcome.checks] }, diagnostics: [] }), ExitCode.errors);
});

test('nothing is written and no toolchain check runs while a self-check fails', async () => {
  const rom = readFixtureRom(FAR_JUMP);
  const result = generate({ rom, config: discovered(rom), decomp: { defined: new Set() }, printer: 'readable' });
  const broken = { ...result, report: { ok: false, checks: [checkResult('tiling', [diagnostic(VerifyCodes, 'E_SELF_CHECK_TILING', 'gap')], 'gap')] } };
  const outcome = await toolchainChecks(rom, broken, { assemble: false, link: true }, { ...capturingIo(), env: process.env });
  assert.deepEqual(
    outcome.checks.map((c) => [c.id, c.ok]),
    [['link', false]],
  );
  assert.match(outcome.checks[0]?.detail ?? '', /^not run: /);
  assert.deepEqual(await toolchainChecks(rom, result, { assemble: false, link: false }, capturingIo()), { checks: [] });
});

test('verify exits 0 on every fixture with both printers and --link reproduces the SHA-1', { skip: noToolchain }, async () => {
  for (const fixture of FIXTURES) {
    for (const printer of PRINTERS) {
      const out = await run(['verify', '--rom', fixture.rom, '--link', '--printer', printer, '--json'], process.env);
      const parsed = assertContract(out.stdout, out.code);
      assert.equal(out.code, ExitCode.ok, `${fixture.name} ${printer}: ${out.stdout}`);
      assert.equal(parsed.at(-1)?.['sha1'], readFixtureRom(fixture).sha1);
    }
  }
});

test('a child process with stdin closed prints the NDJSON contract and exits with its summary code', () => {
  const result = spawnSync(process.execPath, ['--conditions=source', 'src/cli/main.ts', 'verify', '--rom', FAR_JUMP.rom, '--json'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.ok(result.status === ExitCode.ok || result.status === ExitCode.verifyFailed, result.stderr);
  assertContract(result.stdout, result.status as ExitCode);
});

test('a [symbols] entry in RAM names every pool word equal to its address, which symbols.ld defines, and the tree links to the SHA-1', { skip: noToolchain }, async () => {
  const rom = readFixtureRom(FAR_JUMP);
  const base = discovered(rom);
  const config: RomliftConfig = {
    ...base,
    symbols: new Map([
      [0x0200_0000, { name: 'gEwramStart', aliases: [] }],
      [0x0300_7fa0, { name: 'gIrqStackTop', aliases: [] }],
    ]),
  };
  for (const printer of PRINTERS) {
    const result = generate({ rom, config, decomp: { defined: new Set() }, printer });
    assert.ok(result.report.ok, `${printer}: ${result.report.checks.map((c) => c.detail).join('; ')}`);
    const texts = [...generatedEntries(rom, result)].map((e) => ('text' in e ? e.text : ''));
    const all = texts.join('\n');
    assert.match(all, /gEwramStart = 0x02000000;\ngIrqStackTop = 0x03007FA0;/);
    if (printer === 'readable') {
      assert.match(all, /\.4byte gEwramStart\b/);
      assert.match(all, /\.4byte gIrqStackTop\b/);
      assert.doesNotMatch(all, /\.4byte 0x0(2000000|3007FA0)\b/);
    }
    const outcome = await toolchainChecks(rom, result, { assemble: true, link: true }, { ...capturingIo(), env: process.env });
    assert.deepEqual(outcome.checks.map((c) => [c.id, c.ok]), [['assemble', true], ['link', true]], printer);
    assert.equal(outcome.sha1, rom.sha1, printer);
  }
});
