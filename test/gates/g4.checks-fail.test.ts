// g4.checks-fail (architecture §6.4, §6.5, §10, §13): the mutation tests of the phase-4 checkers exist and
// pass, each showing its checker fails with its exact code and exit code: the project lock (a second run
// is E_PROJECT_LOCKED, a lock whose pid is gone on the same host is taken over with W_STALE_LOCK), the
// journal (a failure injected after the k-th op, for every k, converges on the next run to the same tree
// and manifest; an edit whose file changed is E_STALE_EDIT), and the patch planner (a hand-restructured
// table is E_TOML_PATCH_REFUSED and the file is left as it was). Owners (D74): lock and journal p4-safety-minors,
// patch-planner p4-config.
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { type ExecResult, gate } from './gate.ts';

const DIR = 'test/mutation/phase4';
const FILES: readonly string[] = ['lock', 'journal', 'patch-planner'].map((name) => `${DIR}/${name}.test.ts`);

function tail(run: ExecResult, lines = 40): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

gate({
  id: 'g4.checks-fail',
  phase: 4,
  tier: 'ci',
  needs: ['init', 'generate', 'planPatch'],
  async run(cx) {
    const absent: string[] = [];
    for (const file of FILES) if (!(await isFile(path.join(cx.repoRoot, file)))) absent.push(file);
    if (absent.length > 0) throw new Error(`missing mutation tests: ${absent.join(', ')}`);
    const run = await cx.exec(
      process.execPath,
      ['--conditions=source', '--test', '--test-reporter=tap', `${DIR}/**/*.test.ts`],
      {
        cwd: cx.repoRoot,
      },
    );
    if (run.code !== 0) throw new Error(`node --test ${DIR}/ exited ${run.code}:\n${tail(run)}`);
    const passed = /^# pass (\d+)$/m.exec(run.stdout)?.[1] ?? '?';
    cx.note(`${FILES.length} phase-4 mutation test files, ${passed} tests pass`);
  },
});
