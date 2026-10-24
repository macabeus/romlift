// Source mutants for the phase-4 mutation tests of the lock and the journal (g4.checks-fail, architecture §6.4,
// §10). A checker here is a module of the shell or the write plan itself, so a fault is injected into its source: a
// mutant is a copy of one or more source files with one exact text replaced, written to a temporary directory with
// its relative imports turned into absolute file URLs. The test file is then run again in a child process whose
// module resolution maps each original file to its mutant (`module.registerHooks`, loaded with `--import`), and the
// child must fail exactly the tests the mutant names. Inside that child `underMutation()` is true, so the tests that
// drive the mutants skip themselves. A replacement whose text does not occur exactly once is an error of the test,
// so a refactor of the checker makes the mutant fail loudly instead of passing unmutated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** The environment variable that names the mutant a child runs under. */
const MUTANT_ENV = 'ROMLIFT_MUTANT';
const MAP_ENV = 'ROMLIFT_MUTANT_MAP';

/** One exact replacement in one source file (repository-relative path). */
export interface Mutation {
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

export interface Mutant {
  readonly name: string;
  readonly mutations: readonly Mutation[];
  /** The tests of the file that must fail under the mutant (at least these; others may fail too). */
  readonly caughtBy: readonly string[];
}

export interface MutantRun {
  readonly code: number | null;
  /** The names of the top-level tests that failed. */
  readonly failed: readonly string[];
  readonly output: string;
}

/** Whether this process runs a test file under a mutant (the tests that drive mutants skip themselves). */
export function underMutation(): boolean {
  return process.env[MUTANT_ENV] !== undefined;
}

/** `text` with every relative import specifier made an absolute file URL against `file`. */
function absoluteImports(text: string, file: string): string {
  const base = pathToFileURL(file);
  return text.replace(/(\bfrom\s+|\bimport\s+)'(\.\.?\/[^']+)'/g, (_, lead: string, spec: string) => `${lead}'${new URL(spec, base).href}'`);
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

const HOOKS = `import { registerHooks } from 'node:module';
const map = JSON.parse(process.env.${MAP_ENV} ?? '{}');
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    const to = map[resolved.url];
    return to === undefined ? resolved : { ...resolved, url: to };
  },
});
`;

/** The top-level test names a TAP stream reports as failed. */
export function failedTests(tap: string): string[] {
  const out: string[] = [];
  for (const line of tap.split('\n')) {
    const match = /^not ok \d+ - (.*)$/.exec(line);
    if (match?.[1] !== undefined) out.push(match[1].replace(/ # .*$/, ''));
  }
  return out;
}

/** Runs the test file `testFile` (repository-relative) in a child process under `mutant`. */
export async function runUnderMutant(testFile: string, mutant: Mutant): Promise<MutantRun> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-mutant-'));
  try {
    const map: Record<string, string> = {};
    await writeFile(join(dir, 'package.json'), '{ "type": "module" }\n');
    const files = [...new Set(mutant.mutations.map((m) => m.file))];
    for (const [i, file] of files.entries()) {
      const original = join(REPO, file);
      let text = await readFile(original, 'utf8');
      for (const m of mutant.mutations.filter((x) => x.file === file)) {
        assert.equal(occurrences(text, m.from), 1, `${mutant.name}: ${JSON.stringify(m.from)} must occur exactly once in ${file}`);
        text = text.replace(m.from, () => m.to);
      }
      const copy = join(dir, `${i}-${basename(file)}`);
      await writeFile(copy, absoluteImports(text, original));
      map[pathToFileURL(original).href] = pathToFileURL(copy).href;
    }
    const hooks = join(dir, 'hooks.mjs');
    await writeFile(hooks, HOOKS);
    const args = ['--conditions=source', '--import', pathToFileURL(hooks).href, '--test-reporter=tap', testFile];
    // NODE_TEST_CONTEXT, set by a parent `node --test`, would make the child report to it in its binary protocol.
    const env: NodeJS.ProcessEnv = { ...process.env, [MUTANT_ENV]: mutant.name, [MAP_ENV]: JSON.stringify(map) };
    delete env['NODE_TEST_CONTEXT'];
    const child = spawn(process.execPath, args, {
      cwd: REPO,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (output += d.toString('utf8')));
    const code = await new Promise<number | null>((resolve) => child.on('close', (c) => resolve(c)));
    return { code, failed: failedTests(output), output };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Asserts that `mutant` is caught: the child exits non-zero and every test it names fails. */
export async function assertCaught(testFile: string, mutant: Mutant): Promise<readonly string[]> {
  const run = await runUnderMutant(testFile, mutant);
  const tail = run.output.split('\n').slice(-60).join('\n');
  assert.notEqual(run.code, 0, `${mutant.name}: the tests pass under the mutant, so it is not caught\n${tail}`);
  for (const name of mutant.caughtBy) assert.ok(run.failed.includes(name), `${mutant.name}: '${name}' does not fail under the mutant (failed: ${JSON.stringify(run.failed)})\n${tail}`);
  return run.failed;
}
