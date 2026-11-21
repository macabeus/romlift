// g3.tree-determinism (architecture §4.4, §13, R4, D30): two processes emit one tree. Each process copies
// the ROM into its own project directory and emits the tree from there; the second runs from another
// working directory and project path with TZ=Pacific/Kiritimati and LANG/LC_ALL=tr_TR.UTF-8. The tree
// digests must be equal and no emitted file may contain either project's absolute path. The ci tier runs
// every committed fixture; the real tier adds the tuning ROMs. Digests are recorded so CI can compare both
// Node versions.
//
// Each process runs CHILD below, which loads the package through its own entry points (`romlift`,
// `romlift/node`, resolved from the repository's package.json, as D37 requires) and calls the phase-3 API as
// frozen in architecture §3.4 (aligned by the phase-3 lead, D62; configFromDiscover's options default):
//   romFromBytes(bytes, sha1Of(bytes)); analyze(rom, profileById('agbcc'), {mode: 'discover', seeds: [],
//   overrides: [], trail: 'off'}); configFromDiscover(rom, analysis); buildModel(rom, analysis, config);
//   emitTree(rom, model, {decomp: {defined: []}})
// The tree digest is the sha256 over path, NUL, content (a reconciled entry's edits as JSON), NUL, for each
// entry in stream order (frozen in core/emit/tree.ts: per generated module in ROM order its module-scoped
// writers' files by path, then the global writers' files by path).
import { copyFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { gate, onTargets, reportTargets, type ExecResult, type GateContext, type TargetReport } from './gate.ts';

const VARIED_ENV: Readonly<Record<string, string>> = { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' };

const CHILD = `
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const repo = process.env.ROMLIFT_TREE_REPO;
const romPath = process.env.ROMLIFT_TREE_ROM;
const needles = JSON.parse(process.env.ROMLIFT_TREE_NEEDLES);
const resolve = createRequire(repo + '/package.json').resolve;
const api = { ...(await import(pathToFileURL(resolve('romlift/node')).href)), ...(await import(pathToFileURL(resolve('romlift')).href)) };
const bytes = new Uint8Array(readFileSync(romPath));
const rom = api.romFromBytes(bytes, api.sha1Of(bytes));
const analysis = api.analyze(rom, api.profileById('agbcc'), { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
const config = api.configFromDiscover(rom, analysis);
const model = api.buildModel(rom, analysis, config);
const hash = createHash('sha256');
let files = 0;
const leaks = [];
for (const entry of api.emitTree(rom, model, { decomp: { defined: [] } })) {
  const body = entry.ownership === 'reconciled' ? JSON.stringify(entry.edits) : entry.text;
  hash.update(entry.path + '\\0' + body + '\\0');
  files++;
  if (needles.some((needle) => entry.path.includes(needle) || body.includes(needle))) leaks.push(entry.path);
}
process.stdout.write(JSON.stringify({ treeDigest: hash.digest('hex'), files, leaks }) + '\\n');
`;

interface Tree {
  readonly treeDigest: string;
  readonly files: number;
  readonly leaks: readonly string[];
}

interface Target {
  readonly name: string;
  readonly rom: string;
}

function tail(run: ExecResult, lines = 20): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

async function emitIn(cx: GateContext, target: Target, dir: string, env: Readonly<Record<string, string>>): Promise<Tree> {
  await mkdir(dir, { recursive: true });
  const rom = path.join(dir, `${target.name}.gba`);
  await copyFile(target.rom, rom);
  const needles = [...new Set([dir, await realpath(dir)])];
  const run = await cx.exec(process.execPath, ['--conditions=source', '--input-type=module', '--eval', CHILD], {
    cwd: dir,
    env: { ...env, ROMLIFT_TREE_REPO: cx.repoRoot, ROMLIFT_TREE_ROM: rom, ROMLIFT_TREE_NEEDLES: JSON.stringify(needles) },
  });
  if (run.code !== 0) throw new Error(`${target.name}: the emission process exited ${run.code} in ${dir}:\n${tail(run)}`);
  return cx.lastJson<Tree>(run.stdout);
}

gate({
  id: 'g3.tree-determinism',
  phase: 3,
  tier: 'both',
  realInputs: ['roms'],
  needs: ['romFromBytes', 'sha1Of', 'profileById', 'analyze', 'configFromDiscover', 'buildModel', 'emitTree'],
  async run(cx) {
    const fixtures: Target[] = cx.fixtures.map((f) => ({ name: f.name, rom: f.rom }));
    if (fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    const datasets: Target[] = cx.tier === 'real' ? cx.datasets.map((d) => ({ name: d.name, rom: path.resolve(cx.benchRoot, d.rom) })) : [];
    const targets = [...fixtures, ...datasets];

    const base = await cx.tmpDir('romlift-tree-determinism-');
    // Each target's two runs one after the other; the fixtures FIXTURE_PARALLELISM at once, the tuning ROMs one at a time.
    const reports = await onTargets(fixtures, datasets, async (target): Promise<TargetReport> => {
      const problems: string[] = [];
      const first = await emitIn(cx, target, path.join(base, 'first', target.name), {});
      const second = await emitIn(cx, target, path.join(base, 'second run', 'elsewhere', target.name), VARIED_ENV);
      if (first.treeDigest !== second.treeDigest) problems.push(`${target.name}: tree ${first.treeDigest} (${first.files} files) then ${second.treeDigest} (${second.files} files)`);
      const leaks = [...first.leaks, ...second.leaks];
      if (leaks.length > 0) problems.push(`${target.name}: files contain the project path: ${[...new Set(leaks)].slice(0, 8).join(', ')}`);
      if (first.files === 0) problems.push(`${target.name}: the tree is empty`);
      return { problems, notes: [`${target.name} tree ${first.treeDigest} (${first.files} files)`] };
    });
    const problems = reportTargets(cx, reports);
    if (problems.length > 0) throw new Error(`the tree is not deterministic: ${problems.join('; ')}`);
    cx.note(`${targets.length} trees identical across cwd, project path, TZ and locale; no file names a project path`);
  },
});
