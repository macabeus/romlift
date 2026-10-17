// parityCheck, the one check g2.poc-parity runs before and after it is historical (test/gates/poc-parity-check.ts),
// and the harness step that runs it once the gate is frozen (test/gates/gate.ts gateStep; code-quality-r2-6).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { decideHistorical, gateStep } from '../../gates/gate.ts';
import { LOCKSTEP_SETS, parityCheck, SCOPED_OUT, type ParityEvidence, type PocDigests } from '../../gates/poc-parity-check.ts';

/** The environment without NODE_TEST_CONTEXT, so the child runs its own test runner and exits with its own status. */
function withoutTestContext(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NODE_TEST_CONTEXT: _parent, ...rest } = env;
  return rest;
}

const FIVE = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3'];
const SIX = [...FIVE, 'tmc'];
const D = (name: string): string => `${name}-digest`;

const DIGESTS: PocDigests = { pocSourceDigest: 'poc', roms: Object.fromEntries(FIVE.map((n) => [n, D(n)])) };

function evidence(over: (name: string) => Partial<ParityEvidence['roms'][string]> = () => ({})): ParityEvidence {
  return {
    schema: 'romlift-bench/parity-evidence@1',
    commit: 'e867dae',
    dirty: false,
    worklist: 'poc-lifo',
    pocSourceDigest: 'poc',
    roms: Object.fromEntries(
      FIVE.map((n) => [
        n,
        {
          digest: D(n),
          expected: D(n),
          rowDiffs: 0,
          lockstep: LOCKSTEP_SETS.map((set) => ({ set, queries: 10, matched: 7, skipped: 3, parityDigest: D(n), divergence: null })),
          ...over(n),
        },
      ]),
    ),
  };
}

