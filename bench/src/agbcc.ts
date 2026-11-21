// The agbcc of a romlift checkout (D120): the tools/agbcc submodule, macabeus/agbcc at the commit templates/agbcc.json
// pins, built in place by its own build.sh and installed by its install.sh into tools/agbcc/{bin,include,lib}, as every
// project setup.sh scaffolds builds it. The fixtures (bench/tools/fixtures.ts), `bench run --scaffold`'s init builds
// and `npm run agbcc` all take it from here; the test/local tests read tools/agbcc directly.
//
// A build is stamped with the pin it was made from (AGBCC_PIN_STAMP beside its bin/), so a checkout moved to another
// commit builds again. The submodule's own commit must be the pin's: a test (test/unit/bench/agbcc.test.ts) keeps the
// gitlink and templates/agbcc.json equal in the repository, and checkoutAgbcc refuses a work tree checked out elsewhere.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgbccPin } from 'romlift';
import { readAgbccPin } from 'romlift/node';

import type { BenchContext } from './context.ts';
import { BenchError, exists } from './files.ts';
import type { ProcessOptions, ProcessResult } from './process.ts';

/** The submodule, relative to the repository root, where .gitmodules registers it. */
export const AGBCC_SUBMODULE = join('tools', 'agbcc');
/** The pin stamp: the pin a build of tools/agbcc was made from, beside its bin/. */
export const AGBCC_PIN_STAMP = 'romlift-agbcc-pin.json';
/** What agbcc's install.sh installs into tools/agbcc, and all a build reads of it; the sources beside stay put. */
export const AGBCC_INSTALLED = ['bin', 'include', 'lib'] as const;
/** The compilers a project builds with; agbcc_arm is installed beside them and read by nothing romlift builds. */
export const AGBCC_BINARIES = ['agbcc', 'old_agbcc'] as const;

export type AgbccRunner = (command: string, args: readonly string[], options: ProcessOptions) => Promise<ProcessResult>;

export interface AgbccDeps {
  readonly run: AgbccRunner;
  readonly log: (line: string) => void;
}

/** tools/agbcc of the checkout `cx`. */
export const checkoutAgbccPath = (cx: BenchContext): string => join(cx.repoRoot, AGBCC_SUBMODULE);

/** The text of a build's pin stamp (AGBCC_PIN_STAMP). */
export const pinText = (pin: AgbccPin): string => `${JSON.stringify({ url: pin.url, commit: pin.commit })}\n`;

/**
 * The one pin-stamp check of an agbcc build in `dir`: undefined when it was built at `pin`, else why not (no stamp, or
 * a stamp of another pin). Throws when the stamp exists but cannot be read.
 */
export async function agbccPinProblem(dir: string, pin: AgbccPin): Promise<string | undefined> {
  const stamp = join(dir, AGBCC_PIN_STAMP);
  if (!(await exists(stamp))) return `the agbcc ${dir} records no pin (no ${AGBCC_PIN_STAMP})`;
  const recorded = await readFile(stamp, 'utf8');
  return recorded === pinText(pin)
    ? undefined
    : `the agbcc ${dir} was built at ${recorded.trim()}, not at templates/agbcc.json's ${pinText(pin).trim()}`;
}

/** templates/agbcc.json, read by romlift's own reader (romlift/node readAgbccPin). */
export async function templatePin(cx: BenchContext): Promise<AgbccPin> {
  const pin = await readAgbccPin(cx.repoRoot);
  if (!pin.ok) throw new BenchError(pin.diagnostic.message);
  return pin.value;
}

/** Whether `dir` holds both compilers a project builds with. */
async function hasCompilers(dir: string): Promise<boolean> {
  for (const bin of AGBCC_BINARIES) if (!(await exists(join(dir, 'bin', bin)))) return false;
  return true;
}

const tail = (run: ProcessResult, lines = 20): string =>
  `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');

/**
 * The checkout's agbcc, built when it is not yet built at the pin: tools/agbcc's build.sh, then its install.sh into the
 * repository root (which installs into tools/agbcc itself), then the stamp. Returns tools/agbcc. Throws a BenchError
 * when the submodule is not checked out, is checked out at another commit than the pin's, or a step fails.
 */
export async function checkoutAgbcc(cx: BenchContext, deps: AgbccDeps): Promise<string> {
  const pin = await templatePin(cx);
  const dir = checkoutAgbccPath(cx);
  if (!(await exists(join(dir, 'build.sh'))))
    throw new BenchError(`${dir} is not checked out: run \`git submodule update --init ${AGBCC_SUBMODULE}\``);
  const head = await deps.run('git', ['-C', dir, 'rev-parse', 'HEAD'], {});
  const commit = head.stdout.trim();
  if (head.code !== 0 || commit !== pin.commit)
    throw new BenchError(
      `${dir} is at ${head.code === 0 ? commit : 'no commit'}, but templates/agbcc.json pins ${pin.commit}: run \`git submodule update ${AGBCC_SUBMODULE}\``,
    );
  if ((await hasCompilers(dir)) && (await agbccPinProblem(dir, pin)) === undefined) return dir;
  deps.log(`agbcc: building ${pin.commit} in ${dir} (once per commit; a few minutes)`);
  const step = async (what: string, command: string, args: readonly string[]): Promise<void> => {
    const run = await deps.run(command, args, { cwd: dir });
    if (run.code !== 0) throw new BenchError(`agbcc: ${what} exited ${run.code}:\n${tail(run)}`);
  };
  await step('build.sh', './build.sh', []);
  await step('install.sh', './install.sh', [cx.repoRoot]);
  for (const bin of AGBCC_BINARIES)
    if (!(await exists(join(dir, 'bin', bin))))
      throw new BenchError(`agbcc: install.sh wrote no ${join(AGBCC_SUBMODULE, 'bin', bin)}`);
  await writeFile(join(dir, AGBCC_PIN_STAMP), pinText(pin));
  return dir;
}
