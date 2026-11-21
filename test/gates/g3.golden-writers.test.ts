// g3.golden-writers (architecture §6.3, §10, §13): every phase-3 writer's output on every committed fixture
// equals its golden. The goldens live under test/golden/writers/<writer>/, one entry per fixture whose name
// starts with the fixture's name; the golden tests there run with UPDATE_GOLDEN unset, so nothing is
// rewritten and any difference fails.
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { type ExecResult, gate } from './gate.ts';

const WRITERS: readonly string[] = ['header', 'crt0', 'function', 'orphan', 'module', 'data', 'ldscript', 'symbols'];
const ROOT = 'test/golden/writers';

function tail(run: ExecResult, lines = 40): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

async function entries(dir: string): Promise<readonly string[]> {
  try {
    return (await readdir(dir)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return [];
  }
}

async function testFiles(dir: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) count += await testFiles(path.join(dir, entry.name));
    else if (entry.name.endsWith('.test.ts')) count++;
  }
  return count;
}

gate({
  id: 'g3.golden-writers',
  phase: 3,
  tier: 'ci',
  needs: ['emitTree', 'printChunk', 'resolverFor'],
  async run(cx) {
    if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    const missing: string[] = [];
    for (const writer of WRITERS) {
      const names = await entries(path.join(cx.repoRoot, ROOT, writer));
      if (names.length === 0) {
        missing.push(`${writer}: no goldens`);
        continue;
      }
      for (const fixture of cx.fixtures) {
        if (
          !names.some(
            (name) =>
              name === fixture.name || name.startsWith(`${fixture.name}.`) || name.startsWith(`${fixture.name}/`),
          )
        ) {
          missing.push(`${writer}/${fixture.name}`);
        }
      }
    }
    if (missing.length > 0) throw new Error(`missing writer goldens: ${missing.join(', ')}`);
    const tests = await testFiles(path.join(cx.repoRoot, ROOT));
    if (tests === 0) throw new Error(`no golden test file under ${ROOT}`);
    const run = await cx.exec(
      process.execPath,
      ['--conditions=source', '--test', '--test-reporter=tap', `${ROOT}/**/*.test.ts`],
      {
        cwd: cx.repoRoot,
        env: { UPDATE_GOLDEN: '' },
      },
    );
    if (run.code !== 0)
      throw new Error(`the writer goldens differ (node --test ${ROOT} exited ${run.code}):\n${tail(run)}`);
    const passed = /^# pass (\d+)$/m.exec(run.stdout)?.[1] ?? '?';
    cx.note(
      `${WRITERS.length} writers x ${cx.fixtures.length} fixtures equal their goldens (${tests} test files, ${passed} tests)`,
    );
  },
});
