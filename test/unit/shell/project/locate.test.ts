// locateProject (architecture §6.5): the nearest directory holding a decomp.yaml (or decomp.yml), from any
// directory below it; a project nested inside another is found first; a git worktree of a project finds its own
// decomp.yaml, never the main checkout's; no project at all is E_PROJECT_NOT_FOUND.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { decompYamlIn, locateProject } from '../../../../src/shell/project/locate.ts';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'romlift-locate-')));
  roots.push(dir);
  return dir;
}

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('the nearest decomp.yaml above the start wins', async () => {
  const root = await tempRoot();
  await mkdir(join(root, 'project/src/deep/er'), { recursive: true });
  await mkdir(join(root, 'project/inner/tools'), { recursive: true });
  await writeFile(join(root, 'project/decomp.yaml'), 'name: outer\n');
  await writeFile(join(root, 'project/inner/decomp.yaml'), 'name: inner\n');
  assert.deepEqual(await locateProject(join(root, 'project/src/deep/er')), { ok: true, value: { dir: join(root, 'project'), decompYaml: join(root, 'project/decomp.yaml') } });
  assert.deepEqual(await locateProject(join(root, 'project')), { ok: true, value: { dir: join(root, 'project'), decompYaml: join(root, 'project/decomp.yaml') } });
  assert.deepEqual(await locateProject(join(root, 'project/inner/tools')), { ok: true, value: { dir: join(root, 'project/inner'), decompYaml: join(root, 'project/inner/decomp.yaml') } });
});

test('decomp.yml is the second name; a directory called decomp.yaml is not a file', async () => {
  const root = await tempRoot();
  await mkdir(join(root, 'a/decomp.yaml'), { recursive: true });
  await writeFile(join(root, 'a/decomp.yml'), 'name: yml\n');
  assert.deepEqual(await locateProject(join(root, 'a')), { ok: true, value: { dir: join(root, 'a'), decompYaml: join(root, 'a/decomp.yml') } });
  await writeFile(join(root, 'decomp.yaml'), 'name: both\n');
  await writeFile(join(root, 'decomp.yml'), 'name: both\n');
  assert.deepEqual(await decompYamlIn(root), { ok: true, path: join(root, 'decomp.yaml') });
});

test('no decomp.yaml up to the root is E_PROJECT_NOT_FOUND', async (t) => {
  const root = await tempRoot();
  const probe = await locateProject(root);
  if (probe.ok) {
    t.skip(`a decomp.yaml above the temporary directory (${probe.value.decompYaml}) hides the case`);
    return;
  }
  await mkdir(join(root, 'empty/sub'), { recursive: true });
  const found = await locateProject(join(root, 'empty/sub'));
  assert.equal(found.ok, false);
  assert.deepEqual(
    found.ok ? [] : found.diagnostics.map((d) => [d.code, d.message, d.path]),
    [['E_PROJECT_NOT_FOUND', `no decomp.yaml in ${join(root, 'empty/sub')} or any parent directory; run \`romlift init <rom>\` to create a project`, join(root, 'empty/sub')]],
  );
});

test('a relative start is resolved from the working directory', async () => {
  const here = await locateProject('.');
  const absolute = await locateProject(process.cwd());
  assert.deepEqual(here, absolute);
});

test('a git worktree of a project finds its own decomp.yaml', { skip: !hasGit() }, async () => {
  const root = await tempRoot();
  const main = join(root, 'main');
  await mkdir(join(main, 'src'), { recursive: true });
  await writeFile(join(main, 'decomp.yaml'), 'name: main\n');
  await writeFile(join(main, 'src/main.c'), '\n');
  const git = (cwd: string, ...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=romlift', '-c', 'user.email=romlift@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
  };
  git(main, 'init', '-q');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'project');
  git(main, 'worktree', 'add', '-q', join(root, 'wt'));
  const found = await locateProject(join(root, 'wt/src'));
  assert.deepEqual(found, { ok: true, value: { dir: join(root, 'wt'), decompYaml: join(root, 'wt/decomp.yaml') } });
});
