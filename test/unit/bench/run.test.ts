// `bench run` on the synthetic real tier with a hand-built romlift analysis (harness.ts): the artifact it
// writes, the --json line the g2 gates read, the refusals, the sealed path (counts only), --reveal, and
// the CLI's command set. No ROM is needed.
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { BenchContext } from '../../../bench/src/context.ts';
import { main, COMMANDS, type BenchIo } from '../../../bench/src/cli.ts';
import { datasetCheck } from '../../../bench/src/dataset-check.ts';
import { pocCheck } from '../../../bench/src/poc-check.ts';
import { provenanceChecks, provenanceInputs } from '../../../bench/src/provenance.ts';
import { cpuProfPath, topSelfTime } from '../../../bench/src/cpu-prof.ts';
import { benchRun } from '../../../bench/src/run.ts';
import { resultParityDigest } from '../../../bench/src/parity.ts';
import { LOCKSTEP_SETS } from '../../../bench/src/parity-evidence.ts';
import { pocSourceDigest } from '../../../bench/src/poc-source.ts';
import { assertCountsOnly } from '../../../bench/src/seal.ts';
import { failingRunner, withTempDir } from './fixtures.ts';
import { EXPECTED_ROMLIFT_ROW, syntheticTier, TINY_DEPS, tinyDeps, tinyDump, tinyResult } from './harness.ts';

