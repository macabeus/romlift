// g4.packed-e2e (architecture §2, §8.6 `packed.yml`, §13): the published tarball works on its own. The gate
// builds dist/, packs the package, checks that the tarball lists templates/** and dist/** and no ROM, ELF,
// map or built signature file, installs it with --ignore-scripts into an empty directory, runs `romlift
// doctor` from it, and then, for every committed fixture except c-data, runs `npx romlift init <rom>` in a
// directory below the install that holds only the ROM, `./setup.sh` and `make`, which must end at the
// fixture's SHA-1.
//
// Interfaces, frozen by D74 (as in g4.e2e-fixtures):
//   npm pack --json                                      a JSON array whose [0] has filename and files[].path
//   romlift doctor --json, romlift init <rom> --json     NDJSON, last line {"type":"summary","exitCode":0}
//   setup.sh runs romlift as `$ROMLIFT_CLI` when it is set and then skips its npm duty; the gate sets it
//   to the installed bin, since the pinned version is not on the registry.
//   <name>.sha1 holds `<sha1>  <file>` (sha1sum format), <file> being the ROM `make` builds.
// `npx` resolves the installed bin because the project directory sits below the install's package.json.
// The first fixture runs setup.sh without ROMLIFT_CLI (D75 o): its package.json's romlift dependency is pointed at
// the tarball (`file:`), the one stand-in for a published version, and asm/ is removed, so setup.sh's duty 4 installs
// romlift with npm (no lock yet: `npm install`) and duty 5 runs `npx romlift generate` from that install; make must
// still end at the SHA-1.
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, withLock, type ExecResult, type FixtureRef, type GateContext } from './gate.ts';

interface PackResult {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

interface CliLine {
  readonly type: string;
  readonly exitCode?: number;
}

const NOT_BUILT: Readonly<Record<string, string>> = { 'c-data': 'its C array must fail the link (g4.c-data-fails-loud)' };
const FORBIDDEN = /\.(gba|elf|map|o|sav)$/i;
const BUILT_SIGNATURES = /^signatures\/(?!specs\/)[^/]+\.json$/;

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

function summaryOk(cx: GateContext, run: ExecResult): boolean {
  try {
    const last = cx.jsonLines<CliLine>(run.stdout).at(-1);
    return run.code === 0 && last?.type === 'summary' && last.exitCode === 0;
  } catch {
    return false;
  }
}

/** Builds dist/ and packs the package into `dir`; returns the tarball and its file list. */
async function pack(cx: GateContext, dir: string): Promise<{ readonly tarball: string; readonly files: readonly string[] }> {
  return withLock('dist', async () => {
    const build = await cx.exec('npm', ['run', '--silent', 'build'], { cwd: cx.repoRoot });
    if (build.code !== 0) throw new Error(`npm run build exited ${build.code}:\n${tail(build)}`);
    const packed = await cx.exec('npm', ['pack', '--json', '--pack-destination', dir], { cwd: cx.repoRoot });
    if (packed.code !== 0) throw new Error(`npm pack exited ${packed.code}:\n${tail(packed)}`);
    const result = (JSON.parse(packed.stdout) as readonly PackResult[])[0];
    if (result === undefined) throw new Error('npm pack --json listed no tarball');
    return { tarball: path.join(dir, result.filename), files: result.files.map((f) => f.path) };
  });
}

function contentProblems(files: readonly string[]): readonly string[] {
  const problems: string[] = [];
  if (!files.some((f) => f.startsWith('dist/'))) problems.push('no dist/** file');
  if (!files.some((f) => f.startsWith('templates/'))) problems.push('no templates/** file');
  if (!files.includes('dist/cli/main.js')) problems.push('no dist/cli/main.js (the bin)');
  const forbidden = files.filter((f) => FORBIDDEN.test(f) || BUILT_SIGNATURES.test(f));
  if (forbidden.length > 0) problems.push(`forbidden files: ${forbidden.slice(0, 8).join(', ')}`);
  return problems;
}

async function sha1File(dir: string): Promise<{ readonly sha1: string; readonly file: string } | undefined> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sha1'));
  if (names.length !== 1 || names[0] === undefined) return undefined;
  const match = /^([0-9a-f]{40})\s+\*?(\S+)\s*$/m.exec(await readFile(path.join(dir, names[0]), 'utf8'));
  return match?.[1] === undefined || match[2] === undefined ? undefined : { sha1: match[1], file: match[2] };
}

