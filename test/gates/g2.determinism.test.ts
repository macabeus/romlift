// g2.determinism (architecture §4.4, §13, D30): two processes give one analysis. The second runs from
// another working directory, with the ROM at another project path, TZ=Pacific/Kiritimati and
// LANG=tr_TR.UTF-8 (LC_ALL too, which would otherwise override LANG). The ci tier runs every committed
// fixture; the real tier adds the tuning ROMs. The digests are recorded so CI can compare Linux, macOS and
// both Node versions.
//
// Expected output, for the phase-2 lead to align (architecture §2.1):
//   romlift analyze <rom> --json   exit 0; deterministic NDJSON on stdout (functions with origin and
//   provenance, rejections, diagnostics, then a summary line), with no path, time or locale in it.
//   The analysis digest here is the sha256 of that whole stdout.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

const VARIED_ENV: Readonly<Record<string, string>> = { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' };

interface Target {
  readonly name: string;
  readonly rom: string;
}

function tail(run: ExecResult, lines = 20): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** Copies the ROM into `<dir>/<project>/` and runs `analyze` there with a relative ROM path. */
async function analyzeIn(cx: GateContext, target: Target, dir: string, env: Readonly<Record<string, string>>): Promise<{ readonly digest: string; readonly leaked: boolean }> {
  await mkdir(dir, { recursive: true });
  const file = `${target.name}.gba`;
  await copyFile(target.rom, path.join(dir, file));
  const cli = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  const run = await cx.exec(process.execPath, ['--conditions=source', cli, 'analyze', file, '--json'], { cwd: dir, env });
  if (run.code !== 0) throw new Error(`${target.name}: romlift analyze --json exited ${run.code} in ${dir}:\n${tail(run)}`);
  const resolved = await realpath(dir);
  return { digest: createHash('sha256').update(run.stdout).digest('hex'), leaked: run.stdout.includes(dir) || run.stdout.includes(resolved) };
}

gate({
  id: 'g2.determinism',
  phase: 2,
  tier: 'both',
  realInputs: ['roms'],
  needs: ['analyze', 'discover'],
  async run(cx) {
    const targets: Target[] = cx.fixtures.map((f) => ({ name: f.name, rom: f.rom }));
    if (targets.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    if (cx.tier === 'real') for (const d of cx.datasets) targets.push({ name: d.name, rom: path.resolve(cx.benchRoot, d.rom) });

    const base = await cx.tmpDir('romlift-determinism-');
    const problems: string[] = [];
    for (const target of targets) {
      const first = await analyzeIn(cx, target, path.join(base, 'first', target.name), {});
      const second = await analyzeIn(cx, target, path.join(base, 'second run', 'elsewhere', target.name), VARIED_ENV);
      if (first.digest !== second.digest) problems.push(`${target.name}: ${first.digest} then ${second.digest}`);
      if (first.leaked || second.leaked) problems.push(`${target.name}: the output contains the project path`);
      cx.note(`${target.name} analysis ${first.digest}`);
    }
    if (problems.length > 0) throw new Error(`the analysis is not deterministic: ${problems.join('; ')}`);
    cx.note(`${targets.length} analyses identical across cwd, project path, TZ and locale`);
  },
});