test('parityCheck: the M1 evidence of the five passes, tmc is scoped out by the owner (Q1, D61 c) and printed as not applicable', () => {
  const out = parityCheck({ evidence: evidence(), digests: DIGESTS, tuning: SIX, scopedOut: SCOPED_OUT, ancestor: true });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.judged, FIVE);
  assert.equal(out.notApplicable.length, 1);
  assert.match(out.notApplicable[0] ?? '', /^tmc: not applicable, no M1 lockstep run \(the owner's answer to Q1 .*"Keep tmc as 99\.94%\. It's a benchmark row that we can improve later"\)$/);
  assert.deepEqual(Object.keys(SCOPED_OUT), ['tmc'], 'the owner scoped out tmc and nothing else');
});

test('parityCheck: without the scoping, tmc fails; a stale scoping fails', () => {
  assert.deepEqual(parityCheck({ evidence: evidence(), digests: DIGESTS, tuning: SIX, scopedOut: {}, ancestor: true }).problems, ['tmc: no parity evidence and no committed PoC digest']);
  assert.deepEqual(parityCheck({ evidence: evidence(), digests: DIGESTS, tuning: FIVE, scopedOut: SCOPED_OUT, ancestor: true }).problems, ['tmc is scoped out but is not a tuning dataset (the scoping is stale)']);
});

test('parityCheck judges every ROM of its scope as strictly as before: digest, rows, every lockstep set, the commit, the PoC source', () => {
  const run = (e: ParityEvidence | undefined, ancestor = true): readonly string[] => parityCheck({ evidence: e, digests: DIGESTS, tuning: SIX, scopedOut: SCOPED_OUT, ancestor }).problems;
  assert.deepEqual(run(undefined), ['bench/results.json holds no parity evidence']);
  assert.deepEqual(run(evidence((n) => (n === 'sa2' ? { rowDiffs: 3 } : {}))), ['sa2: 3 rows differed from the PoC baseline']);
  assert.deepEqual(run(evidence((n) => (n === 'klonoa' ? { digest: 'x' } : {}))), ['klonoa: parity digest x, the PoC\'s is klonoa-digest']);
  const diverged = evidence((n) => (n === 'fe7j' ? { lockstep: LOCKSTEP_SETS.map((set) => ({ set, queries: 10, matched: 7, skipped: 3, parityDigest: D(n), divergence: set === 'all' ? { seq: 4, kind: 'reading', detail: 'd' } : null })) } : {}));
  assert.deepEqual(run(diverged), ['fe7j: lockstep all diverges at seq 4 (reading): d']);
  const short = evidence((n) => (n === 'sa3' ? { lockstep: LOCKSTEP_SETS.filter((set) => set !== 'driver').map((set) => ({ set, queries: 10, matched: 7, skipped: 3, parityDigest: D(n), divergence: null })) } : {}));
  assert.deepEqual(run(short), ['sa3: no lockstep driver']);
  assert.deepEqual(run(evidence(), false), ['the evidence names commit e867dae, which is not an ancestor of HEAD']);
  assert.deepEqual(run({ ...evidence(), worklist: 'epoch' }), ['the parity evidence is romlift-bench/parity-evidence@1 under epoch']);
  const { pokeemerald: _dropped, ...four } = evidence().roms;
  assert.deepEqual(run({ ...evidence(), roms: four }), ['pokeemerald: no parity evidence']);
});

test('gateStep: once phase 2 has landed, a gate with a historicalCheck runs it and is historical only when it returns', () => {
  const frozen = decideHistorical({ needs: [], historicalAfter: 2 }, 2);
  assert.equal(frozen?.verdict, 'historical');
  const check = async (): Promise<void> => {};
  assert.deepEqual(gateStep({ historicalCheck: check }, frozen), { kind: 'run', call: 'historicalCheck', onReturn: 'historical', detail: 'frozen since phase 2 landed' });
  // Without a check the verdict is recorded without running anything (no phase-2 gate does this: gates-index.test.ts).
  assert.deepEqual(gateStep({}, frozen), { kind: 'record', verdict: 'historical', detail: 'frozen since phase 2 landed', missing: [] });
  // Before landing, run runs and passes.
  assert.deepEqual(gateStep({ historicalCheck: check }, decideHistorical({ needs: [], historicalAfter: 2 }, 1)), { kind: 'run', call: 'run', onReturn: 'pass' });
  assert.deepEqual(gateStep({}, { verdict: 'unavailable', detail: 'roms: missing', missing: ['roms'] }), { kind: 'record', verdict: 'unavailable', detail: 'roms: missing', missing: ['roms'] });
});

test('the harness end to end: at landed 2 a historical gate whose check throws records fail, one whose check returns records historical', async () => {
  // A copy of the real harness (gate.ts imports only node:*) in a temporary repository whose phase.json is
  // { "landed": 2 }, running two gates frozen after phase 2, one per outcome of the check.
  const root = await mkdtemp(path.join(tmpdir(), 'romlift-historical-'));
  try {
    const gates = path.join(root, 'test', 'gates');
    await mkdir(gates, { recursive: true });
    await copyFile(fileURLToPath(new URL('../../gates/gate.ts', import.meta.url)), path.join(gates, 'gate.ts'));
    await writeFile(path.join(gates, 'phase.json'), '{ "landed": 2 }\n');
    const file = (id: string, body: string): string => `import { gate } from './gate.ts';\nconst check = async () => { ${body} };\ngate({ id: '${id}', phase: 2, tier: 'ci', needs: [], historicalAfter: 2, historicalCheck: check, run: check });\n`;
    await writeFile(path.join(gates, 'g2.failing.test.ts'), file('g2.failing', "throw new Error('rows differ');"));
    await writeFile(path.join(gates, 'g2.holding.test.ts'), file('g2.holding', 'return;'));
    const report = path.join(root, 'report.ndjson');
    const child = spawnSync(process.execPath, ['--test', path.join(gates, 'g2.failing.test.ts'), path.join(gates, 'g2.holding.test.ts')], {
      cwd: root,
      env: { ...withoutTestContext(process.env), ROMLIFT_GATE_TIER: 'ci', ROMLIFT_GATE_REPORT: report, ROMLIFT_BENCH_ROOT: root, ROMLIFT_POC: root },
      encoding: 'utf8',
    });
    assert.notEqual(child.status, 0, 'the failing historical check fails the test run');
    const lines = (await readFile(report, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { readonly id: string; readonly verdict: string; readonly detail: string });
    const byId = new Map(lines.map((l) => [l.id, l]));
    assert.equal(byId.get('g2.failing')?.verdict, 'fail');
    assert.match(byId.get('g2.failing')?.detail ?? '', /rows differ/);
    assert.equal(byId.get('g2.holding')?.verdict, 'historical');
    assert.match(byId.get('g2.holding')?.detail ?? '', /^frozen since phase 2 landed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
