import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { resultsText } from '../../../bench/src/artifact.ts';
import { REPO_ROOT } from '../../../bench/src/context.ts';
import { blindRecords, formatGateLine, parseGateReport, requireFailures, runGates } from '../../../bench/src/gates.ts';
import { results, withTempDir } from './fixtures.ts';

const GATE_TS = pathToFileURL(join(REPO_ROOT, 'test', 'gates', 'gate.ts')).href;

function gateFile(spec: string): string {
  return `import { gate } from '${GATE_TS}';\ngate(${spec});\n`;
}

const FAKES: Readonly<Record<string, string>> = {
  'g1.fake-pass.test.ts': gateFile("{ id: 'g1.fake-pass', phase: 1, tier: 'ci', needs: [], async run(cx) { cx.digest('roms', 'abc'); cx.note('fine'); } }"),
  'g1.fake-fail.test.ts': gateFile("{ id: 'g1.fake-fail', phase: 1, tier: 'ci', needs: [], async run() { throw new Error('broken on purpose'); } }"),
  'g1.fake-pending.test.ts': gateFile("{ id: 'g1.fake-pending', phase: 1, tier: 'ci', needs: ['noSuchExport'], async run() {} }"),
  'g1.fake-real.test.ts': gateFile("{ id: 'g1.fake-real', phase: 1, tier: 'real', needs: [], async run() {} }"),
  'g1.fake-broken.test.ts': "// tier: 'both'\nthrow new Error('cannot load');\n",
  'g2.fake-later.test.ts': gateFile("{ id: 'g2.fake-later', phase: 2, tier: 'both', needs: [], async run() { throw new Error('later'); } }"),
};

test('bench gates runs fake gate files, reads their records and applies --require', async () => {
  await withTempDir('romlift-fake-gates-', async (dir) => {
    for (const [name, text] of Object.entries(FAKES)) await writeFile(join(dir, name), text);
    await writeFile(join(dir, 'gate.ts'), '// not a gate file\n');
    const cx = { repoRoot: REPO_ROOT, benchRoot: dir, pocRoot: dir };
    const lines: string[] = [];
    const ci = await runGates(cx, { tier: 'ci', require: 1, dir, resultsPath: join(dir, 'results.json'), log: (l) => lines.push(l) });
    assert.deepEqual(
      ci.records.map((r) => [r.id, r.verdict]),
      [
        ['g1.fake-fail', 'fail'],
        ['g1.fake-pass', 'pass'],
        ['g1.fake-pending', 'pending'],
        ['g2.fake-later', 'fail'],
      ],
    );
    assert.deepEqual(ci.records.find((r) => r.id === 'g1.fake-pass')?.inputs, { roms: 'abc' });
    assert.equal(ci.failures.length, 3);
    assert.match(ci.failures[0] ?? '', /^g1\.fake-fail is fail: broken on purpose/);
    assert.match(ci.failures[1] ?? '', /^g1\.fake-pending is pending: not exported yet: noSuchExport/);
    assert.equal(ci.failures[2], 'g1.fake-broken.test.ts left no record in tier ci');
    assert.equal(lines.length, 4);
    assert.match(lines[1] ?? '', /^g1\.fake-pass +pass +fine +\[roms=abc\]$/);

    // The real tier writes its records into results.json, replacing the previous record.
    const artifact = join(dir, 'results.json');
    await writeFile(artifact, resultsText(results([], { gates: { real: [{ id: 'g9.old', verdict: 'pass', inputs: {}, detail: '' }] } })));
    const real = await runGates(cx, { tier: 'real', require: 1, dir, resultsPath: artifact, log: () => {} });
    assert.deepEqual(real.records.map((r) => [r.id, r.verdict]), [['g1.fake-real', 'pass'], ['g2.fake-later', 'fail']]);
    assert.deepEqual(real.failures, ['g1.fake-broken.test.ts left no record in tier real']);
    const written = JSON.parse(await readFile(artifact, 'utf8')) as { gates: { real: { id: string; verdict: string }[] } };
    assert.deepEqual(written.gates.real.map((g) => [g.id, g.verdict]), [['g1.fake-real', 'pass'], ['g2.fake-later', 'fail']]);
    await assert.rejects(runGates(cx, { tier: 'real', dir, resultsPath: join(dir, 'none.json'), log: () => {} }), /run npm run bench -- run first/);
  });
});

