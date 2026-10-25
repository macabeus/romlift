// `romlift analyze <rom> [--json] [--disable <rule>...]` (architecture §2.1): in process through `main`
// (NDJSON line by line, the text table, usage and IO errors, --disable) and as two child processes with
// stdin closed from different working directories, project paths, time zones and locales, whose stdout
// must be byte-identical and free of the path (g2.determinism's run). `analyze --update` inside a project, and from
// phase 6 with the signature files $ROMLIFT_SIGNATURES names.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyzeNdjson, analyzeSummary, analyzeTextLines } from '../../../src/cli/commands/analyze.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { listSyntheticFixtures, SYNTHETIC_ROOT } from '../../helpers/fixtures.ts';
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

test('analyze text is built one line at a time, as the command streams it (fix round 5)', async () => {
  const base = farJumpResult();
  const rejection = { at: 0x08000100, mode: 'thumb' as const, rule: 'valid.decodes' as const, reason: 'decodes to nothing', intrinsic: true, round: 1, detail: 'x', count: 1 };
  const result = { ...base, rejections: Array.from({ length: 5_000 }, (_, i) => ({ ...rejection, at: 0x08000100 + 2 * i })) };
  const lines = [...analyzeTextLines(result as typeof base, analyzeSummary(result as typeof base, ExitCode.ok))];
  assert.equal(lines.length, base.functions.length + 1 + 1 + 5_000 + 1, 'header, functions, "rejections:", rejections, summary');
  assert.ok(lines.every((l) => l.endsWith('\n') && l.indexOf('\n') === l.length - 1), 'each yielded string is one line');
  assert.equal(lines[base.functions.length + 1], 'rejections:\n');
  assert.match(lines[base.functions.length + 2] ?? '', /^  0x08000100  thumb  valid\.decodes  decodes to nothing  x1  x\n$/);
  const io = capturingIo();
  assert.equal(await main(['analyze', ROM], io), ExitCode.ok);
  assert.equal(io.out.join(''), [...analyzeTextLines(base, analyzeSummary(base, ExitCode.ok))].join(''), 'the command prints exactly these lines');
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

// Phase 4: `analyze --update [--write]` inside a project made by `init`.

async function inProject(argv: readonly string[], cwd: string): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = { ...capturingIo(), cwd };
  const code = await main(argv, io);
  return { code, stdout: io.out.join(''), stderr: io.err.join('') };
}

function updateProject(): string {
  const dir = join(TMP, `update-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(ROM, join(dir, 'baserom.gba'));
  return dir;
}

test('analyze --update right after init proposes nothing and leaves romlift.toml as it is', async () => {
  const dir = updateProject();
  assert.equal((await inProject(['init', 'baserom.gba'], dir)).code, ExitCode.ok);
  const before = readFileSync(join(dir, 'romlift.toml'), 'utf8');
  const out = await inProject(['analyze', '--update', '--json'], dir);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  const lines = parseLines(out.stdout);
  assert.deepEqual(lines.find((l) => l.type === 'patch'), { type: 'patch', path: 'romlift.toml', changed: false, written: false, diff: '' });
  assert.equal(lines.filter((l) => l.type === 'proposal').length, 0);
  assert.equal(lines.at(-1)?.type, 'summary');
  const write = await inProject(['analyze', '--update', '--write'], dir);
  assert.equal(write.code, ExitCode.ok);
  assert.match(write.stdout, /romlift\.toml is up to date/);
  assert.equal(readFileSync(join(dir, 'romlift.toml'), 'utf8'), before);
});

test('analyze --update proposes an entry deleted by hand; --write puts it back and keeps the comments', async () => {
  const dir = updateProject();
  assert.equal((await inProject(['init', 'baserom.gba'], dir)).code, ExitCode.ok);
  const file = join(dir, 'romlift.toml');
  const original = readFileSync(file, 'utf8');
  const entry = original.split('\n').filter((l) => /^0x0[0-9A-F]{7} = "sub_/.test(l)).at(-1) ?? assert.fail('no entry');
  const edited = `# kept comment\n${original.replace(`${entry}\n`, '')}`;
  writeFileSync(file, edited);
  const dry = await inProject(['analyze', '--update'], dir);
  assert.equal(dry.code, ExitCode.ok, dry.stderr);
  assert.match(dry.stdout, new RegExp(`^function ${entry.slice(0, 10)} thumb`, 'm'));
  assert.ok(dry.stdout.includes(`\n+${entry}\n`), dry.stdout);
  assert.match(dry.stdout, /run `romlift analyze --update --write` to apply the patch/);
  assert.equal(readFileSync(file, 'utf8'), edited, 'without --write nothing is written');
  const write = await inProject(['analyze', '--update', '--write', '--json'], dir);
  assert.equal(write.code, ExitCode.ok, write.stdout);
  assert.equal(parseLines(write.stdout).find((l) => l.type === 'patch')?.['written'], true);
  assert.equal(readFileSync(file, 'utf8'), `# kept comment\n${original}`);
});

test('analyze --update: --write alone, a ROM argument or --disable is a usage error; outside a project exit 1', async () => {
  assert.equal((await run(['analyze', ROM, '--write'])).code, ExitCode.usage);
  assert.equal((await run(['analyze', ROM, '--update'])).code, ExitCode.usage);
  assert.equal((await run(['analyze', '--update', '--disable', 'seed.call'])).code, ExitCode.usage);
  assert.equal((await run(['analyze'])).code, ExitCode.usage);
  const out = await inProject(['analyze', '--update', '--json'], TMP);
  assert.equal(out.code, ExitCode.errors);
  assert.equal(parseLines(out.stdout)[0]?.['code'], 'E_PROJECT_NOT_FOUND');
});

// Phase 6: the signature proposals of analyze --update, located from $ROMLIFT_SIGNATURES (a temporary directory).

test('analyze --update with a signature directory: default names renamed with from, the library module proposed; --write saves them', async () => {
  const game = listSyntheticFixtures().find((f) => f.name === 'library-game') ?? assert.fail('library-game');
  const dir = join(TMP, `sig-${Math.random().toString(16).slice(2)}`);
  const none = join(TMP, `none-${Math.random().toString(16).slice(2)}`);
  const signatures = join(TMP, `libfix-${Math.random().toString(16).slice(2)}`);
  for (const d of [dir, none, signatures]) mkdirSync(d, { recursive: true });
  copyFileSync(game.rom, join(dir, 'baserom.gba'));
  copyFileSync(join(SYNTHETIC_ROOT, 'library', 'signatures.golden.json'), join(signatures, 'libfix.json'));
  const withEnv = async (argv: readonly string[], env: string) => {
    const io = { ...capturingIo(), cwd: dir, env: { ROMLIFT_SIGNATURES: env } };
    const code = await main(argv, io);
    return { code, stdout: io.out.join('') };
  };
  assert.equal((await withEnv(['init', 'baserom.gba'], none)).code, ExitCode.ok);
  const out = await withEnv(['analyze', '--update', '--json'], signatures);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  const proposals = parseLines(out.stdout).filter((l) => l.type === 'proposal');
  assert.deepEqual(
    proposals.find((p) => p['addr'] === '0x08000244'),
    { type: 'proposal', kind: 'function', addr: '0x08000244', mode: 'thumb', name: 'FixAbs', source: 'signature', rule: 'sig.unique-fit', from: 'sig:libfix@1.0' },
  );
  assert.deepEqual(proposals.find((p) => p['kind'] === 'symbol'), {
    type: 'proposal',
    kind: 'symbol',
    addr: '0x08000274',
    name: 'gFixTable',
    size: 16,
    symbolType: 'pointers',
    source: 'signature',
    rule: 'sig.short-member-window',
    from: 'sig:libfix@1.0',
  });
  assert.deepEqual(
    proposals.filter((p) => p['kind'] === 'module').map((p) => [p['name'], p['library']]),
    [
      ['libfix', 'libfix@1.0'],
      ['main_08000264', undefined],
    ],
  );
  const text = await withEnv(['analyze', '--update'], signatures);
  assert.match(text.stdout, /^function 0x08000244 thumb FixAbs, from sig:libfix@1\.0 \(sig\.unique-fit\)$/m);
  assert.match(text.stdout, /^module 0x080001B4 libfix, library libfix@1\.0$/m);
  assert.equal((await withEnv(['analyze', '--update', '--write'], signatures)).code, ExitCode.ok);
  assert.match(readFileSync(join(dir, 'romlift.toml'), 'utf8'), /^0x08000244 = \{ name = "FixAbs", from = "sig:libfix@1\.0" \}$/m);
  const again = await withEnv(['analyze', '--update', '--json'], signatures);
  assert.equal(parseLines(again.stdout).find((l) => l.type === 'patch')?.['changed'], false);
});
