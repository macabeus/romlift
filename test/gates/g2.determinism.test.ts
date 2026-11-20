// g2.determinism (architecture §4.4, §13, D30): two processes give one analysis. The second runs from
// another working directory, with the ROM at another project path, TZ=Pacific/Kiritimati and
// LANG=tr_TR.UTF-8 (LC_ALL too, which would otherwise override LANG). The ci tier runs every committed
// fixture; the real tier adds the tuning ROMs. The digests are recorded so CI can compare both Node versions.
//
// Each process reads the ROM by a relative path and prints encodeAnalysis of its discover analysis (romlift's
// canonical romlift/analysis@1 JSON), which must hold no path, time or locale. The analysis digest here is the
// sha256 of that whole stdout (D108).
import { createHash } from 'node:crypto';
import { copyFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gate, onTargets, reportTargets, type ExecResult, type GateContext, type TargetReport } from './gate.ts';

const VARIED_ENV: Readonly<Record<string, string>> = { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' };

interface Target {
  readonly name: string;
  readonly rom: string;
}

function tail(run: ExecResult, lines = 20): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** The child: reads argv[3] relative to its cwd, then prints encodeAnalysis(discover(rom)). */
const CHILD = [
  "const [index, node] = await Promise.all([import(process.argv[1]), import(process.argv[2])]);",
  'const read = await node.readRom(process.argv[3]);',
  "if (!read.ok) { process.stderr.write(read.diagnostic.message + '\\n'); process.exit(1); }",
  'for (const chunk of index.encodeAnalysis(index.discover(read.value))) process.stdout.write(chunk);',
].join('\n');

/** Copies the ROM into `<dir>/<project>/` and analyses it there, in a child process, with a relative ROM path. */
async function analyzeIn(cx: GateContext, target: Target, dir: string, env: Readonly<Record<string, string>>): Promise<{ readonly digest: string; readonly leaked: boolean }> {
  await mkdir(dir, { recursive: true });
  const file = `${target.name}.gba`;
  await copyFile(target.rom, path.join(dir, file));
  const entry = (name: string): string => pathToFileURL(path.join(cx.repoRoot, 'src', name)).href;
  const run = await cx.exec(process.execPath, ['--conditions=source', '--input-type=module', '-e', CHILD, entry('index.ts'), entry('node.ts'), file], { cwd: dir, env });
  if (run.code !== 0) throw new Error(`${target.name}: the discover analysis exited ${run.code} in ${dir}:\n${tail(run)}`);
  const resolved = await realpath(dir);
  return { digest: createHash('sha256').update(run.stdout).digest('hex'), leaked: run.stdout.includes(dir) || run.stdout.includes(resolved) };
}

gate({
  id: 'g2.determinism',
  phase: 2,
  tier: 'both',
  realInputs: ['roms'],
  needs: ['discover', 'encodeAnalysis', 'readRom'],
  async run(cx) {
    const fixtures: Target[] = cx.fixtures.map((f) => ({ name: f.name, rom: f.rom }));
    if (fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    const datasets: Target[] = cx.tier === 'real' ? cx.datasets.map((d) => ({ name: d.name, rom: path.resolve(cx.benchRoot, d.rom) })) : [];
    const targets = [...fixtures, ...datasets];

    const base = await cx.tmpDir('romlift-determinism-');
    // Each target's two runs one after the other; the fixtures FIXTURE_PARALLELISM at once, the tuning ROMs one at a time.
    const reports = await onTargets(fixtures, datasets, async (target): Promise<TargetReport> => {
      const problems: string[] = [];
      const first = await analyzeIn(cx, target, path.join(base, 'first', target.name), {});
      const second = await analyzeIn(cx, target, path.join(base, 'second run', 'elsewhere', target.name), VARIED_ENV);
      if (first.digest !== second.digest) problems.push(`${target.name}: ${first.digest} then ${second.digest}`);
      if (first.leaked || second.leaked) problems.push(`${target.name}: the output contains the project path`);
      return { problems, notes: [`${target.name} analysis ${first.digest}`] };
    });
    const problems = reportTargets(cx, reports);
    if (problems.length > 0) throw new Error(`the analysis is not deterministic: ${problems.join('; ')}`);
    cx.note(`${targets.length} analyses identical across cwd, project path, TZ and locale`);
  },
});
