// g1.checks-fail (architecture §10, §13): the mutation tests of the four phase-1 checkers exist and pass,
// each showing its checker fails on an injected fault: an illegal import (architecture), a flipped corpus
// byte (corpus comparator), a bad dataset row (dataset check) and a stale digest (provenance).
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult } from './gate.ts';

const DIR = 'test/mutation/phase1';
const FILES: readonly string[] = ['architecture', 'corpus', 'dataset', 'provenance'].map((name) => `${DIR}/${name}.test.ts`);

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
  id: 'g1.checks-fail',
  phase: 1,
  tier: 'ci',
  needs: [],
  async run(cx) {
    const absent: string[] = [];
    for (const file of FILES) if (!(await isFile(path.join(cx.repoRoot, file)))) absent.push(file);
    if (absent.length > 0) throw new Error(`missing mutation tests: ${absent.join(', ')}`);
    // `node --test` takes files or globs, not a directory, so the directory is given as a glob.
    const run = await cx.exec(process.execPath, ['--conditions=source', '--test', '--test-reporter=tap', `${DIR}/**/*.test.ts`], {
      cwd: cx.repoRoot,
    });
    if (run.code !== 0) throw new Error(`node --test ${DIR}/ exited ${run.code}:\n${tail(run)}`);
    const passed = /^# pass (\d+)$/m.exec(run.stdout)?.[1] ?? '?';
    cx.note(`${FILES.length} phase-1 mutation test files, ${passed} tests pass`);
  },
});
