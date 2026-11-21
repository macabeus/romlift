// g1.architecture (architecture §13, D5, D117): the import edges of §2 (type-only imports included), the
// globals allowlist, Map/Set iteration, rule-file isolation and barrel shape hold, checked by ESLint
// (eslint.config.js) in test/architecture.test.ts, and `tsc --noEmit` passes over src/, test/, bench/ and lint/.
//
// Both are test/architecture.test.ts's two tests: "the repository typechecks" builds the program of tsconfig.json
// and requires no diagnostic (what `tsc --noEmit -p tsconfig.json` reports), and the ESLint one. The gate runs that
// file once and requires each of the two tests by name to pass, so neither can leave the file unnoticed; it no
// longer runs `tsc --noEmit` a second time beside it.
import { type ExecResult, gate } from './gate.ts';

/** The tests of test/architecture.test.ts this gate's verdict rests on, by name. */
const REQUIRED: readonly string[] = [
  'the repository typechecks',
  'the repository follows every architecture rule (eslint.config.js)',
];

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
    const passed = new Set([...checker.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map((m) => (m[1] ?? '').trim()));
    const missing = REQUIRED.filter((name) => !passed.has(name));
    if (missing.length > 0)
      throw new Error(
        `test/architecture.test.ts passed without ${missing.map((n) => `"${n}"`).join(' and ')}:\n${tail(checker)}`,
      );
    cx.note(`ESLint and tsc: ${tapTotals(checker.stdout)}; tsc --noEmit: 0 errors`);
  },
});
