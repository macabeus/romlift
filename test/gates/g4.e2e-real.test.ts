// g4.e2e-real (architecture §1, §8.4 "Scaffold", §13, R1): in a directory that holds only the ROM,
// `romlift init <rom> && ./setup.sh && make` ends at the ROM's SHA-1 with no file edited by hand, on all six
// tuning ROMs (D60: the roadmap's "five" reads as the six since tmc's reveal, D62 h, D74). Sealed held-out ROMs run the same command and report counts only (how many reach their
// SHA-1); nothing of their output is printed or recorded, and they do not decide the verdict.
//
// Interfaces, frozen by D74 (as in g4.e2e-fixtures):
//   romlift init <rom> --json                            exit 0; NDJSON, last line {"type":"summary",...}
//   setup.sh runs romlift as `$ROMLIFT_CLI` when it is set and then skips its npm duty
//   <name>.sha1 holds `<sha1>  <file>` (sha1sum format), <file> being the ROM `make` builds
// Every ROM is copied in as `baserom.gba`. The first project builds agbcc through setup.sh; later projects
// get a copy of its tools/agbcc, so one gate run builds the compiler once.
// The tuning ROMs run twice (roadmap "Phase 4 exit": "from the source tree and from the installed tarball", D75 o):
// with the source CLI, then from the packed and installed package, as g4.packed-e2e installs it (`npm run build`,
// `npm pack`, `npm install --ignore-scripts <tarball>` into an empty directory), with `npx romlift init` in a directory
// below the install and setup.sh's ROMLIFT_CLI set to the installed bin.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { copyAgbcc, gate, withLock, type DatasetRef, type ExecResult, type GateContext } from './gate.ts';

interface CliLine {
  readonly type: string;
  readonly exitCode?: number;
}

const ROM_FILE = 'baserom.gba';
const TUNING_ROMS = 6;

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

async function sha1File(dir: string): Promise<{ readonly sha1: string; readonly file: string } | undefined> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sha1'));
  if (names.length !== 1 || names[0] === undefined) return undefined;
  const match = /^([0-9a-f]{40})\s+\*?(\S+)\s*$/m.exec(await readFile(path.join(dir, names[0]), 'utf8'));
  return match?.[1] === undefined || match[2] === undefined ? undefined : { sha1: match[1], file: match[2] };
}

/** The packed package installed into `dir`: its romlift bin (`npm run build`, `npm pack`, `npm install --ignore-scripts`). */
async function installedTarball(cx: GateContext, dir: string): Promise<string> {
  const packs = path.join(dir, 'pack');
  const tool = path.join(dir, 'install');
  await mkdir(packs, { recursive: true });
  await mkdir(tool, { recursive: true });
  const tarball = await withLock('dist', async () => {
    const build = await cx.exec('npm', ['run', '--silent', 'build'], { cwd: cx.repoRoot });
    if (build.code !== 0) throw new Error(`npm run build exited ${build.code}:\n${tail(build)}`);
    const packed = await cx.exec('npm', ['pack', '--json', '--pack-destination', packs], { cwd: cx.repoRoot });
    if (packed.code !== 0) throw new Error(`npm pack exited ${packed.code}:\n${tail(packed)}`);
    const name = (JSON.parse(packed.stdout) as readonly { readonly filename: string }[])[0]?.filename;
    if (name === undefined) throw new Error('npm pack --json listed no tarball');
    return path.join(packs, name);
  });
  const install = await cx.exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: tool });
  if (install.code !== 0) throw new Error(`npm install --ignore-scripts <tarball> exited ${install.code}:\n${tail(install)}`);
  const bin = path.join(tool, 'node_modules', '.bin', 'romlift');
  if (!(await exists(bin))) throw new Error('the installed package has no romlift bin');
  return bin;
}

/** How `init` is run: the source CLI shim, or `npx romlift` below the tarball's install (whose bin setup.sh then runs). */
interface Runner {
  readonly init: readonly string[];
  readonly bin: string;
}

