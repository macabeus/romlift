// g5.import-legacy (architecture §6.6, §6.8, §13, D51): at the Klonoa commit pinned as `base` in
// bench/migration/klonoa.json (693ccb7), `romlift import-legacy` in keep mode reports 282 legacy entries
// inside found functions (W_LEGACY_ENTRY_INSIDE), 1 legacy entry failing validation (W_LISTED_INVALID), and
// unlisted discoveries (W_UNLISTED_FUNCTION) of which 183 are FUNC symbols of kleod's ELF, the klonoa
// dataset's. The counts must also equal those committed in bench/migration/klonoa-import.json. The Klonoa
// checkout is never copied: `base` is checked out with `git worktree add --detach` into a temporary
// directory, which is removed again.
//
// Expected interfaces, for the phase-5 lead to align (architecture §2.1, §6.6):
//   bench/migration/klonoa.json          {"base": "693ccb7…", "switch": "<commit>" | ""}
//   bench/migration/klonoa-import.json   {"base": string, "inside": 282, "invalid": 1, "unlisted": number,
//                                         "unlistedElf": 183}
//   romlift import-legacy --rom baserom.gba --cfg functions_merged.cfg --toml klonoa-eod-decomp.toml
//     --ldscript ldscript.in.txt --aliases asm/thumb_aliases.s --json     run in the checkout; exit 0;
//   NDJSON {"type":"diagnostic","code":string,"addr"?:number|"0x…",…} lines, then the summary.
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface Pins {
  readonly base: string;
  readonly switch?: string;
}

interface ImportCounts {
  readonly base: string;
  readonly inside: number;
  readonly invalid: number;
  readonly unlisted: number;
  readonly unlistedElf: number;
}

interface CliLine {
  readonly type: string;
  readonly code?: string;
  readonly addr?: number | string;
  readonly exitCode?: number;
}

type ParseElf = (bytes: Uint8Array) => { readonly ok: true; readonly value: object } | { readonly ok: false; readonly error: string };
type ElfFunctions = (elf: object, within: { readonly start: number; readonly end: number }) => readonly { readonly addr: number }[];

const BASE = '693ccb7';
const EXPECTED = { inside: 282, invalid: 1, unlistedElf: 183 } as const;
const KLONOA_DIR = 'klonoa-empire-of-dreams';
const LEGACY_ARGS: readonly string[] = ['--cfg', 'functions_merged.cfg', '--toml', 'klonoa-eod-decomp.toml', '--ldscript', 'ldscript.in.txt', '--aliases', 'asm/thumb_aliases.s'];
const ROM_SPAN = { start: 0x0800_0000, end: 0x0a00_0000 } as const;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function address(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^0x[0-9A-Fa-f]+$/.test(value)) return Number.parseInt(value, 16);
  return undefined;
}

async function readJson<T>(cx: GateContext, file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(cx.repoRoot, file), 'utf8')) as T;
}

/** Runs `fn` in a detached worktree of `repo` at `commit`, removed afterwards. */
async function atCommit<T>(cx: GateContext, repo: string, commit: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(await cx.tmpDir('romlift-klonoa-'), 'checkout');
  const add = await cx.exec('git', ['-C', repo, 'worktree', 'add', '--detach', dir, commit]);
  if (add.code !== 0) throw new Error(`git worktree add ${commit} exited ${add.code}:\n${tail(add)}`);
  try {
    return await fn(dir);
  } finally {
    await cx.exec('git', ['-C', repo, 'worktree', 'remove', '--force', dir]);
    await cx.exec('git', ['-C', repo, 'worktree', 'prune']);
  }
}

gate({
  id: 'g5.import-legacy',
  phase: 5,
  tier: 'real',
  inputs: ['klonoa', 'roms', 'elfs'],
  needs: ['importLegacy', 'parseElf', 'elfFunctions'],
  async run(cx) {
    const pins = await readJson<Pins>(cx, 'bench/migration/klonoa.json');
    if (!pins.base.startsWith(BASE)) throw new Error(`bench/migration/klonoa.json pins base ${pins.base}, the architecture's is ${BASE}`);
    const committed = await readJson<ImportCounts>(cx, 'bench/migration/klonoa-import.json');
    const klonoa = cx.datasets.find((d) => d.name === 'klonoa');
    if (klonoa === undefined) throw new Error('no klonoa dataset');
    const parsed = cx.need<ParseElf>('parseElf')(new Uint8Array(await readFile(path.resolve(cx.benchRoot, klonoa.elf))));
    if (!parsed.ok) throw new Error(`kleod's ELF does not parse: ${parsed.error}`);
    const elfEntries = new Set(cx.need<ElfFunctions>('elfFunctions')(parsed.value, ROM_SPAN).map((f) => f.addr));

    const main = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
    const counts = await atCommit(cx, path.join(cx.benchRoot, KLONOA_DIR), pins.base, async (dir) => {
      await copyFile(path.resolve(cx.benchRoot, klonoa.rom), path.join(dir, 'baserom.gba'));
      const run = await cx.exec(process.execPath, ['--conditions=source', main, 'import-legacy', '--rom', 'baserom.gba', ...LEGACY_ARGS, '--json'], { cwd: dir });
      if (run.code !== 0) throw new Error(`import-legacy at ${pins.base} exited ${run.code}:\n${tail(run)}`);
      const lines = cx.jsonLines<CliLine>(run.stdout).filter((l) => l.type === 'diagnostic');
      const of = (code: string): readonly CliLine[] => lines.filter((l) => l.code === code);
      const unlisted = of('W_UNLISTED_FUNCTION').map((l) => address(l.addr));
      if (unlisted.some((a) => a === undefined)) throw new Error('a W_UNLISTED_FUNCTION diagnostic carries no address');
      return {
        inside: of('W_LEGACY_ENTRY_INSIDE').length,
        invalid: of('W_LISTED_INVALID').length,
        unlisted: unlisted.length,
        unlistedElf: unlisted.filter((a) => a !== undefined && elfEntries.has(a)).length,
      };
    });
    const measured = `inside ${counts.inside}, invalid ${counts.invalid}, unlisted ${counts.unlisted} of which ${counts.unlistedElf} ELF functions`;
    cx.digest('klonoa-base', pins.base);
    const problems: string[] = [];
    if (counts.inside !== EXPECTED.inside) problems.push(`${counts.inside} legacy entries inside found functions, expected ${EXPECTED.inside}`);
    if (counts.invalid !== EXPECTED.invalid) problems.push(`${counts.invalid} legacy entries failing validation, expected ${EXPECTED.invalid}`);
    if (counts.unlistedElf !== EXPECTED.unlistedElf) problems.push(`${counts.unlistedElf} unlisted discoveries are ELF functions, expected ${EXPECTED.unlistedElf}`);
    for (const key of ['inside', 'invalid', 'unlisted', 'unlistedElf'] as const) {
      if (committed[key] !== counts[key]) problems.push(`klonoa-import.json records ${key} ${committed[key]}, the run gives ${counts[key]}`);
    }
    if (problems.length > 0) throw new Error(`import-legacy at ${pins.base} (${measured}): ${problems.join('; ')}`);
    cx.note(`import-legacy at ${pins.base}: ${measured}`);
  },
});