/** `npm` duty and `npx` duty of setup.sh without ROMLIFT_CLI: the project's romlift is the tarball, asm/ regenerated. */
async function withoutBypass(dir: string, tarball: string): Promise<string | undefined> {
  const file = path.join(dir, 'package.json');
  const json = JSON.parse(await readFile(file, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const table = json.devDependencies?.['romlift'] !== undefined ? json.devDependencies : json.dependencies;
  if (table?.['romlift'] === undefined) return 'the scaffold package.json pins no romlift';
  table['romlift'] = `file:${tarball}`;
  await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
  await rm(path.join(dir, 'package-lock.json'), { force: true });
  await rm(path.join(dir, 'asm'), { recursive: true, force: true });
  return undefined;
}

async function build(cx: GateContext, bin: string, fixture: FixtureRef, dir: string, agbcc: string | undefined, tarball?: string): Promise<string | undefined> {
  const expected = sha1(await readFile(fixture.rom));
  await mkdir(dir, { recursive: true });
  const rom = `${fixture.name}.gba`;
  await copyFile(fixture.rom, path.join(dir, rom));
  const init = await cx.exec('npx', ['--no', 'romlift', 'init', rom, '--json'], { cwd: dir });
  if (!summaryOk(cx, init)) return `npx romlift init exited ${init.code}:\n${tail(init)}`;
  if (agbcc !== undefined) await cp(agbcc, path.join(dir, 'tools', 'agbcc'), { recursive: true });
  if (tarball !== undefined) {
    const prepared = await withoutBypass(dir, tarball);
    if (prepared !== undefined) return prepared;
  }
  const env = { ROMLIFT_CLI: tarball === undefined ? bin : '' };
  const setup = await cx.exec('./setup.sh', [], { cwd: dir, env });
  if (setup.code !== 0) return `./setup.sh exited ${setup.code}:\n${tail(setup)}`;
  if (tarball !== undefined) {
    const said = `${setup.stdout}${setup.stderr}`;
    if (/ROMLIFT_CLI is set/.test(said)) return 'setup.sh took the ROMLIFT_CLI bypass';
    if (!(await exists(path.join(dir, 'node_modules', '.bin', 'romlift')))) return "setup.sh's npm duty installed no romlift bin";
    if (!(await exists(path.join(dir, 'asm')))) return "setup.sh's generate duty wrote no asm/";
  }
  const make = await cx.exec('make', [], { cwd: dir, env });
  if (make.code !== 0) return `make exited ${make.code}:\n${tail(make)}`;
  const target = await sha1File(dir);
  if (target === undefined) return 'no single <name>.sha1 in sha1sum format';
  const built = path.join(dir, target.file);
  if (!(await exists(built))) return `make did not build ${target.file}`;
  const actual = sha1(await readFile(built));
  return actual === expected && target.sha1 === expected ? undefined : `built ${actual}, .sha1 records ${target.sha1}, expected ${expected}`;
}

gate({
  id: 'g4.packed-e2e',
  phase: 4,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['init', 'generate'],
  async run(cx) {
    if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    const base = await cx.tmpDir('romlift-packed-');
    const packs = path.join(base, 'pack');
    await mkdir(packs);
    const { tarball, files } = await pack(cx, packs);
    const content = contentProblems(files);
    if (content.length > 0) throw new Error(`the tarball's content: ${content.join('; ')}`);

    const tool = path.join(base, 'install');
    await mkdir(tool);
    const install = await cx.exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: tool });
    if (install.code !== 0) throw new Error(`npm install --ignore-scripts <tarball> exited ${install.code}:\n${tail(install)}`);
    const bin = path.join(tool, 'node_modules', '.bin', 'romlift');
    if (!(await exists(bin))) throw new Error('the installed package has no romlift bin');
    const doctor = await cx.exec(bin, ['doctor', '--json'], { cwd: tool });
    if (!summaryOk(cx, doctor)) throw new Error(`romlift doctor from the tarball exited ${doctor.code}:\n${tail(doctor)}`);

    const problems: string[] = [];
    let agbcc: string | undefined;
    let built = 0;
    let throughNpm = true;
    for (const fixture of cx.fixtures) {
      if (NOT_BUILT[fixture.name] !== undefined) continue;
      const dir = path.join(tool, 'projects', fixture.name);
      const failure = await build(cx, bin, fixture, dir, agbcc, throughNpm ? tarball : undefined);
      if (throughNpm && failure === undefined) cx.note(`${fixture.name}: setup.sh without ROMLIFT_CLI installed romlift from the tarball (npm install) and ran npx romlift generate`);
      throughNpm = false;
      if (failure !== undefined) problems.push(`${fixture.name}: ${failure}`);
      else built++;
      if (agbcc === undefined && (await exists(path.join(dir, 'tools', 'agbcc', 'bin', 'agbcc')))) agbcc = path.join(dir, 'tools', 'agbcc');
    }
    if (problems.length > 0) throw new Error(`end to end from the tarball: ${problems.join(' | ')}`);
    cx.note(`${path.basename(tarball)}: ${files.length} files, no ROM, ELF, map or built signature file; doctor runs; ${built} fixtures reach their SHA-1`);
  },
});
