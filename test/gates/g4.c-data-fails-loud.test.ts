// g4.c-data-fails-loud (architecture §6.6, §13, D21): data defined in C fails the link with a message that
// names the file. The c-data fixture is initialised and built to its SHA-1 first (the control: the scaffold
// alone links); then its overlay, a src/<module>.c that defines a `const` array, is copied over the project
// as a decompiler would write it, and `make` must fail with the ldscript's ASSERT message
//   src/<module>.c defines data; see AGENTS.md (romlift does not place C data yet)
// for that module; the ROM the control built is removed first, and the failed link must not leave one.
//
// Interfaces, frozen by D74 (as in g4.e2e-fixtures, plus):
//   bench/dataset/synthetic/c-data/overlay/src/<module>.c   the decompiled C file with its const array (p4-fixtures)
//   ldscript.txt, per C module (p4-c-modules):
//     .c_data_<module> (NOLOAD) : { *src/<module>.o(.rodata* .data* .bss* COMMON) }
//     ASSERT(SIZEOF(.c_data_<module>) == 0, "src/<module>.c defines data; see AGENTS.md (romlift does not place C data yet)")
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface CliLine {
  readonly type: string;
  readonly exitCode?: number;
}

const FIXTURE = 'c-data';

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function sha1(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function sourceCli(cx: GateContext): Promise<string> {
  const dir = await cx.tmpDir('romlift-cli-');
  const shim = path.join(dir, 'romlift');
  const main = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  await writeFile(shim, `#!/bin/sh\nexec '${process.execPath}' --conditions=source '${main}' "$@"\n`, { mode: 0o755 });
  return shim;
}

async function builtSha1(dir: string): Promise<{ readonly recorded: string; readonly file: string; readonly built?: string }> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sha1'));
  const match = names.length === 1 && names[0] !== undefined ? /^([0-9a-f]{40})\s+\*?(\S+)\s*$/m.exec(await readFile(path.join(dir, names[0]), 'utf8')) : null;
  if (match?.[1] === undefined || match[2] === undefined) throw new Error('the project has no single <name>.sha1 in sha1sum format');
  const file = path.join(dir, match[2]);
  return (await exists(file)) ? { recorded: match[1], file, built: sha1(await readFile(file)) } : { recorded: match[1], file };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

gate({
  id: 'g4.c-data-fails-loud',
  phase: 4,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['init', 'generate'],
  async run(cx) {
    const fixture = cx.fixtures.find((f) => f.name === FIXTURE);
    if (fixture === undefined) throw new Error(`no ${FIXTURE} fixture under bench/dataset/synthetic`);
    const overlay = path.join(fixture.dir, 'overlay');
    const modules = (await readdir(path.join(overlay, 'src')).catch(() => [] as string[])).filter((n) => n.endsWith('.c')).map((n) => n.slice(0, -2));
    if (modules.length === 0) throw new Error(`${FIXTURE}/overlay/src holds no .c file`);

    const cli = await sourceCli(cx);
    const dir = path.join(await cx.tmpDir('romlift-c-data-'), FIXTURE);
    await mkdir(dir, { recursive: true });
    await copyFile(fixture.rom, path.join(dir, 'baserom.gba'));
    const init = await cx.exec(cli, ['init', 'baserom.gba', '--json'], { cwd: dir });
    if (init.code !== 0 || cx.jsonLines<CliLine>(init.stdout).at(-1)?.exitCode !== 0) throw new Error(`init exited ${init.code}:\n${tail(init)}`);
    const env = { ROMLIFT_CLI: cli };
    const setup = await cx.exec('./setup.sh', [], { cwd: dir, env });
    if (setup.code !== 0) throw new Error(`./setup.sh exited ${setup.code}:\n${tail(setup)}`);
    const control = await cx.exec('make', [], { cwd: dir, env });
    const before = await builtSha1(dir);
    if (control.code !== 0 || before.built !== before.recorded) throw new Error(`the control build without C data does not reach the SHA-1 (make exit ${control.code}):\n${tail(control)}`);

    await rm(before.file);
    await cp(overlay, dir, { recursive: true });
    const make = await cx.exec('make', [], { cwd: dir, env });
    const output = `${make.stdout}${make.stderr}`;
    if (make.code === 0) throw new Error('make succeeded with a C file that defines data');
    const named = modules.filter((m) => new RegExp(`src/${escape(m)}\\.c defines data; see AGENTS\\.md`).test(output));
    if (named.length === 0) throw new Error(`make failed without the ASSERT message for ${modules.map((m) => `src/${m}.c`).join(', ')}:\n${tail(make)}`);
    if ((await builtSha1(dir)).built !== undefined) throw new Error('the failed link left a ROM behind');
    cx.note(`make fails loudly on C data in ${named.map((m) => `src/${m}.c`).join(', ')}; the control build reaches the SHA-1`);
  },
});
