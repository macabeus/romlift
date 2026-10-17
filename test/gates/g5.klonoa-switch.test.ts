// g5.klonoa-switch (architecture §6.8, §13, D52): the Klonoa switch-over commit, pinned as `switch` in
// bench/migration/klonoa.json, exists in the Klonoa checkout, lacks the four legacy tools
// (scripts/generate_asm.py, scripts/generate_expected.py, scripts/generate_ldscript.py and the tools/luvdis
// submodule), carries a romlift.toml that `import-legacy` wrote in keep mode, and builds to
// `klonoa-eod.gba: OK` with the repository's own `./setup.sh` and `make`. Keep mode is recognised by what it
// writes: every entry of functions_merged.cfg and of asm/thumb_aliases.s at `base` is listed, nothing else
// is, entries carry
// `from = "legacy"`, and none is turned into a `label = true` entry (that is --adopt-boundaries). The commit
// is checked out with `git worktree add --detach` into a temporary directory, removed afterwards.
//
// Expected interfaces, for the phase-5 lead to align (architecture §6.6, §6.8):
//   bench/migration/klonoa.json   {"base": "693ccb7…", "switch": "<commit>"}
//   parseLuvdisCfg(text) -> {ok: true, value: readonly {addr: number, …}[]} | {ok: false, error: string}
//   parseThumbAliases(text) -> {ok: true, value: readonly {addr: number, …}[]} | {ok: false, error: string}
//     (addr without the Thumb bit)
import { copyFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface Pins {
  readonly base: string;
  readonly switch?: string;
}

type ParseLegacy = (text: string) => { readonly ok: true; readonly value: readonly { readonly addr: number }[] } | { readonly ok: false; readonly error: string };

const KLONOA_DIR = 'klonoa-empire-of-dreams';
const LEGACY_FILES: readonly string[] = ['scripts/generate_asm.py', 'scripts/generate_expected.py', 'scripts/generate_ldscript.py'];
const OK_LINE = /^klonoa-eod\.gba: OK$/m;
const ENTRY = /^(0x[0-9A-F]{8})\s*=\s*(.*)$/;

function tail(run: ExecResult, lines = 40): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

async function git(cx: GateContext, repo: string, args: readonly string[]): Promise<ExecResult> {
  const run = await cx.exec('git', ['-C', repo, ...args]);
  if (run.code !== 0) throw new Error(`git ${args.join(' ')} exited ${run.code}:\n${tail(run)}`);
  return run;
}

/** The [functions] entries of a romlift.toml: address and the rest of the line. */
function listed(toml: string): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  let inFunctions = false;
  for (const line of toml.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) inFunctions = trimmed === '[functions]';
    const match = inFunctions ? ENTRY.exec(trimmed) : null;
    if (match?.[1] !== undefined) out.set(Number.parseInt(match[1], 16), match[2] ?? '');
  }
  return out;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

gate({
  id: 'g5.klonoa-switch',
  phase: 5,
  tier: 'real',
  inputs: ['klonoa', 'roms', 'toolchain'],
  needs: ['importLegacy', 'parseLuvdisCfg', 'parseThumbAliases'],
  async run(cx) {
    const pins = JSON.parse(await readFile(path.join(cx.repoRoot, 'bench', 'migration', 'klonoa.json'), 'utf8')) as Pins;
    const commit = pins.switch ?? '';
    if (commit === '') throw new Error('bench/migration/klonoa.json pins no switch commit yet');
    const repo = path.join(cx.benchRoot, KLONOA_DIR);
    await git(cx, repo, ['cat-file', '-e', `${commit}^{commit}`]);
    cx.digest('klonoa-switch', commit);

    const tree = new Set((await git(cx, repo, ['ls-tree', '-r', '--name-only', commit])).stdout.split('\n'));
    const problems: string[] = [];
    for (const file of LEGACY_FILES) if (tree.has(file)) problems.push(`${file} is still in the switch commit`);
    if ((await git(cx, repo, ['ls-tree', commit, 'tools/luvdis'])).stdout.trim() !== '') problems.push('the tools/luvdis submodule is still in the switch commit');
    if (tree.has('.gitmodules') && (await git(cx, repo, ['show', `${commit}:.gitmodules`])).stdout.includes('luvdis')) problems.push('.gitmodules still names luvdis');
    if (!tree.has('romlift.toml')) throw new Error(`the switch commit has no romlift.toml${problems.length > 0 ? `; also ${problems.join('; ')}` : ''}`);

    const legacy = new Set<number>();
    for (const [parser, file] of [['parseLuvdisCfg', 'functions_merged.cfg'], ['parseThumbAliases', 'asm/thumb_aliases.s']] as const) {
      const parsed = cx.need<ParseLegacy>(parser)((await git(cx, repo, ['show', `${pins.base}:${file}`])).stdout);
      if (!parsed.ok) throw new Error(`${file} at ${pins.base} does not parse: ${parsed.error}`);
      for (const e of parsed.value) legacy.add(e.addr & ~1);
    }
    const entries = listed((await git(cx, repo, ['show', `${commit}:romlift.toml`])).stdout);
    const missing = [...legacy].filter((a) => !entries.has(a));
    const added = [...entries.keys()].filter((a) => !legacy.has(a));
    const fromLegacy = [...entries.values()].filter((rest) => /\bfrom\s*=\s*"legacy"/.test(rest)).length;
    const labels = [...entries.values()].filter((rest) => /\blabel\s*=\s*true\b/.test(rest)).length;
    if (missing.length > 0) problems.push(`${missing.length} legacy entries are not listed (keep mode lists every one)`);
    if (added.length > 0) problems.push(`${added.length} listed entries are not legacy entries (keep mode adds nothing)`);
    if (fromLegacy === 0) problems.push('no entry carries from = "legacy"');
    if (labels > 0) problems.push(`${labels} entries are label = true, which only --adopt-boundaries writes`);
    if (problems.length > 0) throw new Error(`the switch commit ${commit}: ${problems.join('; ')}`);

    const dir = path.join(await cx.tmpDir('romlift-klonoa-switch-'), 'checkout');
    await git(cx, repo, ['worktree', 'add', '--detach', dir, commit]);
    try {
      const klonoa = cx.datasets.find((d) => d.name === 'klonoa');
      if (klonoa !== undefined && !(await exists(path.join(dir, 'baserom.gba')))) await copyFile(path.resolve(cx.benchRoot, klonoa.rom), path.join(dir, 'baserom.gba'));
      const setup = await cx.exec('./setup.sh', [], { cwd: dir });
      if (setup.code !== 0) throw new Error(`./setup.sh at ${commit} exited ${setup.code}:\n${tail(setup)}`);
      const make = await cx.exec('make', [], { cwd: dir });
      if (make.code !== 0 || !OK_LINE.test(make.stdout + make.stderr)) throw new Error(`make at ${commit} exited ${make.code} without klonoa-eod.gba: OK:\n${tail(make)}`);
    } finally {
      await cx.exec('git', ['-C', repo, 'worktree', 'remove', '--force', dir]);
      await cx.exec('git', ['-C', repo, 'worktree', 'prune']);
    }
    cx.note(`switch ${commit}: no legacy tools, ${entries.size} entries from import-legacy keep mode (${fromLegacy} from legacy), make prints klonoa-eod.gba: OK`);
  },
});
