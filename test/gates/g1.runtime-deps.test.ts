// g1.runtime-deps (architecture §13, R2, D38): package.json `dependencies` is exactly smol-toml, zod and
// @match-kit/decomp-yaml, and no package of the production tree has an install script, a compiled
// `.node` addon or a `binding.gyp` (which npm would build with node-gyp). The production tree is the
// lock file's `packages` without `dev: true`, each directory resolved from the repository root and
// checked against the package names of `npm ls --all --omit=dev --json`; paths npm prints are never
// trusted (npm 11 redacts UUID-like path segments in --parseable output).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult } from './gate.ts';

const EXPECTED = ['@match-kit/decomp-yaml', 'smol-toml', 'zod'] as const;
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const;

interface LockFile {
  readonly packages?: Readonly<Record<string, { readonly dev?: boolean; readonly name?: string }>>;
}

interface NpmTree {
  readonly dependencies?: Readonly<Record<string, NpmTree>>;
}

/** Every package name of an `npm ls --json` tree, once each. */
function treeNames(tree: NpmTree, into = new Set<string>()): Set<string> {
  for (const [name, child] of Object.entries(tree.dependencies ?? {})) {
    into.add(name);
    treeNames(child, into);
  }
  return into;
}

/** The package name of a lock-file key: the part after its last `node_modules/`. */
function lockName(key: string): string {
  const at = key.lastIndexOf('node_modules/');
  return at < 0 ? key : key.slice(at + 'node_modules/'.length);
}

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

    const lock = JSON.parse(await readFile(path.join(cx.repoRoot, 'package-lock.json'), 'utf8')) as LockFile;
    const keys = Object.entries(lock.packages ?? {})
      .filter(([key, entry]) => key !== '' && entry.dev !== true)
      .map(([key]) => key)
      .sort(byCodeUnit);
    const ls = await cx.exec('npm', ['ls', '--all', '--omit=dev', '--json'], { cwd: cx.repoRoot });
    if (ls.code !== 0) throw new Error(`npm ls --all --omit=dev --json exited ${ls.code}:\n${tail(ls)}`);
    const listed = [...treeNames(JSON.parse(ls.stdout) as NpmTree)].sort(byCodeUnit);
    const locked = [...new Set(keys.map(lockName))].sort(byCodeUnit);
    if (listed.join('\n') !== locked.join('\n')) {
      throw new Error(`npm ls lists the production packages [${listed.join(', ')}], the lock file [${locked.join(', ')}]`);
    }
    const root = path.resolve(cx.repoRoot);
    const dirs = keys.map((key) => path.join(root, key));
    if (dirs.length < EXPECTED.length) throw new Error(`the lock file lists ${dirs.length} production packages, fewer than the ${EXPECTED.length} dependencies`);

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
