// g4.cli-contract (architecture §2.1, §9.1, §13, R8, D33): every command in the registry runs with stdin
// closed, prints NDJSON with --json, and exits with a code of §2.1. The registry is read from the CLI itself
// (`romlift` with no arguments prints every implemented command); it must hold at least the phase-4
// commands. For each command:
//   - `<command> --help` exits 0 and prints `Usage: romlift <command>` and its options, which include --json;
//   - `<command> --romlift-gate-no-such-option` exits 2 (usage);
//   - a contract run with --json, stdin closed and a time limit (a prompt would hang): every stdout line
//     parses as JSON, the last is {"type":"summary","ok":boolean,"exitCode":number} with exitCode equal to
//     the process's and ok true exactly when it is 0, and the exit code is one the recipe below allows and
//     never 70 (internal).
// A command with no recipe here fails the gate, so a new command cannot skip the contract. Recipes of a command that
// is not registered yet stay unused, and a recipe that needs an option (`option`) runs once the command's help lists
// it: phase 6's commands (`signatures`, `rename`) and `init --no-signatures` land in later waves (D93).
//
// Interfaces, frozen by D74 and D93 (architecture §2.1, D33):
//   exit codes 0 ok, 1 errors, 2 usage, 3 verifyFailed, 70 internal; NDJSON as in g4.e2e-fixtures.
//   init's options are [dir], --name, --module-size and --json in phase 4, and --no-signatures from phase 6 (D74, D93);
//   init in a directory holding another file than the given ROM, .git and dot-files is E_DIR_NOT_EMPTY, exit 1.
//   `signatures build <spec>` exits 1 when the spec does not exist; `signatures <rom>` exits 0 (no signature file
//   built: W_SIGNATURES_ABSENT, a warning); `rename <old> <new>` exits 1 when <old> is unknown, 0 for a listed
//   default name (phase 6, D92, D93).
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface CliLine {
  readonly type?: unknown;
  readonly ok?: unknown;
  readonly exitCode?: unknown;
}

type Place = 'project' | 'bare' | 'empty';

interface Recipe {
  readonly label: string;
  readonly args: (project: Project) => readonly string[];
  readonly place: Place;
  readonly exits: readonly number[];
  /** The option this run needs; it runs once the command's help lists it (a later phase's option). */
  readonly option?: string;
}

interface Project {
  readonly dir: string;
  readonly defaultName: string;
}

const EXIT_CODES: ReadonlySet<number> = new Set([0, 1, 2, 3, 70]);
const PHASE_4_COMMANDS: readonly string[] = ['analyze', 'doctor', 'explain', 'generate', 'init', 'model', 'scaffold', 'verify'];
const ROM = 'baserom.gba';
const TIME_LIMIT_MS = 300_000;

/** How each command is run for the contract; a command may have several runs. */
const RECIPES: Readonly<Record<string, readonly Recipe[]>> = {
  doctor: [{ label: 'doctor', args: () => [], place: 'project', exits: [0] }],
  analyze: [
    { label: 'analyze <rom>', args: () => [ROM], place: 'bare', exits: [0] },
    { label: 'analyze --update', args: () => ['--update'], place: 'project', exits: [0] },
  ],
  explain: [
    { label: 'explain <addr> --rom <rom>', args: () => ['0x080000C0', '--rom', ROM], place: 'bare', exits: [0] },
    { label: 'explain <addr> in a project', args: () => ['0x080000C0'], place: 'project', exits: [0] },
  ],
  model: [{ label: 'model', args: () => [], place: 'project', exits: [0] }],
  verify: [{ label: 'verify', args: () => [], place: 'project', exits: [0] }],
  init: [
    { label: 'init <rom>', args: () => [ROM], place: 'bare', exits: [0] },
    { label: 'init <rom> in a non-empty directory', args: () => [ROM], place: 'empty', exits: [1] },
    { label: 'init <rom> --no-signatures', args: () => [ROM, '--no-signatures'], place: 'bare', exits: [0], option: 'no-signatures' },
  ],
  generate: [
    { label: 'generate', args: () => [], place: 'project', exits: [0] },
    { label: 'generate --dry-run', args: () => ['--dry-run'], place: 'project', exits: [0] },
  ],
  scaffold: [{ label: 'scaffold --diff', args: () => ['--diff'], place: 'project', exits: [0] }],
  rename: [
    { label: 'rename <unknown> X', args: () => ['RomliftGateUnknownName', 'X'], place: 'project', exits: [1] },
    { label: 'rename <default name> GateCli', args: (p) => [p.defaultName, 'GateCli'], place: 'project', exits: [0] },
  ],
  signatures: [
    { label: 'signatures build <missing spec>', args: () => ['build', 'romlift-gate-no-such-spec.json'], place: 'bare', exits: [1] },
    { label: 'signatures <rom>', args: () => [ROM], place: 'bare', exits: [0] },
  ],
};

function tail(run: ExecResult, lines = 20): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** The command names of the usage text's "Commands:" table. */
function registry(usage: string): readonly string[] {
  const lines = usage.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'Commands:');
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^ {2}(\S+)(?: {2}|$)/.exec(line);
    if (match?.[1] === undefined) break;
    if (match[1] !== '(none)') out.push(match[1]);
  }
  return out;
}

