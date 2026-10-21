// g4.worktree (architecture §6.3 setup.sh duty 3, §13, R8): in a fresh `git worktree` of an initialised and
// committed project, `./setup.sh` copies the ROM from the main checkout (checked against <name>.sha1) and
// `make` ends at the SHA-1. The ROM itself is never committed: the scaffold's .gitignore must exclude it. Nor is the
// generated tree (plan.md R4 and its scaffold table, "In Git: No"; the owner's answer to phase-4 Q9, D79 b): the
// worktree has no asm/, and its `./setup.sh` writes the tree with `romlift generate` (duty 5) before `make`.
// The ci tier runs every committed fixture except c-data; the real tier adds the six tuning ROMs (D60, D62 h, D74).
//
// Interfaces, frozen by D74 (as in g4.e2e-fixtures):
//   romlift init baserom.gba --json      exit 0; NDJSON, last line {"type":"summary","exitCode":0}
//   setup.sh runs romlift as `$ROMLIFT_CLI` when it is set and then skips its npm duty
//   <name>.sha1 holds `<sha1>  <file>` (sha1sum format), <file> being the ROM `make` builds
// The first target takes the path a user takes (correctness-7): `./setup.sh` runs in the main checkout before the
// commit, fetching agbcc at the pin, building it and registering tools/agbcc as a submodule (a 160000 gitlink), and the
// worktree's `./setup.sh` checks the submodule out (`git submodule update --init`) and builds it again. Later worktrees
// get a copy of the main checkout's built tools/agbcc, which setup.sh then finds present.
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface CliLine {
  readonly type: string;
  readonly exitCode?: number;
}

interface Target {
  readonly name: string;
  readonly rom: string;
}

const ROM_FILE = 'baserom.gba';
const NOT_BUILT: ReadonlySet<string> = new Set(['c-data']);
const GIT = ['-c', 'user.name=romlift gate', '-c', 'user.email=gate@romlift.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

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

async function run(cx: GateContext, what: string, command: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}): Promise<ExecResult> {
  const result = await cx.exec(command, args, { cwd, env });
  if (result.code !== 0) throw new Error(`${what} exited ${result.code}:\n${tail(result)}`);
  return result;
}

async function sha1File(dir: string): Promise<{ readonly sha1: string; readonly file: string }> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sha1'));
  const match = names.length === 1 && names[0] !== undefined ? /^([0-9a-f]{40})\s+\*?(\S+)\s*$/m.exec(await readFile(path.join(dir, names[0]), 'utf8')) : null;
  if (match?.[1] === undefined || match[2] === undefined) throw new Error('the project has no single <name>.sha1 in sha1sum format');
  return { sha1: match[1], file: match[2] };
}

/**
 * Initialises and commits `main` (after `./setup.sh` there when `viaSubmodule`, which registers tools/agbcc as a
 * submodule), adds a worktree, and builds there; returns the failure, if any, and the main checkout.
 */
