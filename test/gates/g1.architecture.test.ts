// g1.architecture (architecture §13, D5, D117): the import edges of §2 (type-only imports included), the
// globals allowlist, Map/Set iteration, rule-file isolation and barrel shape hold, checked by ESLint
// (eslint.config.js) in test/architecture.test.ts, and `tsc --noEmit` passes over src/, test/, bench/ and lint/.
import { gate, type ExecResult } from './gate.ts';

function tail(run: ExecResult, lines = 40): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** The `# pass N` and `# fail N` totals of a TAP run. */
function tapTotals(stdout: string): string {
  const total = (key: string): string => new RegExp(`^# ${key} (\\d+)$`, 'm').exec(stdout)?.[1] ?? '?';
  return `pass ${total('pass')}, fail ${total('fail')}`;
}

gate({
  id: 'g1.architecture',
  phase: 1,
  tier: 'ci',
  needs: [],
  async run(cx) {
    const checker = await cx.exec(
      process.execPath,
      ['--conditions=source', '--test', '--test-reporter=tap', 'test/architecture.test.ts'],
      { cwd: cx.repoRoot },
    );
    if (checker.code !== 0) throw new Error(`test/architecture.test.ts exited ${checker.code}:\n${tail(checker)}`);
    cx.note(`ESLint and tsc: ${tapTotals(checker.stdout)}`);

    const tsc = await cx.exec('npx', ['--no', '--', 'tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: cx.repoRoot });
    if (tsc.code !== 0) throw new Error(`tsc --noEmit -p tsconfig.json exited ${tsc.code}:\n${tail(tsc)}`);
    cx.note('tsc --noEmit: 0 errors');
  },
});
