// `romlift analyze <rom> [--json] [--disable <rule>...]` (architecture §2.1): in process through `main`
// (NDJSON line by line, the text table, usage and IO errors, --disable) and as two child processes with
// stdin closed from different working directories, project paths, time zones and locales, whose stdout
// must be byte-identical and free of the path (g2.determinism's run).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyzeNdjson, analyzeSummary } from '../../../src/cli/commands/analyze.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = join(ROOT, 'src', 'cli', 'main.ts');
const FAR_JUMP = listSyntheticFixtures().find((f) => f.name === 'far-jump');
if (FAR_JUMP === undefined) throw new Error('the far-jump fixture is missing');
const ROM = FAR_JUMP.rom;
const TMP = mkdtempSync(join(tmpdir(), 'romlift-analyze-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

interface Line {
  readonly type: string;
  readonly [key: string]: unknown;
}

function parseLines(stdout: string): Line[] {
  assert.ok(stdout.endsWith('\n'), 'the output ends with a newline');
  return stdout
    .slice(0, -1)
    .split('\n')
    .map((text) => {
      const value: unknown = JSON.parse(text);
      assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), text);
      return value as Line;
    });
}

async function run(argv: readonly string[]): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = capturingIo();
  const code = await main(argv, io);
  return { code, stdout: io.out.join(''), stderr: io.err.join('') };
}

function farJumpResult(): ReturnType<typeof discover> {
  const bytes = new Uint8Array(readFileSync(ROM));
  return discover(romFromBytes(bytes, sha1Of(bytes)));
}

test('analyze --json: one function line per function, the rejections, the diagnostics, then the summary', async () => {
  const out = await run(['analyze', ROM, '--json']);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  assert.equal(out.stderr, '');
  const lines = parseLines(out.stdout);
  const result = farJumpResult();
  const functions = lines.filter((l) => l.type === 'function');
  assert.equal(functions.length, result.functions.length);
  assert.deepEqual(
    functions.map((l) => l['entry']),
    result.functions.map((f) => `0x${f.entry.toString(16).toUpperCase().padStart(8, '0')}`),
  );
  for (const l of functions) {
    for (const key of ['entry', 'mode', 'extent', 'codeEnd', 'origin', 'accepted', 'also']) assert.ok(Object.hasOwn(l, key), `${key} in ${JSON.stringify(l)}`);
  }
  assert.equal(lines.filter((l) => l.type === 'rejection').length, result.rejections.length);
  assert.deepEqual(lines.at(-1), { type: 'summary', ok: true, exitCode: 0, counts: { functions: result.functions.length, rejections: result.rejections.length, diagnostics: 0 } });
  assert.equal(out.stdout, analyzeNdjson(result, analyzeSummary(result, ExitCode.ok)));
});

test('analyze --json prints every rejection with its rule and miss reason', async () => {
  const fixture = listSyntheticFixtures().find((f) => f.name === 'pool-word-push-lr');
  assert.ok(fixture !== undefined);
  const lines = parseLines((await run(['analyze', fixture.rom, '--json'])).stdout);
  const rejections = lines.filter((l) => l.type === 'rejection');
  assert.ok(rejections.length > 0);
  for (const r of rejections) for (const key of ['at', 'mode', 'rule', 'reason', 'intrinsic', 'round', 'detail', 'count']) assert.ok(Object.hasOwn(r, key), key);
});

test('analyze text: the function table, then the summary line', async () => {
  const out = await run(['analyze', ROM]);
  assert.equal(out.code, ExitCode.ok);
  const lines = out.stdout.trimEnd().split('\n');
  assert.match(lines[0] ?? '', /^entry\s+mode\s+extent\s+code end\s+origin\s+accepted\s+also$/);
  assert.equal(lines.length, farJumpResult().functions.length + 2);
  assert.match(lines.at(-1) ?? '', /^analyze: ok \(exit 0\): diagnostics 0, functions \d+, rejections \d+$/);
});


test('an unknown --disable id is a usage error (exit 2) naming it; nothing on stdout', async () => {
  const out = await run(['analyze', ROM, '--json', '--disable', 'walk.no-such-rule', '--disable', 'bogus']);
  assert.equal(out.code, ExitCode.usage);
  assert.equal(out.stdout, '');
  assert.match(out.stderr, /--disable names no analysis rule: bogus, walk\.no-such-rule/);
});

test('--disable turns a registered rule off', async () => {
  const lines = parseLines((await run(['analyze', ROM, '--json', '--disable', 'seed.call'])).stdout);
  const origins = lines.filter((l) => l.type === 'function').map((l) => l['origin']);
  assert.ok(!origins.includes('call'));
  assert.ok(farJumpResult().functions.some((f) => f.origin === 'call'));
});

test('a missing <rom> is a usage error (exit 2)', async () => {
  assert.equal((await run(['analyze', '--json'])).code, ExitCode.usage);
});

test('an unreadable ROM: E_IO_READ, exit 1, still NDJSON with a summary', async () => {
  const out = await run(['analyze', join(TMP, 'absent.gba'), '--json']);
  assert.equal(out.code, ExitCode.errors);
  const lines = parseLines(out.stdout);
  assert.equal(lines[0]?.['code'], 'E_IO_READ');
  assert.deepEqual(lines.at(-1), { type: 'summary', ok: false, exitCode: 1, counts: { functions: 0, rejections: 0, diagnostics: 1 } });
  const text = await run(['analyze', join(TMP, 'absent.gba')]);
  assert.equal(text.code, ExitCode.errors);
  assert.match(text.stderr, /^E_IO_READ error /);
  assert.match(text.stdout, /^analyze: failed \(exit 1\)/);
});

test('an image that is not a cartridge: E_ROM_NOT_GBA diagnostics, exit 1', async () => {
  const file = join(TMP, 'not-a-rom.gba');
  writeFileSync(file, new Uint8Array(0x200));
  const out = await run(['analyze', file, '--json']);
  assert.equal(out.code, ExitCode.errors);
  const lines = parseLines(out.stdout);
  assert.ok(lines.slice(0, -1).every((l) => l.type === 'diagnostic' && l['code'] === 'E_ROM_NOT_GBA'));
  assert.deepEqual(lines.at(-1)?.['exitCode'], 1);
});

function analyzeIn(dir: string, env: Readonly<Record<string, string>>): string {
  mkdirSync(dir, { recursive: true });
  copyFileSync(ROM, join(dir, 'far-jump.gba'));
  const result = spawnSync(process.execPath, ['--conditions=source', MAIN, 'analyze', 'far-jump.gba', '--json'], {
    cwd: dir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stderr);
  parseLines(result.stdout);
  return result.stdout;
}

test('two processes with stdin closed print the same bytes across cwd, project path, TZ and locale, with no path', () => {
  const first = join(TMP, 'first');
  const second = join(TMP, 'second run', 'elsewhere');
  const a = analyzeIn(first, {});
  const b = analyzeIn(second, { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' });
  assert.equal(a, b);
  for (const dir of [first, second, realpathSync(first), realpathSync(second), 'far-jump.gba']) assert.ok(!a.includes(dir), `the output names ${dir}`);
});
