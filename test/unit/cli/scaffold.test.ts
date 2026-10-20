// `romlift scaffold --diff [--json]` (architecture §2.1, §6.4: "scaffold --diff shows template drift"): in a project
// `init` made every scaffold file is `same`; a file changed by hand `differs`, with the unified diff from it to the
// rendered template; a deleted one is `absent`; nothing is ever written; exit 0. Without --diff it is a usage error,
// outside a project E_PROJECT_NOT_FOUND.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-cli-scaffold-'));
after(() => rm(TMP, { recursive: true, force: true }));
const FAR_JUMP = listSyntheticFixtures().find((f) => f.name === 'far-jump') ?? assert.fail('far-jump');

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

const DIR = path.join(TMP, 'project');
await mkdir(DIR, { recursive: true });
await copyFile(FAR_JUMP.rom, path.join(DIR, 'baserom.gba'));
assert.equal((await main(['init', 'baserom.gba'], { ...capturingIo(), cwd: DIR })), ExitCode.ok);

test('right after init every scaffold file is the same as its template', async () => {
  const out = await run(DIR, ['scaffold', '--diff', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  const parsed = lines(out.stdout);
  const files = parsed.filter((l) => l['type'] === 'scaffold');
  assert.ok(files.length >= 10);
  assert.ok(files.every((l) => l['status'] === 'same' && l['diff'] === ''));
  assert.ok(files.some((l) => l['path'] === 'setup.sh'));
  const summary = parsed.at(-1);
  assert.deepEqual(summary, { type: 'summary', ok: true, exitCode: 0, counts: { absent: 0, differs: 0, same: files.length } });
});

test('a changed file differs (with its diff), a deleted one is absent, and nothing is written', async () => {
  const makefile = path.join(DIR, 'Makefile');
  const original = await readFile(makefile, 'utf8');
  await writeFile(makefile, `${original}# my rule\n`);
  const readme = await readFile(path.join(DIR, 'README.md'), 'utf8');
  await rm(path.join(DIR, 'README.md'));
  const mtime = (await stat(makefile)).mtimeMs;
  try {
    const out = await run(DIR, ['scaffold', '--diff']);
    assert.equal(out.code, ExitCode.ok);
    assert.match(out.stdout, /^differs Makefile\n--- a\/Makefile\n\+\+\+ b\/Makefile\n@@ [^\n]+ @@\n(?: [^\n]*\n)*-# my rule\n/m);
    assert.match(out.stdout, /^absent  README\.md$/m);
    assert.match(out.stdout, /^scaffold --diff: ok \(exit 0\): absent 1, differs 1, same \d+$/m);
    assert.equal((await stat(makefile)).mtimeMs, mtime);
    await assert.rejects(stat(path.join(DIR, 'README.md')));
  } finally {
    await writeFile(makefile, original);
    await writeFile(path.join(DIR, 'README.md'), readme);
  }
});

test('without --diff it is a usage error (exit 2); outside a project E_PROJECT_NOT_FOUND (exit 1)', async () => {
  assert.equal((await run(DIR, ['scaffold'])).code, ExitCode.usage);
  const out = await run(TMP, ['scaffold', '--diff', '--json']);
  assert.equal(out.code, ExitCode.errors);
  assert.equal(lines(out.stdout)[0]?.['code'], 'E_PROJECT_NOT_FOUND');
});