test('the report parser keeps the last record of an id and rejects malformed lines', () => {
  const line = (id: string, verdict: string): string => JSON.stringify({ id, phase: 1, tier: 'ci', verdict, detail: '', inputs: {}, missing: [], ms: 1 });
  const parsed = parseGateReport(`${line('g1.b', 'fail')}\n\n${line('g1.a', 'pass')}\n${line('g1.b', 'pass')}\n`);
  assert.deepEqual(parsed.map((r) => [r.id, r.verdict]), [['g1.a', 'pass'], ['g1.b', 'pass']]);
  assert.throws(() => parseGateReport('{'), /line 1 is not JSON/);
  assert.throws(() => parseGateReport(JSON.stringify({ id: 'g1.a', phase: 1, tier: 'ci', verdict: 'maybe' })), /not a gate record/);
  assert.equal(formatGateLine(parsed[0] ?? parsed[1]!), `${'g1.a'.padEnd(32)} ${'pass'.padEnd(11)} `);
});

test('--require ignores later phases, other tiers and historical verdicts', () => {
  const rec = (id: string, phase: number, verdict: string) => ({ id, phase, tier: 'ci' as const, verdict, detail: '', inputs: {}, missing: [] });
  const failures = requireFailures(
    [rec('g1.a', 1, 'historical'), rec('g2.b', 2, 'fail')],
    [
      { file: 'g1.a.test.ts', id: 'g1.a', phase: 1, tier: 'ci' },
      { file: 'g1.c.test.ts', id: 'g1.c', phase: 1, tier: 'real' },
      { file: 'g1.d.test.ts', id: 'g1.d', phase: 1 },
    ],
    1,
    'ci',
  );
  assert.deepEqual(failures, ['g1.d.test.ts left no record (its tier is not declared)']);
});

test('a real-tier run that cannot see its inputs keeps the committed gate record', async () => {
  await withTempDir('romlift-blind-gates-', async (dir) => {
    const gates = join(dir, 'gates');
    const empty = join(dir, 'empty');
    await mkdir(gates);
    await mkdir(empty);
    await writeFile(join(gates, 'phase.json'), '{ "landed": 1 }\n');
    await writeFile(join(gates, 'g1.fake-blind.test.ts'), gateFile("{ id: 'g1.fake-blind', phase: 1, tier: 'real', needs: [], inputs: ['poc'], async run() {} }"));
    const artifact = join(dir, 'results.json');
    const committed = resultsText(results([], { gates: { real: [{ id: 'g1.fake-blind', verdict: 'pass', inputs: { poc: 'abc' }, detail: 'measured' }] } }));
    await writeFile(artifact, committed);
    const lines: string[] = [];
    const run = await runGates({ repoRoot: REPO_ROOT, benchRoot: empty, pocRoot: empty }, { tier: 'real', require: 1, dir: gates, resultsPath: artifact, log: (l) => lines.push(l) });
    assert.deepEqual(run.records.map((r) => [r.id, r.verdict]), [['g1.fake-blind', 'unavailable']]);
    assert.equal(await readFile(artifact, 'utf8'), committed);
    assert.match(lines.at(-1) ?? '', /^kept the gate record of .*results\.json: g1\.fake-blind unavailable/);
    assert.deepEqual(blindRecords(run.records, 0), []);
    assert.equal(blindRecords(run.records, 1).length, 1);
  });
});
