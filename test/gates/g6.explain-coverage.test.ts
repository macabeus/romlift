// g6.explain-coverage (architecture §9.2, §13, D35, D40): every analysis rule id (`RULES`) and every
// signature placement rule id (`SIGNATURE_RULES`, all `sig.*`) appears in at least one explain golden, and
// every golden is built from a committed fixture only. Goldens are the non-test files under
// test/golden/explain/; each names a committed fixture by a path segment or a `<fixture>.` file-name prefix;
// the `sig.*` ids must appear under test/golden/explain/sig/, whose goldens come from the library fixture.
// Every .json golden has the composed ExplainReport shape (addr, claim, events[], rules[]; a sig/ golden
// also signature {library, version, name}); no golden holds the SHA-1 of a real dataset's ROM; and the explain
// golden tests pass with UPDATE_GOLDEN unset. SIGNATURE_RULES holds exactly the five ids of SIGNATURE_RULE_IDS (D93).
//
// Calls, aligned by the phase-6 lead (architecture §4.1, §7.2, §9.2, D93):
//   RULES, SIGNATURE_RULES (romlift/internal): records keyed by rule id (SIGNATURE_RULES is exported empty by the lead
//   and filled by p6-signatures-match); explain (romlift): the ExplainReport whose `signature` part
//   ({library, version, name, rule?}, ExplainSignature) p6-proposals fills; the sig/ goldens are p6-proposals'
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { type ExecResult, byCodeUnit, gate } from './gate.ts';

type Rules = Readonly<Record<string, unknown>>;

interface Golden {
  readonly file: string;
  readonly text: string;
}

const ROOT = 'test/golden/explain';
const SIG_DIR = 'sig/';
const LIBRARY_FIXTURE = 'library';

function tail(run: ExecResult, lines = 40): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}


async function goldens(dir: string, prefix = ''): Promise<readonly Golden[]> {
  const out: Golden[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true }).catch(() => [])) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await goldens(dir, relative)));
    else if (entry.isFile() && !entry.name.endsWith('.ts')) out.push({ file: relative, text: await readFile(path.join(dir, relative), 'utf8') });
  }
  return out.sort((a, b) => byCodeUnit(a.file, b.file));
}

function mentions(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9._-])${escaped}($|[^A-Za-z0-9._-])`).test(text);
}

function fixtureOf(file: string, fixtures: readonly string[]): string | undefined {
  const parts = file.split('/');
  return fixtures.find((name) => parts.slice(0, -1).includes(name) || (parts[parts.length - 1] ?? '').startsWith(`${name}.`));
}

function shapeProblem(golden: Golden): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(golden.text);
  } catch {
    return 'is not JSON';
  }
  const report = value as { readonly addr?: unknown; readonly claim?: unknown; readonly events?: unknown; readonly rules?: unknown; readonly signature?: { readonly library?: unknown; readonly version?: unknown; readonly name?: unknown } };
  if (typeof report.addr !== 'number' || report.claim === undefined || !Array.isArray(report.events) || !Array.isArray(report.rules)) return 'lacks addr, claim, events[] or rules[]';
  if (golden.file.startsWith(SIG_DIR) && (typeof report.signature?.library !== 'string' || typeof report.signature.version !== 'string' || typeof report.signature.name !== 'string')) return 'is under sig/ without signature {library, version, name}';
  return undefined;
}

gate({
  id: 'g6.explain-coverage',
  phase: 6,
  tier: 'ci',
  needs: ['RULES', 'SIGNATURE_RULES', 'SIGNATURE_RULE_IDS', 'explain'],
  async run(cx) {
    const analysisIds = Object.keys(cx.need<Rules>('RULES')).sort(byCodeUnit);
    const sigIds = Object.keys(cx.need<Rules>('SIGNATURE_RULES')).sort(byCodeUnit);
    if (analysisIds.length === 0 || sigIds.length === 0) throw new Error('RULES or SIGNATURE_RULES is empty');
    const problems: string[] = [];
    const notSig = sigIds.filter((id) => !id.startsWith('sig.'));
    if (notSig.length > 0) problems.push(`SIGNATURE_RULES ids outside sig.*: ${notSig.join(', ')}`);
    const frozen = [...cx.need<readonly string[]>('SIGNATURE_RULE_IDS')].sort(byCodeUnit);
    if (JSON.stringify(sigIds) !== JSON.stringify(frozen)) problems.push(`SIGNATURE_RULES holds ${sigIds.join(', ')}, not the frozen SignatureRuleId set ${frozen.join(', ')}`);

    const all = await goldens(path.join(cx.repoRoot, ROOT));
    if (all.length === 0) throw new Error(`no golden under ${ROOT}`);
    const fixtureNames = cx.fixtures.map((f) => f.name);
    const shas = [...cx.datasets, ...cx.sealed].map((d) => d.sha1);
    for (const golden of all) {
      const fixture = fixtureOf(golden.file, fixtureNames);
      if (fixture === undefined) problems.push(`${golden.file} names no committed fixture`);
      else if (golden.file.startsWith(SIG_DIR) && fixture !== LIBRARY_FIXTURE) problems.push(`${golden.file} is a sig golden built from ${fixture}, not the ${LIBRARY_FIXTURE} fixture`);
      if (shas.some((sha) => golden.text.includes(sha))) problems.push(`${golden.file} holds the SHA-1 of a real ROM`);
      if (golden.file.endsWith('.json')) {
        const problem = shapeProblem(golden);
        if (problem !== undefined) problems.push(`${golden.file} ${problem}`);
      }
    }
    const sigGoldens = all.filter((g) => g.file.startsWith(SIG_DIR));
    const uncovered = analysisIds.filter((id) => !all.some((g) => mentions(g.text, id)));
    const sigUncovered = sigIds.filter((id) => !sigGoldens.some((g) => mentions(g.text, id)));
    if (uncovered.length > 0) problems.push(`analysis rules in no explain golden: ${uncovered.join(', ')}`);
    if (sigUncovered.length > 0) problems.push(`sig rules in no ${ROOT}/${SIG_DIR} golden: ${sigUncovered.join(', ')}`);

    const run = await cx.exec(process.execPath, ['--conditions=source', '--test', '--test-reporter=tap', `${ROOT}/**/*.test.ts`], { cwd: cx.repoRoot, env: { UPDATE_GOLDEN: '' } });
    if (run.code !== 0) problems.push(`the explain goldens fail (node --test ${ROOT} exited ${run.code}):\n${tail(run)}`);
    if (problems.length > 0) throw new Error(`explain coverage: ${problems.join(' | ')}`);
    cx.note(`${analysisIds.length} analysis and ${sigIds.length} sig rule ids each appear in one of ${all.length} explain goldens built from fixtures`);
  },
});