/** init, setup.sh and make; returns the failure (with output unless `sealed`), or undefined at the SHA-1. */
async function build(cx: GateContext, runner: Runner, dataset: DatasetRef, dir: string, agbcc: string | undefined, sealed: boolean): Promise<string | undefined> {
  const shown = (run: ExecResult): string => (sealed ? '(output withheld: sealed)' : `\n${tail(run)}`);
  const cli = runner.bin;
  await mkdir(dir, { recursive: true });
  await copyFile(path.resolve(cx.benchRoot, dataset.rom), path.join(dir, ROM_FILE));
  const [command = cli, ...prefix] = runner.init;
  const init = await cx.exec(command, [...prefix, 'init', ROM_FILE, '--json'], { cwd: dir });
  let last: CliLine | undefined;
  try {
    last = cx.jsonLines<CliLine>(init.stdout).at(-1);
  } catch {
    return `init --json printed bad NDJSON ${shown(init)}`;
  }
  if (init.code !== 0 || last?.type !== 'summary' || last.exitCode !== 0) return `init exited ${init.code} ${shown(init)}`;
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  if (agbcc !== undefined) await copyAgbcc(agbcc, dir);
  const env = { ROMLIFT_CLI: cli };
  const setup = await cx.exec('./setup.sh', [], { cwd: dir, env });
  if (setup.code !== 0) return `./setup.sh exited ${setup.code} ${shown(setup)}`;
  const make = await cx.exec('make', [], { cwd: dir, env });
  if (make.code !== 0) return `make exited ${make.code} ${shown(make)}`;
  if ((await readFile(path.join(dir, 'romlift.toml'), 'utf8')) !== toml) return 'setup.sh or make changed romlift.toml';
  const target = await sha1File(dir);
  if (target === undefined) return 'the project has no single <name>.sha1 in sha1sum format';
  if (target.sha1 !== dataset.sha1) return sealed ? 'the .sha1 file records another SHA-1' : `the .sha1 file records ${target.sha1}, the dataset ${dataset.sha1}`;
  const built = path.join(dir, target.file);
  if (!(await exists(built))) return 'make built no ROM';
  const actual = sha1(await readFile(built));
  if (actual === dataset.sha1) return undefined;
  return sealed ? 'the built ROM differs' : `make built SHA-1 ${actual}, expected ${dataset.sha1}`;
}

gate({
  id: 'g4.e2e-real',
  phase: 4,
  tier: 'real',
  inputs: ['roms', 'toolchain'],
  needs: ['init', 'generate'],
  async run(cx) {
    if (cx.datasets.length < TUNING_ROMS) throw new Error(`${cx.datasets.length} tuning datasets; the gate runs all ${TUNING_ROMS}`);
    const cli = await sourceCli(cx);
    const source: Runner = { init: [cli], bin: cli };
    const base = await cx.tmpDir('romlift-e2e-real-');
    const problems: string[] = [];
    let agbcc: string | undefined;
    const remember = async (dir: string): Promise<void> => {
      if (agbcc === undefined && (await exists(path.join(dir, 'tools', 'agbcc', 'bin', 'agbcc')))) agbcc = path.join(dir, 'tools', 'agbcc');
    };
    for (const dataset of cx.datasets) {
      const dir = path.join(base, 'tuning', dataset.name);
      const failure = await build(cx, source, dataset, dir, agbcc, false);
      if (failure !== undefined) problems.push(`${dataset.name}: ${failure}`);
      else cx.note(`${dataset.name} reaches ${dataset.sha1}`);
      await remember(dir);
    }
    const bin = await installedTarball(cx, path.join(base, 'packed'));
    const packed: Runner = { init: ['npx', '--no', 'romlift'], bin };
    for (const dataset of cx.datasets) {
      const failure = await build(cx, packed, dataset, path.join(base, 'packed', 'install', 'projects', dataset.name), agbcc, false);
      if (failure !== undefined) problems.push(`${dataset.name} from the tarball: ${failure}`);
      else cx.note(`${dataset.name} reaches ${dataset.sha1} from the installed tarball`);
    }
    let sealedOk = 0;
    for (let i = 0; i < cx.sealed.length; i++) {
      const dataset = cx.sealed[i];
      if (dataset === undefined) continue;
      if ((await build(cx, source, dataset, path.join(base, 'sealed', String(i)), agbcc, true)) === undefined) sealedOk++;
    }
    if (cx.sealed.length > 0) cx.note(`sealed: ${sealedOk} of ${cx.sealed.length} held-out ROMs reach their SHA-1 (counts only)`);
    if (problems.length > 0) throw new Error(`end to end on the tuning ROMs: ${problems.join(' | ')}`);
    cx.note(`all ${cx.datasets.length} tuning ROMs reach their SHA-1 from init, setup.sh and make, from the source tree and from the installed tarball`);
  },
});
