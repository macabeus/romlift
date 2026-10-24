// g6.reconciler (architecture §1 R9, §6.6, §13; g5.reconciler until the owner skipped phase 5 and moved the
// reconciler into phase 6, D92): C in, C out goldens of the reconciler: stubs added, removed and moved, with comments
// and strings untouched. The goldens live under test/golden/reconcile/<case>/ as
// input.c (the C in) and expected.c (the C out); at least one case name starts with each of `add`, `remove`
// and `move`. The gate requires that the golden tests pass with UPDATE_GOLDEN unset, and checks every case
// itself with the reconciler's tokenizer: the comment, string and character-literal tokens of expected.c are
// exactly those of input.c, in the same order, so a reconciler edit never reaches into them.
//
// Calls, aligned by the phase-6 lead (architecture §6.6, D93; both exported since phase 4, D74):
//   tokenizeC(text) -> readonly {kind: 'comment'|'string'|'char'|'preprocessor'|'identifier'|'punct'|…,
//     text: string, start: number, end: number}[]
//   planIncludeAsm: the stub planner whose add, remove and move edits the goldens hold (p6-rename owns the
//   golden cases with the reconciler's rename tokens, D93)
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult } from './gate.ts';

interface CToken {
  readonly kind: string;
  readonly text: string;
}

type TokenizeC = (text: string) => readonly CToken[];

const ROOT = 'test/golden/reconcile';
const KINDS: readonly string[] = ['add', 'remove', 'move'];
const UNTOUCHABLE: ReadonlySet<string> = new Set(['comment', 'string', 'char']);

function tail(run: ExecResult, lines = 40): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function untouchable(tokens: readonly CToken[]): readonly string[] {
  return tokens.filter((t) => UNTOUCHABLE.has(t.kind)).map((t) => `${t.kind}:${t.text}`);
}

gate({
  id: 'g6.reconciler',
  phase: 6,
  tier: 'ci',
  needs: ['tokenizeC', 'planIncludeAsm'],
  async run(cx) {
    const tokenizeC = cx.need<TokenizeC>('tokenizeC');
    const root = path.join(cx.repoRoot, ROOT);
    const cases = (await readdir(root, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const missingKinds = KINDS.filter((kind) => !cases.some((name) => name.startsWith(kind)));
    if (missingKinds.length > 0) throw new Error(`${ROOT} has no case for ${missingKinds.join(', ')} (cases: ${cases.join(', ') || 'none'})`);

    const problems: string[] = [];
    let protectedTokens = 0;
    for (const name of cases) {
      const input = await readFile(path.join(root, name, 'input.c'), 'utf8').catch(() => undefined);
      const expected = await readFile(path.join(root, name, 'expected.c'), 'utf8').catch(() => undefined);
      if (input === undefined || expected === undefined) {
        problems.push(`${name}: needs input.c and expected.c`);
        continue;
      }
      if (input === expected && !name.startsWith('keep')) problems.push(`${name}: expected.c equals input.c, the case edits nothing`);
      const before = untouchable(tokenizeC(input));
      const after = untouchable(tokenizeC(expected));
      protectedTokens += before.length;
      if (JSON.stringify(before) !== JSON.stringify(after)) problems.push(`${name}: comments or strings differ between input.c (${before.length}) and expected.c (${after.length})`);
    }
    if (protectedTokens === 0) problems.push('no case holds a comment or a string, so none shows they stay untouched');

    const run = await cx.exec(process.execPath, ['--conditions=source', '--test', '--test-reporter=tap', `${ROOT}/**/*.test.ts`], { cwd: cx.repoRoot, env: { UPDATE_GOLDEN: '' } });
    if (run.code !== 0) problems.push(`the reconciler goldens fail (node --test ${ROOT} exited ${run.code}):\n${tail(run)}`);
    if (problems.length > 0) throw new Error(`reconciler: ${problems.join(' | ')}`);
    const passed = /^# pass (\d+)$/m.exec(run.stdout)?.[1] ?? '?';
    cx.note(`${cases.length} C-in, C-out cases (${passed} golden tests) add, remove and move stubs; ${protectedTokens} comment and string tokens untouched`);
  },
});
