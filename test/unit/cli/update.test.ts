// `romlift update [--write] [--json]` (architecture §2.1, §6.5) inside a project made by `init`, in process through
// `main`: what the analysis proposes for romlift.toml as a patch that keeps its comments, saved with --write; with the
// signature files $ROMLIFT_SIGNATURES names, their proposals.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { SYNTHETIC_ROOT, listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const FAR_JUMP = listSyntheticFixtures().find((f) => f.name === 'far-jump');
if (FAR_JUMP === undefined) throw new Error('the far-jump fixture is missing');
const ROM = FAR_JUMP.rom;
const TMP = mkdtempSync(join(tmpdir(), 'romlift-update-'));
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

async function run(
  argv: readonly string[],
): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = capturingIo();
  const code = await main(argv, io);
  return { code, stdout: io.out.join(''), stderr: io.err.join('') };
}

async function inProject(
  argv: readonly string[],
  cwd: string,
): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
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

test('update right after init proposes nothing and leaves romlift.toml as it is', async () => {
  const dir = updateProject();
  assert.equal((await inProject(['init', 'baserom.gba'], dir)).code, ExitCode.ok);
  const before = readFileSync(join(dir, 'romlift.toml'), 'utf8');
  const out = await inProject(['update', '--json'], dir);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  const lines = parseLines(out.stdout);
  assert.deepEqual(
    lines.find((l) => l.type === 'patch'),
    { type: 'patch', path: 'romlift.toml', changed: false, written: false, diff: '' },
  );
  assert.equal(lines.filter((l) => l.type === 'proposal').length, 0);
  assert.equal(lines.at(-1)?.type, 'summary');
  const write = await inProject(['update', '--write'], dir);
  assert.equal(write.code, ExitCode.ok);
  assert.match(write.stdout, /romlift\.toml is up to date/);
  assert.equal(readFileSync(join(dir, 'romlift.toml'), 'utf8'), before);
});

test('update proposes an entry deleted by hand; --write puts it back and keeps the comments', async () => {
  const dir = updateProject();
  assert.equal((await inProject(['init', 'baserom.gba'], dir)).code, ExitCode.ok);
  const file = join(dir, 'romlift.toml');
  const original = readFileSync(file, 'utf8');
  const entry =
    original
      .split('\n')
      .filter((l) => /^0x0[0-9A-F]{7} = "sub_/.test(l))
      .at(-1) ?? assert.fail('no entry');
  const edited = `# kept comment\n${original.replace(`${entry}\n`, '')}`;
  writeFileSync(file, edited);
  const dry = await inProject(['update'], dir);
  assert.equal(dry.code, ExitCode.ok, dry.stderr);
  assert.match(dry.stdout, new RegExp(`^function ${entry.slice(0, 10)} thumb`, 'm'));
  assert.ok(dry.stdout.includes(`\n+${entry}\n`), dry.stdout);
  assert.match(dry.stdout, /run `romlift update --write` to apply the patch/);
  assert.equal(readFileSync(file, 'utf8'), edited, 'without --write nothing is written');
  const write = await inProject(['update', '--write', '--json'], dir);
  assert.equal(write.code, ExitCode.ok, write.stdout);
  assert.equal(parseLines(write.stdout).find((l) => l.type === 'patch')?.['written'], true);
  assert.equal(readFileSync(file, 'utf8'), `# kept comment\n${original}`);
});

test('update: an argument or an unknown option is a usage error; outside a project exit 1', async () => {
  assert.equal((await run(['update', ROM])).code, ExitCode.usage);
  assert.equal((await run(['update', '--disable', 'seed.call'])).code, ExitCode.usage);
  const out = await inProject(['update', '--json'], TMP);
  assert.equal(out.code, ExitCode.errors);
  assert.equal(parseLines(out.stdout)[0]?.['code'], 'E_PROJECT_NOT_FOUND');
});

// The signature proposals of update, located from $ROMLIFT_SIGNATURES (a temporary directory).

test('update with a signature directory: default names renamed with from, the library module proposed; --write saves them', async () => {
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
  const out = await withEnv(['update', '--json'], signatures);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  const proposals = parseLines(out.stdout).filter((l) => l.type === 'proposal');
  assert.deepEqual(
    proposals.find((p) => p['addr'] === '0x08000244'),
    {
      type: 'proposal',
      kind: 'function',
      addr: '0x08000244',
      mode: 'thumb',
      name: 'FixAbs',
      source: 'signature',
      rule: 'sig.unique-fit',
      from: 'sig:libfix@1.0',
    },
  );
  assert.deepEqual(
    proposals.find((p) => p['kind'] === 'symbol'),
    {
      type: 'proposal',
      kind: 'symbol',
      addr: '0x08000274',
      name: 'gFixTable',
      size: 16,
      symbolType: 'pointers',
      source: 'signature',
      rule: 'sig.short-member-window',
      from: 'sig:libfix@1.0',
    },
  );
  assert.deepEqual(
    proposals.filter((p) => p['kind'] === 'module').map((p) => [p['name'], p['library']]),
    [
      ['libfix', 'libfix@1.0'],
      ['main_08000264', undefined],
    ],
  );
  const text = await withEnv(['update'], signatures);
  assert.match(text.stdout, /^function 0x08000244 thumb FixAbs, from sig:libfix@1\.0 \(sig\.unique-fit\)$/m);
  assert.match(text.stdout, /^module 0x080001B4 libfix, library libfix@1\.0$/m);
  assert.equal((await withEnv(['update', '--write'], signatures)).code, ExitCode.ok);
  assert.match(
    readFileSync(join(dir, 'romlift.toml'), 'utf8'),
    /^0x08000244 = \{ name = "FixAbs", from = "sig:libfix@1\.0" \}$/m,
  );
  const again = await withEnv(['update', '--json'], signatures);
  assert.equal(parseLines(again.stdout).find((l) => l.type === 'patch')?.['changed'], false);
});
