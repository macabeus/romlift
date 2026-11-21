// g2.checks-fail (architecture §10, §13): the mutation tests of the phase-2 checkers exist and pass, each
// showing its checker fails on an injected fault: the held-out classifier (a suppressed split must be
// `glued`), the seal (a held-out row in results.json, `bench adopt` on a sealed dataset), the
// stale-exception check (a row the run no longer needs) and the regression reporter. The lockstep reporter
// was deleted with the lockstep oracle (D59).
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { type ExecResult, gate } from './gate.ts';

const DIR = 'test/mutation/phase2';
const FILES: readonly string[] = ['classify', 'seal', 'stale-exception', 'regression'].map(
  (name) => `${DIR}/${name}.test.ts`,
);

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
  id: 'g2.checks-fail',
  phase: 2,
  tier: 'ci',
  needs: ['analyze'],
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
    cx.note(`${FILES.length} phase-2 mutation test files, ${passed} tests pass`);
  },
});
