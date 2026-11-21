// The matchings split through `generate` (architecture §6.3 function row, §6.6, phase 6, D92), in projects init wrote:
// a function its C module's source defines outside every conditional is written to asm/matchings/<module>/<Name>.s
// and its asm/nonmatchings file deleted; a second generate keeps everything (no file or modification time changes); a
// TOML rename of the decompiled function is E_C_STALE_DEFINITION, read from the matchings tree on disk; `romlift
// rename` carries it into the C and the next generate into the tree; a definition only inside `#ifdef NONMATCHING`
// keeps its file in asm/nonmatchings; and once the C is gone the file moves back.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-cli-matchings-'));
after(() => rm(TMP, { recursive: true, force: true }));
const COMPOSITE = listSyntheticFixtures().find((f) => f.name === 'composite') ?? assert.fail('composite');
const NAME = 'sub_08000488';
const STUB = `INCLUDE_ASM("asm/nonmatchings/main_2", ${NAME});`;
const C = `int ${NAME}(void) {\n  return 0;\n}`;
let fresh = 0;

async function run(
  cwd: string,
  argv: readonly string[],
): Promise<{ readonly code: ExitCode; readonly stdout: string }> {
  const io = { ...capturingIo(), cwd };
  const code = await main(argv, io);
  return { code, stdout: io.out.join('') + io.err.join('') };
}

function diagnostics(stdout: string): readonly string[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((text) => JSON.parse(text) as Record<string, unknown>)
    .filter((l) => l['type'] === 'diagnostic')
    .map((l) => String(l['code']));
}

async function snapshot(dir: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) for (const [k, v] of await snapshot(dir, relative)) out.set(k, v);
    else
      out.set(
        relative,
        `${(await readFile(path.join(dir, relative))).toString('base64')} ${(await stat(path.join(dir, relative))).mtimeMs}`,
      );
  }
  return out;
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

/** A project init wrote whose src/main_2.c defines NAME in place of its stub (`body` replaces the stub). */
async function decompiled(body: string = C): Promise<string> {
  const dir = path.join(TMP, `p${fresh++}`);
  await mkdir(dir, { recursive: true });
  await copyFile(COMPOSITE.rom, path.join(dir, 'baserom.gba'));
  assert.equal((await run(dir, ['init', 'baserom.gba'])).code, ExitCode.ok);
  const file = path.join(dir, 'src', 'main_2.c');
  const text = await readFile(file, 'utf8');
  assert.ok(text.includes(STUB), 'the composite as this test knows it');
  await writeFile(file, text.replace(STUB, body));
  return dir;
}

test('a decompiled function moves to asm/matchings, and a second generate changes nothing', async () => {
  const dir = await decompiled();
  const nonmatching = path.join(dir, 'asm', 'nonmatchings', 'main_2', `${NAME}.s`);
  const text = await readFile(nonmatching, 'utf8');
  const first = await run(dir, ['generate', '--json']);
  assert.equal(first.code, ExitCode.ok, first.stdout);
  assert.deepEqual(diagnostics(first.stdout), []);
  assert.equal(
    await readFile(path.join(dir, 'asm', 'matchings', 'main_2', `${NAME}.s`), 'utf8'),
    text,
    'the same chunk text',
  );
  assert.ok(!(await exists(nonmatching)), 'the old spelling is deleted (the manifest owned it)');
  assert.ok(
    !(await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8')).includes('asm/matchings'),
    'no INCLUDE_ASM names matchings',
  );
  const manifest = JSON.parse(await readFile(path.join(dir, '.romlift', 'manifest.json'), 'utf8')) as {
    files: Record<string, unknown>;
  };
  assert.ok(`asm/matchings/main_2/${NAME}.s` in manifest.files);

  const before = await snapshot(dir);
  const dry = await run(dir, ['generate', '--dry-run', '--json']);
  const ops = dry.stdout
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l['type'] === 'op');
  assert.deepEqual([...new Set(ops.map((l) => l['op']))], ['keep'], 'the second run plans keeps only');
  const second = await run(dir, ['generate', '--json']);
  assert.equal(second.code, ExitCode.ok, second.stdout);
  assert.deepEqual(await snapshot(dir), before, 'no file or modification time changed');
});

test('a TOML rename of the decompiled function is E_C_STALE_DEFINITION, read from the matchings tree; romlift rename carries it', async () => {
  const dir = await decompiled();
  assert.equal((await run(dir, ['generate'])).code, ExitCode.ok);
  const tomlPath = path.join(dir, 'romlift.toml');
  const toml = await readFile(tomlPath, 'utf8');
  await writeFile(tomlPath, toml.replace(`"${NAME}"`, '"ScoreReset"'));
  const before = await snapshot(dir);
  const refused = await run(dir, ['generate', '--json']);
  assert.equal(refused.code, ExitCode.errors, refused.stdout);
  assert.deepEqual(diagnostics(refused.stdout), ['E_C_STALE_DEFINITION']);
  assert.deepEqual(await snapshot(dir), before, 'nothing written');

  await writeFile(tomlPath, toml);
  const renamed = await run(dir, ['rename', NAME, 'ScoreReset', '--json']);
  assert.equal(renamed.code, ExitCode.ok, renamed.stdout);
  assert.ok((await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8')).includes('int ScoreReset(void) {'));
  const after = await run(dir, ['generate', '--json']);
  assert.equal(after.code, ExitCode.ok, after.stdout);
  assert.ok(await exists(path.join(dir, 'asm', 'matchings', 'main_2', 'ScoreReset.s')));
  assert.ok(!(await exists(path.join(dir, 'asm', 'matchings', 'main_2', `${NAME}.s`))));
  assert.ok(!(await exists(path.join(dir, 'asm', 'nonmatchings', 'main_2', 'ScoreReset.s'))));
});

test('a definition only under #ifdef NONMATCHING keeps its file in asm/nonmatchings', async () => {
  const dir = await decompiled(`#ifdef NONMATCHING\n${C}\n#else\n${STUB}\n#endif`);
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.ok(await exists(path.join(dir, 'asm', 'nonmatchings', 'main_2', `${NAME}.s`)));
  assert.ok(!(await exists(path.join(dir, 'asm', 'matchings'))));
});

test('once the C is gone, the next generate puts the stub back and moves the file back', async () => {
  const dir = await decompiled();
  assert.equal((await run(dir, ['generate'])).code, ExitCode.ok);
  const file = path.join(dir, 'src', 'main_2.c');
  await writeFile(file, (await readFile(file, 'utf8')).replace(`${C}\n`, ''));
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.ok((await readFile(file, 'utf8')).includes(STUB), 'the stub is inserted again');
  assert.ok(await exists(path.join(dir, 'asm', 'nonmatchings', 'main_2', `${NAME}.s`)));
  assert.ok(
    !(await exists(path.join(dir, 'asm', 'matchings', 'main_2', `${NAME}.s`))),
    'the matchings file is deleted',
  );
});
