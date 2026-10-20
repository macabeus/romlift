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
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type DatasetRef, type ExecResult, type GateContext } from './gate.ts';

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

/** init, setup.sh and make; returns the failure (with output unless `sealed`), or undefined at the SHA-1. */
async function build(cx: GateContext, cli: string, dataset: DatasetRef, dir: string, agbcc: string | undefined, sealed: boolean): Promise<string | undefined> {
  const shown = (run: ExecResult): string => (sealed ? '(output withheld: sealed)' : `\n${tail(run)}`);
  await mkdir(dir, { recursive: true });
  await copyFile(path.resolve(cx.benchRoot, dataset.rom), path.join(dir, ROM_FILE));
  const init = await cx.exec(cli, ['init', ROM_FILE, '--json'], { cwd: dir });
  let last: CliLine | undefined;
  try {
    last = cx.jsonLines<CliLine>(init.stdout).at(-1);
  } catch {
    return `init --json printed bad NDJSON ${shown(init)}`;
  }
  if (init.code !== 0 || last?.type !== 'summary' || last.exitCode !== 0) return `init exited ${init.code} ${shown(init)}`;
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  if (agbcc !== undefined) await cp(agbcc, path.join(dir, 'tools', 'agbcc'), { recursive: true });
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
    const base = await cx.tmpDir('romlift-e2e-real-');
    const problems: string[] = [];
    let agbcc: string | undefined;
    const remember = async (dir: string): Promise<void> => {
      if (agbcc === undefined && (await exists(path.join(dir, 'tools', 'agbcc', 'bin', 'agbcc')))) agbcc = path.join(dir, 'tools', 'agbcc');
    };
    for (const dataset of cx.datasets) {
      const dir = path.join(base, 'tuning', dataset.name);
      const failure = await build(cx, cli, dataset, dir, agbcc, false);
      if (failure !== undefined) problems.push(`${dataset.name}: ${failure}`);
      else cx.note(`${dataset.name} reaches ${dataset.sha1}`);
      await remember(dir);
    }
    let sealedOk = 0;
    for (let i = 0; i < cx.sealed.length; i++) {
      const dataset = cx.sealed[i];
      if (dataset === undefined) continue;
      if ((await build(cx, cli, dataset, path.join(base, 'sealed', String(i)), agbcc, true)) === undefined) sealedOk++;
    }
    if (cx.sealed.length > 0) cx.note(`sealed: ${sealedOk} of ${cx.sealed.length} held-out ROMs reach their SHA-1 (counts only)`);
    if (problems.length > 0) throw new Error(`end to end on the tuning ROMs: ${problems.join(' | ')}`);
    cx.note(`all ${cx.datasets.length} tuning ROMs reach their SHA-1 from init, setup.sh and make`);
  },
});