function capture(): BenchIo & { readonly lines: string[]; readonly errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

const RUNNER = TINY_DEPS.runner;

/** Adds a held-out dataset over the same ROM and ELF; sealed unless `revealed` holds an entry. */
async function addHeldOut(cx: BenchContext, name: string, revealed: readonly unknown[] = []): Promise<void> {
  const tiny = JSON.parse(await readFile(join(cx.repoRoot, 'bench', 'dataset', 'real', 'tiny.json'), 'utf8')) as Record<string, unknown>;
  const d = { ...tiny, name, family: 'other-family', heldout: true, revealed, labels: [], untyped: [] };
  await writeFile(join(cx.repoRoot, 'bench', 'dataset', 'real', `${name}.json`), `${JSON.stringify(d, null, 2)}\n`);
}

test("bench run scores romlift's analysis and writes results.json without volatile values", async () => {
  await withTempDir('romlift-run-', async (root) => {
    const cx = await syntheticTier(root);
    const { results, report } = await benchRun(cx, { runner: RUNNER });
    assert.deepEqual(report.roms, [EXPECTED_ROMLIFT_ROW]);
    assert.deepEqual(results?.roms, [EXPECTED_ROMLIFT_ROW]);
    const text = await readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8');
    const written = JSON.parse(text) as { meta: Record<string, unknown>; gates: unknown };
    assert.deepEqual(Object.keys(written), ['meta', 'gates', 'roms']);
    assert.deepEqual(Object.keys(written.meta), ['commit', 'dirty', 'sourceDigest', 'nodeMajor', 'romliftVersion', 'inputs', 'toolchain', 'families', 'source', 'profile']);
    assert.equal(written.meta['romliftVersion'], '1.2.3');
    assert.equal(written.meta['source'], 'romlift');
    assert.equal(written.meta['profile'], 'agbcc');
    // Determinism ran (the two digests agree) and the PoC dump gave the scaffold verdict; no speed baseline.
    assert.deepEqual(written.meta['families'], { tiny: ['code-end', 'determinism', 'entries', 'extents', 'scaffold'] });
    assert.deepEqual(Object.keys(written.meta['inputs'] as object), ['tiny', 'pocSourceDigest']);
    assert.ok(!/generatedAt|"seconds"|scoreMs|CpuMs/.test(text));
    const timings = JSON.parse(await readFile(join(cx.repoRoot, 'bench', 'timings.json'), 'utf8')) as { roms: Record<string, Record<string, number>> };
    assert.deepEqual(Object.keys(timings.roms['tiny'] ?? {}), ['scoreMs', 'analysisCpuMs', 'analysisWallMs']);
    // A second run on the same sources and inputs writes the same artifact.
    await benchRun(cx, { runner: RUNNER });
    assert.equal(await readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8'), text);
  });
});

test('bench run records a non-deterministic analysis and a missing dump', async () => {
  await withTempDir('romlift-run-nondet-', async (root) => {
    const cx = await syntheticTier(root);
    const { report } = await benchRun(cx, { runner: tinyDeps(tinyResult(), { second: tinyResult([0x0800_0018]) }).runner, json: true });
    assert.equal(report.roms[0]?.deterministic, false);
    await rm(join(cx.repoRoot, 'bench', '.local'), { recursive: true });
    const { results } = await benchRun(cx, { runner: RUNNER });
    assert.equal(results?.roms[0]?.scaffold, undefined);
    assert.deepEqual(results?.meta.families, { tiny: ['code-end', 'determinism', 'entries', 'extents'] });
  });
});

test('bench run refuses a ROM or an ELF whose digest differs from the dataset, and a dump of another PoC', async () => {
  await withTempDir('romlift-run-refuse-', async (root) => {
    const sha = await syntheticTier(join(root, 'a'), { datasetOverrides: { sha1: '1'.repeat(40) } });
    await assert.rejects(benchRun(sha, { runner: RUNNER }), /refusing tiny\/tiny\.gba: SHA-1/);
    const elf = await syntheticTier(join(root, 'b'), { datasetOverrides: { elfSha256: '2'.repeat(64) } });
    await assert.rejects(benchRun(elf, { runner: RUNNER }), /refusing tiny\/tiny\.elf: sha256/);
    const poc = await syntheticTier(join(root, 'c'), { dump: tinyDump({ pocSourceDigest: '3'.repeat(64) }) });
    await assert.rejects(benchRun(poc, { runner: RUNNER }), /not the pinned/);
  });
});

test('--json prints the frozen bench-run line, writes no results.json, and passes the tuning through', async () => {
  await withTempDir('romlift-run-json-', async (root) => {
    const cx = await syntheticTier(root);
    const calls: { trail: string; disabled: readonly string[] }[] = [];
    const deps = tinyDeps(tinyResult(), { onAnalyze: (c) => calls.push(c) });
    const io = capture();
    assert.equal(await main(['run', '--json', '--worklist', 'ascending', '--disable', 'valid.dense', '--disable', 'bl.near-is-call,gap.arm-scan'], cx, io, deps), 0);
    const line = JSON.parse(io.lines.at(-1) ?? '') as Record<string, unknown>;
    assert.deepEqual(Object.keys(line), ['schema', 'roms', 'sealed', 'failed']);
    assert.equal(line['schema'], 'romlift/bench-run@1');
    assert.deepEqual(line['roms'], [EXPECTED_ROMLIFT_ROW]);
    assert.deepEqual(line['sealed'], []);
    assert.deepEqual(calls, [{ trail: 'off', disabled: ['valid.dense', 'bl.near-is-call', 'gap.arm-scan'] }]);
    await assert.rejects(readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8'), /ENOENT/);
    assert.ok((await readFile(join(cx.repoRoot, 'bench', 'timings.json'), 'utf8')).includes('generatedAt'));
    // The tuning is refused where it would reach the committed artifact, and a bad value is a usage error.
    assert.equal(await main(['run', '--worklist', 'ascending'], cx, capture(), deps), 1);
    assert.equal(await main(['run', '--json', '--worklist', 'lifo'], cx, capture(), deps), 2);
    assert.equal(await main(['run', '--json', '--disable', 'not-a-rule'], cx, capture(), deps), 2);
    assert.equal(await main(['run', '--json', '--disable'], cx, capture(), deps), 2);
  });
});

test('an analysis that throws is a failed ROM: --json exits 1 with it listed; the artifact is not written', async () => {
  await withTempDir('romlift-run-fail-', async (root) => {
    const cx = await syntheticTier(root);
    const deps = { ...TINY_DEPS, runner: failingRunner() };
    const io = capture();
    assert.equal(await main(['run', '--json'], cx, io, deps), 1);
    const line = JSON.parse(io.lines.at(-1) ?? '') as { roms: unknown[]; failed: { name: string; detail: string }[] };
    assert.deepEqual(line.roms, []);
    assert.deepEqual(line.failed.map((f) => f.name), ['tiny']);
    assert.match(io.errors[0] ?? '', /^tiny: profile agbcc: pipeline rule seed\.rom-entry has no implementation$/);
    const plain = capture();
    assert.equal(await main(['run'], cx, plain, deps), 1);
    assert.match(plain.errors.at(-1) ?? '', /not writing bench\/results\.json: the analysis failed on tiny/);
    await assert.rejects(readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8'), /ENOENT/);
  });
});

test('a sealed dataset runs sealed: counts and a verdict only, never an address, and never a row', async () => {
  await withTempDir('romlift-run-sealed-', async (root) => {
    const cx = await syntheticTier(root);
    await addHeldOut(cx, 'held');
    const io = capture();
    assert.equal(await main(['run', '--only', 'held', '--json'], cx, io, TINY_DEPS), 0);
    for (const line of [...io.lines, ...io.errors]) assert.ok(!/0x[0-9a-f]{5,}|thumb_two|lib_helper/i.test(line), line);
    const report = JSON.parse(io.lines.at(-1) ?? '') as { roms: unknown[]; sealed: Record<string, unknown>[] };
    assert.deepEqual(report.roms, []);
    assert.equal(report.sealed.length, 1);
    const [entry] = report.sealed;
    assertCountsOnly(entry);
    // thumb_two is missed outside every found extent: glued, so the ROM fails.
    assert.deepEqual(entry, {
      name: 'held',
      entries: 3,
      elfFunctions: 3,
      tp: 2,
      glued: 1,
      labelCandidates: 0,
      falseEntries: { startup: 0, veneer: 0, adrCallback: 0, insideElfFunction: 1 },
      extents: { sized: 2, agree: 2 },
      codeEnd: { delta: 0 },
      pass: false,
    });
    await assert.rejects(readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8'), /ENOENT/);
    // The plain --json run is the tuning set; the lead's run stores the sealed counts beside the rows.
    const tuning = capture();
    assert.equal(await main(['run', '--json'], cx, tuning, TINY_DEPS), 0);
    assert.deepEqual((JSON.parse(tuning.lines.at(-1) ?? '') as { sealed: unknown[] }).sealed, []);
    assert.equal(await main(['run'], cx, capture(), TINY_DEPS), 0);
    const written = JSON.parse(await readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8')) as { roms: { name: string }[]; sealed: unknown[] };
    assert.deepEqual(written.roms.map((r) => r.name), ['tiny']);
    assert.deepEqual(written.sealed, [entry]);
    assert.ok(provenanceChecks(await provenanceInputs(cx)).every((c) => c.ok));
    // A failing sealed analysis withholds its detail.
    const failed = capture();
    assert.equal(await main(['run', '--only', 'held', '--json'], cx, failed, { ...TINY_DEPS, runner: failingRunner('boom at 0x08000010') }), 1);
    assert.ok(![...failed.lines, ...failed.errors].some((l) => l.includes('0x08000010')));
  });
});

test('--reveal appends to the revealed log, prints the rows, and writes no rows into results.json', async () => {
  await withTempDir('romlift-run-reveal-', async (root) => {
    const cx = await syntheticTier(root);
    await addHeldOut(cx, 'held');
    assert.equal(await main(['run'], cx, capture(), TINY_DEPS), 0);
    const before = await readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8');
    assert.equal(await main(['run', '--reveal', 'held'], cx, capture(), TINY_DEPS), 2);
    assert.equal(await main(['run', '--reason', 'x'], cx, capture(), TINY_DEPS), 2);
    const io = capture();
    assert.equal(await main(['run', '--reveal', 'held', '--reason', 'diagnose a glued miss'], cx, io, TINY_DEPS), 0);
    assert.ok(io.lines.some((l) => l.includes('"0x0800000E"')), 'the rows are printed');
    const file = JSON.parse(await readFile(join(cx.repoRoot, 'bench', 'dataset', 'real', 'held.json'), 'utf8')) as { revealed: { at: string; commit: string; reason: string }[]; heldout: boolean; family: string };
    assert.equal(file.heldout, true);
    assert.equal(file.family, 'other-family');
    assert.deepEqual(file.revealed.map((r) => [r.at, r.reason]), [['2026-10-17T00:00:00.000Z', 'diagnose a glued miss']]);
    assert.equal(await readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8'), before);
    // A dataset that is not held out is never revealed.
    assert.equal(await main(['run', '--reveal', 'tiny', '--reason', 'x'], cx, capture(), TINY_DEPS), 1);
  });
});

/** A lockstep that follows the log on every set and ends at `digest`. */
function followingLockstep(digest: string): NonNullable<Parameters<typeof benchRun>[1]['lockstep']> {
  return async () => ({
    sets: LOCKSTEP_SETS.map((s) => ({ set: s.name, real: [...s.real], queries: 4, matched: 3, answered: 1, compared: 2, markers: 1, skipped: 1, recalled: 0, parityDigest: digest, divergence: null })),
  });
}

test('a parity run records the evidence; later runs keep it; --only and a disabled rule are refused', async () => {
  await withTempDir('romlift-run-parity-', async (root) => {
    const cx = await syntheticTier(root);
    const digest = resultParityDigest(tinyResult());
    await writeFile(join(cx.repoRoot, 'bench', 'baseline', 'poc-digests.json'), JSON.stringify({ schema: 'romlift-bench/poc-digests@1', pocSourceDigest: pocSourceDigest({}), roms: { tiny: digest } }));
    const lifo = { worklist: 'poc-lifo' as const, disabled: [] };
    const first = await benchRun(cx, { runner: RUNNER, tuning: lifo, parityEvidence: true, lockstep: followingLockstep(digest) });
    assert.deepEqual(first.parityProblems, []);
    const evidence = first.results?.parity;
    assert.equal(evidence?.worklist, 'poc-lifo');
    assert.deepEqual(evidence?.roms['tiny']?.lockstep.map((s) => s.set), LOCKSTEP_SETS.map((s) => s.name));
    assert.equal(evidence?.roms['tiny']?.digest, digest);
    assert.deepEqual(first.report.roms[0]?.parity, { digest, expected: digest });
    // A default run keeps the evidence as written.
    const { results } = await benchRun(cx, { runner: RUNNER });
    assert.deepEqual(results?.parity, evidence);
    // A diverging lockstep is recorded and reported.
    const diverging: NonNullable<Parameters<typeof benchRun>[1]['lockstep']> = async () => ({
      sets: LOCKSTEP_SETS.map((s) => ({ set: s.name, real: [...s.real], queries: 4, matched: 1, answered: 0, compared: 1, markers: 1, skipped: 0, recalled: 0, parityDigest: null, divergence: { seq: 2, kind: 'answer', epoch: 1, method: 'valid', detail: 'ours true, the PoC false' } })),
    });
    const bad = await benchRun(cx, { runner: RUNNER, tuning: lifo, parityEvidence: true, lockstep: diverging });
    assert.match(bad.parityProblems?.[0] ?? '', /^tiny: lockstep driver diverges at seq 2 \(answer\)/);
    await assert.rejects(benchRun(cx, { runner: RUNNER, tuning: lifo, parityEvidence: true, only: 'tiny', lockstep: diverging }), /drop --only/);
    await assert.rejects(benchRun(cx, { runner: RUNNER, tuning: { worklist: 'poc-lifo', disabled: ['valid.dense'] }, parityEvidence: true }), /only under --worklist poc-lifo with nothing disabled/);
  });
});

test('poc-check, dataset-check and provenance pass on the synthetic tier', async () => {
  await withTempDir('romlift-checks-', async (root) => {
    const cx = await syntheticTier(root);
    const report = await pocCheck(cx);
    assert.deepEqual(report, { ok: true, roms: [{ name: 'tiny', rowsEqual: true, pocRowEqual: true, diffs: [], scaffoldOk: true, deterministic: true, pocSourceDigestOk: true }] });
    assert.deepEqual(await datasetCheck(cx, RUNNER), { ok: true, problems: [] });
    await benchRun(cx, { runner: RUNNER });
    assert.ok(provenanceChecks(await provenanceInputs(cx)).every((c) => c.ok));
    // Editing a source the digest covers makes the artifact stale.
    await writeFile(join(cx.repoRoot, 'src', 'index.ts'), 'export const changed = 1;\n');
    const [digest] = provenanceChecks(await provenanceInputs(cx));
    assert.equal(digest?.ok, false);
  });
});

test('poc-check reports a dump whose rescored row differs from the baseline', async () => {
  await withTempDir('romlift-pocdiff-', async (root) => {
    const base = tinyDump();
    const cx = await syntheticTier(root, { dump: { ...base, analysis: { ...base.analysis, codeRange: ['0x08000000', '0x08000020'] }, digests: ['a', 'b'] } });
    const [r] = (await pocCheck(cx)).roms;
    assert.equal(r?.rowsEqual, false);
    assert.equal(r?.deterministic, false);
    assert.deepEqual(r?.diffs, ['row codeEnd.delta: expected 0, got 4', 'row codeEnd.found: expected "0x0800001C", got "0x08000020"', 'row deterministic: expected true, got false']);
  });
});

test('the CLI dispatches the phase-2 commands and prints the frozen --json lines', async () => {
  assert.deepEqual(Object.keys(COMMANDS).sort(), ['ablate', 'adopt', 'baseline', 'dataset-check', 'diff', 'doctor-real', 'explain', 'gates', 'poc-check', 'provenance', 'regression', 'run', 'speed', 'stale-check', 'web']);
  await withTempDir('romlift-cli-', async (root) => {
    const cx = await syntheticTier(root);
    let io = capture();
    assert.equal(await main(['frobnicate', 'tiny'], cx, io, TINY_DEPS), 2);
    assert.equal(await main(['toString'], cx, (io = capture()), TINY_DEPS), 2);
    assert.equal(await main(['run', '--bogus'], cx, (io = capture()), TINY_DEPS), 2);
    assert.equal(await main([], cx, (io = capture()), TINY_DEPS), 2);
    assert.equal(await main(['run'], cx, (io = capture()), TINY_DEPS), 0);
    assert.match(io.lines.at(-1) ?? '', /^wrote bench\/results\.json \(1 rows, 0 sealed/);

    assert.equal(await main(['poc-check', '--json'], cx, (io = capture()), TINY_DEPS), 0);
    const poc = JSON.parse(io.lines.at(-1) ?? '') as { ok: boolean; roms: Record<string, unknown>[] };
    assert.equal(poc.ok, true);
    assert.deepEqual(Object.keys(poc.roms[0] ?? {}), ['name', 'rowsEqual', 'pocRowEqual', 'diffs', 'scaffoldOk', 'deterministic', 'pocSourceDigestOk']);

    assert.equal(await main(['dataset-check', '--json'], cx, (io = capture()), TINY_DEPS), 0);
    assert.deepEqual(JSON.parse(io.lines.at(-1) ?? ''), { ok: true, problems: [] });

    assert.equal(await main(['provenance', '--json'], cx, (io = capture()), TINY_DEPS), 0);
    const prov = JSON.parse(io.lines.at(-1) ?? '') as { ok: boolean; checks: { id: string; ok: boolean; detail: string }[] };
    assert.equal(prov.ok, true);
    assert.deepEqual(prov.checks.map((c) => c.id), ['source-digest', 'gate-record', 'families', 'dataset-rows', 'heldout-rows']);
    assert.equal(await main(['stale-check'], cx, (io = capture()), TINY_DEPS), 0);

    const artifact = join(cx.repoRoot, 'bench', 'results.json');
    assert.equal(await main(['baseline', 'tiny', '--base', artifact], cx, (io = capture()), TINY_DEPS), 0);
    assert.match(io.lines[0] ?? '', /^tiny .*\nbaseline: .*rows from romlift$/);
    // The synthetic run misses thumb_two and its dataset does not list it: a regression.
    assert.equal(await main(['regression', '--base', artifact], cx, (io = capture()), TINY_DEPS), 1);
    assert.deepEqual(io.lines.slice(1), [`REGRESSION against ${artifact}: 1 failure(s)`, '  tiny: miss 0x0800000E thumb_two (unanchored) is not in the labels list']);
    assert.equal(await main(['regression', '--base', artifact, '--json'], cx, (io = capture()), TINY_DEPS), 1);
    assert.deepEqual(JSON.parse(io.lines.at(-1) ?? ''), {
      schema: 'romlift/bench-regression@1',
      ok: false,
      base: artifact,
      problems: [{ kind: 'unlisted-miss', rom: 'tiny', detail: 'miss 0x0800000E thumb_two (unanchored) is not in the labels list' }],
    });
    assert.equal(await main(['diff', '--base', artifact], cx, (io = capture()), TINY_DEPS), 0);
    assert.match(io.lines.at(-1) ?? '', /^no row moved/);
    assert.equal(await main(['regression', '--base', join(root, 'none.json'), '--json'], cx, (io = capture()), TINY_DEPS), 0);
    assert.match(io.lines[0] ?? '', /^note: the base .* has no bench\/results\.json/);
    assert.deepEqual(JSON.parse(io.lines.at(-1) ?? ''), { schema: 'romlift/bench-regression@1', ok: true, base: join(root, 'none.json'), problems: [] });
  });
});

test('topSelfTime attributes each sample delta to its node and sums by function, most first', () => {
  const frame = (functionName: string, url: string, lineNumber: number): { functionName: string; url: string; lineNumber: number } => ({ functionName, url, lineNumber });
  const profile = {
    nodes: [
      { id: 1, callFrame: frame('(root)', '', -1) },
      { id: 2, callFrame: frame('looksLikePointerTable', 'file:///repo/src/a.ts', 9) },
      { id: 3, callFrame: frame('looksLikePointerTable', 'file:///repo/src/a.ts', 9) },
      { id: 4, callFrame: frame('', 'node:internal', 0) },
    ],
    startTime: 0,
    endTime: 10_000,
    samples: [2, 3, 4, 2],
    timeDeltas: [1000, 2000, 500, 1500],
  };
  assert.deepEqual(topSelfTime(profile, 5, '/repo'), [
    { functionName: 'looksLikePointerTable', url: 'src/a.ts', line: 10, selfMs: 4.5 },
    { functionName: '(anonymous)', url: 'node:internal', line: 1, selfMs: 0.5 },
  ]);
  // Without samples the hit counts share the profiled time.
  const hits = { nodes: [{ id: 1, callFrame: frame('f', 'x', 0), hitCount: 3 }, { id: 2, callFrame: frame('g', 'x', 1), hitCount: 1 }], startTime: 0, endTime: 4000 };
  assert.deepEqual(topSelfTime(hits, 1).map((t) => [t.functionName, t.selfMs]), [['f', 3]]);
});

test("--cpu-prof profiles each tuning ROM's analysis and writes its top self-time functions to bench/.local", async () => {
  await withTempDir('romlift-run-cpuprof-', async (root) => {
    const cx = await syntheticTier(root);
    const io = capture();
    assert.equal(await main(['run', '--json', '--cpu-prof'], cx, io, TINY_DEPS), 0);
    const written = JSON.parse(await readFile(cpuProfPath(cx, 'tiny'), 'utf8')) as { rom: string; top: unknown[] };
    assert.equal(written.rom, 'tiny');
    assert.ok(Array.isArray(written.top));
    assert.ok(io.lines.some((l) => l.includes('top self-time functions')));
  });
});