async function inWorktree(cx: GateContext, cli: string, target: Target, base: string, agbcc: string | undefined, viaSubmodule: boolean): Promise<{ readonly failure?: string; readonly worktree: string; readonly main: string }> {
  const main = path.join(base, 'main', target.name);
  const env = { ROMLIFT_CLI: cli };
  const worktree = path.join(base, 'worktree', target.name);
  const expected = sha1(await readFile(target.rom));
  await mkdir(main, { recursive: true });
  await copyFile(target.rom, path.join(main, ROM_FILE));
  const init = await cx.exec(cli, ['init', ROM_FILE, '--json'], { cwd: main });
  const last = cx.jsonLines<CliLine>(init.stdout).at(-1);
  if (init.code !== 0 || last?.type !== 'summary' || last.exitCode !== 0) return { failure: `init exited ${init.code}:\n${tail(init)}`, worktree, main };
  await run(cx, 'git init', 'git', ['init', '-q'], main);
  if (viaSubmodule) {
    const mainSetup = await cx.exec('./setup.sh', [], { cwd: main, env });
    if (mainSetup.code !== 0) return { failure: `./setup.sh in the main checkout exited ${mainSetup.code}:\n${tail(mainSetup)}`, worktree, main };
  }
  await run(cx, 'git add', 'git', ['add', '-A'], main);
  await run(cx, 'git commit', 'git', [...GIT, 'commit', '-q', '-m', 'romlift init'], main);
  const tracked = (await run(cx, 'git ls-files', 'git', ['ls-files'], main)).stdout.split('\n');
  if (tracked.includes(ROM_FILE)) return { failure: `${ROM_FILE} was committed: the scaffold's .gitignore must exclude it`, worktree, main };
  // The generated roots plan.md's scaffold table marks "In Git: No" (R4): the product's own rule (core/write-plan
  // GENERATED_ROOTS through underGeneratedRoot), so a root a later phase adds is checked here too (architecture-b0-3).
  const underGeneratedRoot = cx.need<(file: string) => boolean>('underGeneratedRoot');
  const generated = tracked.filter((file) => underGeneratedRoot(file));
  if (generated.length > 0) return { failure: `the generated tree was committed (${generated.slice(0, 3).join(', ')}, …): the scaffold's .gitignore must exclude it (R4)`, worktree, main };
  if (viaSubmodule) {
    const stage = (await run(cx, 'git ls-files --stage', 'git', ['ls-files', '--stage', '--', 'tools/agbcc'], main)).stdout;
    if (!/^160000 /m.test(stage)) return { failure: `setup.sh in the main checkout did not register tools/agbcc as a submodule (git ls-files --stage: ${JSON.stringify(stage.trim())})`, worktree, main };
  }
  await run(cx, 'git worktree add', 'git', ['worktree', 'add', '-q', '-b', 'gate-worktree', worktree], main);
  if (await exists(path.join(worktree, ROM_FILE))) return { failure: 'the fresh worktree already holds the ROM', worktree, main };
  if (agbcc !== undefined && !viaSubmodule) await cp(agbcc, path.join(worktree, 'tools', 'agbcc'), { recursive: true });
  const setup = await cx.exec('./setup.sh', [], { cwd: worktree, env });
  if (setup.code !== 0) return { failure: `./setup.sh in the worktree exited ${setup.code}:\n${tail(setup)}`, worktree, main };
  if (!/asm\/ is absent: running romlift generate/.test(`${setup.stdout}${setup.stderr}`)) {
    return { failure: `setup.sh in the worktree did not generate the tree (duty 5):\n${tail(setup)}`, worktree, main };
  }
  if (viaSubmodule && !/checking out the tools\/agbcc submodule/.test(`${setup.stdout}${setup.stderr}`)) {
    return { failure: `setup.sh in the worktree did not check the tools/agbcc submodule out:\n${tail(setup)}`, worktree, main };
  }
  const copied = path.join(worktree, ROM_FILE);
  if (!(await exists(copied))) return { failure: `setup.sh did not copy ${ROM_FILE} from the main checkout`, worktree, main };
  if (sha1(await readFile(copied)) !== expected) return { failure: `the copied ${ROM_FILE} differs from the main checkout's`, worktree, main };
  const make = await cx.exec('make', [], { cwd: worktree, env });
  if (make.code !== 0) return { failure: `make in the worktree exited ${make.code}:\n${tail(make)}`, worktree, main };
  const recorded = await sha1File(worktree);
  if (recorded.sha1 !== expected) return { failure: `the .sha1 file records ${recorded.sha1}, expected ${expected}`, worktree, main };
  const built = path.join(worktree, recorded.file);
  const actual = (await exists(built)) ? sha1(await readFile(built)) : 'nothing';
  return actual === expected ? { worktree, main } : { failure: `make in the worktree built ${actual}, expected ${expected}`, worktree, main };
}

gate({
  id: 'g4.worktree',
  phase: 4,
  tier: 'both',
  inputs: ['toolchain'],
  realInputs: ['roms'],
  needs: ['init', 'generate', 'underGeneratedRoot'],
  async run(cx) {
    const targets: Target[] = cx.fixtures.filter((f) => !NOT_BUILT.has(f.name)).map((f) => ({ name: f.name, rom: f.rom }));
    if (targets.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    if (cx.tier === 'real') for (const d of cx.datasets) targets.push({ name: d.name, rom: path.resolve(cx.benchRoot, d.rom) });
    const cli = await sourceCli(cx);
    const base = await cx.tmpDir('romlift-worktree-');
    const problems: string[] = [];
    let agbcc: string | undefined;
    for (const [i, target] of targets.entries()) {
      const { failure, worktree, main } = await inWorktree(cx, cli, target, base, agbcc, i === 0);
      if (failure !== undefined) problems.push(`${target.name}: ${failure}`);
      for (const built of [path.join(main, 'tools', 'agbcc'), path.join(worktree, 'tools', 'agbcc')]) {
        if (agbcc === undefined && (await exists(path.join(built, 'bin', 'agbcc')))) agbcc = built;
      }
    }
    if (problems.length > 0) throw new Error(`the worktree build: ${problems.join(' | ')}`);
    cx.note(`${targets.length} fresh worktrees copied the ROM and built to the SHA-1; ${targets[0]?.name ?? '?'} through the tools/agbcc submodule setup.sh registered in the main checkout`);
  },
});
