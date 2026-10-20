// g3.checks-fail (architecture §10, §13): the mutation tests of the four self-checks and of `planWrites`
// exist and pass, each showing its checker fails with its exact code: a tiling overlap
// (E_SELF_CHECK_TILING), a mnemonic that does not re-encode (E_SELF_CHECK_REENCODE), a module whose items
// miss its span (E_MODULE_SIZE), a flipped byte in a FileEntry (E_SELF_CHECK_TEXT), and the write plan's
// refusals (E_PATH_NOT_OWNED, E_STALE_EDIT).
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult } from './gate.ts';

const DIR = 'test/mutation/phase3';
const FILES: readonly string[] = ['tiling', 'reencode', 'module-size', 'text-layout', 'plan-writes'].map((name) => `${DIR}/${name}.test.ts`);

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
  id: 'g3.checks-fail',
  phase: 3,
  tier: 'ci',
  needs: ['verifyModel', 'checkEntries', 'planWrites'],
  async run(cx) {
    const absent: string[] = [];
    for (const file of FILES) if (!(await isFile(path.join(cx.repoRoot, file)))) absent.push(file);
    if (absent.length > 0) throw new Error(`missing mutation tests: ${absent.join(', ')}`);
    const run = await cx.exec(process.execPath, ['--conditions=source', '--test', '--test-reporter=tap', `${DIR}/**/*.test.ts`], {
      cwd: cx.repoRoot,
    });
    if (run.code !== 0) throw new Error(`node --test ${DIR}/ exited ${run.code}:\n${tail(run)}`);
    const passed = /^# pass (\d+)$/m.exec(run.stdout)?.[1] ?? '?';
    cx.note(`${FILES.length} phase-3 mutation test files, ${passed} tests pass`);
  },
});