/** The option names a command's help lists. */
function options(help: string): readonly string[] {
  return [...help.matchAll(/^ {2}--([a-z0-9-]+)/gm)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
}

/** Why the NDJSON of one run breaks the contract, or undefined. */
function ndjsonProblem(run: ExecResult): string | undefined {
  const lines = run.stdout.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return 'printed nothing on stdout';
  let last: CliLine | undefined;
  for (let i = 0; i < lines.length; i++) {
    try {
      last = JSON.parse(lines[i] ?? '') as CliLine;
    } catch {
      return `stdout line ${i + 1} is not JSON: ${(lines[i] ?? '').slice(0, 120)}`;
    }
    if (typeof last !== 'object' || last === null || Array.isArray(last)) return `stdout line ${i + 1} is not a JSON object`;
  }
  if (last?.type !== 'summary') return 'the last line is not {"type":"summary",...}';
  if (last.exitCode !== run.code) return `the summary says exitCode ${String(last.exitCode)}, the process exited ${run.code}`;
  if (last.ok !== (run.code === 0)) return `the summary says ok ${String(last.ok)} with exit ${run.code}`;
  return undefined;
}

gate({
  id: 'g4.cli-contract',
  phase: 4,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['init', 'generate'],
  async run(cx: GateContext) {
    const fixture = cx.fixtures[0];
    if (fixture === undefined) throw new Error('no committed fixture under bench/dataset/synthetic');
    const main = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
    const base = await cx.tmpDir('romlift-cli-contract-');
    const romlift = (args: readonly string[], cwd: string): Promise<ExecResult> =>
      cx.exec(process.execPath, ['--conditions=source', main, ...args], { cwd, timeoutMs: TIME_LIMIT_MS });
    let fresh = 0;
    const place = async (where: Place): Promise<string> => {
      const dir = path.join(base, `${where}-${fresh++}`);
      await mkdir(dir, { recursive: true });
      await copyFile(fixture.rom, path.join(dir, ROM));
      if (where === 'empty') await copyFile(fixture.rom, path.join(dir, 'another.gba'));
      return dir;
    };

    const usage = await romlift([], base);
    if (usage.code !== 0) throw new Error(`romlift with no arguments exited ${usage.code}:\n${tail(usage)}`);
    const commands = registry(usage.stdout);
    const absent = PHASE_4_COMMANDS.filter((c) => !commands.includes(c));
    if (absent.length > 0) throw new Error(`the registry lacks the phase-4 commands ${absent.join(', ')}`);

    const projectDir = await place('bare');
    const init = await romlift(['init', ROM, '--json'], projectDir);
    if (init.code !== 0) throw new Error(`init of the contract project exited ${init.code}:\n${tail(init)}`);
    const defaultName = /= "(sub_[0-9A-F]{8})"/.exec(await readFile(path.join(projectDir, 'romlift.toml'), 'utf8'))?.[1];
    if (defaultName === undefined) throw new Error('the contract project lists no default-named function');
    const project: Project = { dir: projectDir, defaultName };

    const problems: string[] = [];
    let runs = 0;
    for (const command of commands) {
      const help = await romlift([command, '--help'], base);
      const listed = options(help.stdout);
      if (help.code !== 0 || !help.stdout.startsWith(`Usage: romlift ${command}`)) problems.push(`${command} --help exited ${help.code} or printed no usage`);
      else if (!listed.includes('json')) problems.push(`${command} has no --json option`);
      const bad = await romlift([command, '--romlift-gate-no-such-option'], base);
      if (bad.code !== 2) problems.push(`${command} with an unknown option exited ${bad.code}, not 2`);

      const recipes = RECIPES[command];
      if (recipes === undefined) {
        problems.push(`${command} has no contract recipe in g4.cli-contract; add one`);
        continue;
      }
      for (const recipe of recipes) {
        if (recipe.option !== undefined && !listed.includes(recipe.option)) continue;
        const cwd = recipe.place === 'project' ? project.dir : await place(recipe.place);
        const run = await romlift([command, ...recipe.args(project), '--json'], cwd);
        runs++;
        if (run.code === 124) problems.push(`${recipe.label}: did not finish within ${TIME_LIMIT_MS} ms with stdin closed`);
        else if (!EXIT_CODES.has(run.code) || run.code === 70) problems.push(`${recipe.label}: exit ${run.code}:\n${tail(run, 8)}`);
        else if (!recipe.exits.includes(run.code)) problems.push(`${recipe.label}: exit ${run.code}, expected ${recipe.exits.join(' or ')}:\n${tail(run, 8)}`);
        else {
          const problem = ndjsonProblem(run);
          if (problem !== undefined) problems.push(`${recipe.label} --json: ${problem}`);
        }
      }
    }
    if (problems.length > 0) throw new Error(`CLI contract: ${problems.join(' | ')}`);
    cx.note(`${commands.length} commands (${commands.join(', ')}): help, usage errors and ${runs} --json runs with stdin closed follow §2.1`);
  },
});
