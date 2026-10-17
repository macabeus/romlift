// g1.runtime-deps (architecture §13, R2, D38): package.json `dependencies` is exactly smol-toml, zod and
// @match-kit/decomp-yaml, and no package of the production tree has an install script, a compiled
// `.node` addon or a `binding.gyp` (which npm would build with node-gyp).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult } from './gate.ts';

const EXPECTED = ['@match-kit/decomp-yaml', 'smol-toml', 'zod'] as const;
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const;

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly gypfile?: boolean;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function tail(run: ExecResult, lines = 20): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** Native build artefacts under one package directory, not descending into its own node_modules. */
async function nativeFiles(dir: string, prefix = ''): Promise<readonly string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') found.push(...(await nativeFiles(path.join(dir, entry.name), relative)));
    } else if (entry.name.endsWith('.node') || entry.name === 'binding.gyp') {
      found.push(relative);
    }
  }
  return found;
}

gate({
  id: 'g1.runtime-deps',
  phase: 1,
  tier: 'ci',
  needs: [],
  async run(cx) {
    const manifest = JSON.parse(await readFile(path.join(cx.repoRoot, 'package.json'), 'utf8')) as PackageJson;
    const declared = Object.keys(manifest.dependencies ?? {}).sort(byCodeUnit);
    if (declared.join('\n') !== EXPECTED.join('\n')) {
      throw new Error(`package.json dependencies are [${declared.join(', ')}], expected exactly [${EXPECTED.join(', ')}]`);
    }

    const ls = await cx.exec('npm', ['ls', '--all', '--omit=dev', '--parseable'], { cwd: cx.repoRoot });
    if (ls.code !== 0) throw new Error(`npm ls --all --omit=dev --parseable exited ${ls.code}:\n${tail(ls)}`);
    const root = path.resolve(cx.repoRoot);
    const dirs = [...new Set(ls.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '' && path.resolve(l) !== root))].sort(byCodeUnit);
    if (dirs.length < EXPECTED.length) throw new Error(`npm ls listed ${dirs.length} production packages, fewer than the ${EXPECTED.length} dependencies`);

    const problems: string[] = [];
    for (const dir of dirs) {
      const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as PackageJson;
      const label = pkg.name ?? path.relative(root, dir);
      for (const script of INSTALL_SCRIPTS) {
        if (pkg.scripts?.[script] !== undefined) problems.push(`${label} has a ${script} script`);
      }
      if (pkg.gypfile === true) problems.push(`${label} declares gypfile`);
      for (const file of await nativeFiles(dir)) problems.push(`${label} contains ${file}`);
    }
    if (problems.length > 0) throw new Error(`the production tree is not pure JavaScript: ${problems.join('; ')}`);
    cx.note(`dependencies: ${declared.join(', ')}; production tree: ${dirs.length} packages, no install script, .node or binding.gyp`);
  },
});
