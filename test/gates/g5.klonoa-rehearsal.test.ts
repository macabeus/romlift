// g5.klonoa-rehearsal (architecture §6.8, §13, D52): `bash bench/migration/klonoa.sh` checks the Klonoa
// commit pinned as `base` out with `git worktree add` into a temporary directory (never a copy of the often
// dirty checkout), removes the four legacy tools (scripts/generate_asm.py, scripts/generate_expected.py,
// scripts/generate_ldscript.py and the tools/luvdis submodule), runs `romlift import-legacy`, `romlift
// generate` and `make`, and prints `klonoa-eod.gba: OK`. The gate runs the script, requires exit 0 and that
// line, checks that the script names the worktree checkout and each legacy tool, and that it leaves no
// worktree registered in the Klonoa checkout.
//
// Expected interface, for the phase-5 lead to align (architecture §6.8):
//   bash bench/migration/klonoa.sh   run from the repository root with ROMLIFT_BENCH_ROOT set; reads
//   bench/migration/klonoa.json for `base`; exit 0 when make prints `klonoa-eod.gba: OK`.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult } from './gate.ts';

interface Pins {
  readonly base: string;
}

const SCRIPT = 'bench/migration/klonoa.sh';
const BASE = '693ccb7';
const KLONOA_DIR = 'klonoa-empire-of-dreams';
const LEGACY_TOOLS: readonly string[] = ['generate_asm.py', 'generate_expected.py', 'generate_ldscript.py', 'luvdis'];
const OK_LINE = /^klonoa-eod\.gba: OK$/m;

function tail(run: ExecResult, lines = 40): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g5.klonoa-rehearsal',
  phase: 5,
  tier: 'real',
  inputs: ['klonoa', 'roms', 'toolchain'],
  needs: ['importLegacy', 'generate'],
  async run(cx) {
    const pins = JSON.parse(await readFile(path.join(cx.repoRoot, 'bench', 'migration', 'klonoa.json'), 'utf8')) as Pins;
    if (!pins.base.startsWith(BASE)) throw new Error(`bench/migration/klonoa.json pins base ${pins.base}, the architecture's is ${BASE}`);
    const script = await readFile(path.join(cx.repoRoot, SCRIPT), 'utf8');
    const unnamed = LEGACY_TOOLS.filter((tool) => !script.includes(tool));
    if (!script.includes('worktree add')) throw new Error(`${SCRIPT} does not check base out with git worktree add`);
    if (unnamed.length > 0) throw new Error(`${SCRIPT} does not remove ${unnamed.join(', ')}`);

    const klonoa = path.join(cx.benchRoot, KLONOA_DIR);
    const worktrees = async (): Promise<number> => (await cx.exec('git', ['-C', klonoa, 'worktree', 'list', '--porcelain'])).stdout.split('\n').filter((l) => l.startsWith('worktree ')).length;
    const before = await worktrees();
    const run = await cx.exec('bash', [SCRIPT], { cwd: cx.repoRoot, env: { ROMLIFT_BENCH_ROOT: cx.benchRoot, ROMLIFT_POC: cx.pocRoot } });
    const after = await worktrees();
    if (run.code !== 0) throw new Error(`bash ${SCRIPT} exited ${run.code}:\n${tail(run)}`);
    if (!OK_LINE.test(run.stdout + run.stderr)) throw new Error(`bash ${SCRIPT} did not print klonoa-eod.gba: OK:\n${tail(run)}`);
    if (after !== before) throw new Error(`${SCRIPT} left ${after - before} worktrees registered in ${klonoa}`);
    cx.digest('klonoa-base', pins.base);
    cx.note(`the rehearsal at ${pins.base} builds klonoa-eod.gba: OK without the four legacy tools`);
  },
});
