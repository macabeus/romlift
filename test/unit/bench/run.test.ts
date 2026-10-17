import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { main, COMMANDS, type BenchIo } from '../../../bench/src/cli.ts';
import { datasetCheck } from '../../../bench/src/dataset-check.ts';
import { pocCheck } from '../../../bench/src/poc-check.ts';
import { provenanceChecks, provenanceInputs } from '../../../bench/src/provenance.ts';
import { benchRun } from '../../../bench/src/run.ts';
import { withTempDir } from './fixtures.ts';
import { EXPECTED_ROW, syntheticTier, tinyDump } from './harness.ts';

function capture(): BenchIo & { readonly lines: string[]; readonly errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

test('bench run scores the dump and writes results.json without volatile values', async () => {
  await withTempDir('romlift-run-', async (root) => {
    const cx = await syntheticTier(root);
    const { results } = await benchRun(cx);
    assert.deepEqual(results.roms, [EXPECTED_ROW]);
    const text = await readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8');
    const written = JSON.parse(text) as { meta: Record<string, unknown>; gates: unknown };
    assert.deepEqual(Object.keys(written), ['meta', 'gates', 'roms']);
    assert.deepEqual(Object.keys(written.meta), ['commit', 'dirty', 'sourceDigest', 'nodeMajor', 'romliftVersion', 'inputs', 'toolchain', 'families', 'source']);
    assert.equal(written.meta['romliftVersion'], '1.2.3');
    assert.equal(written.meta['source'], 'poc');
    assert.deepEqual(written.meta['families'], { tiny: ['code-end', 'entries', 'extents', 'scaffold'] });
    assert.deepEqual(Object.keys(written.meta['inputs'] as object), ['tiny', 'pocSourceDigest']);
    assert.ok(!/generatedAt|"seconds"|scoreMs/.test(text));
    const timings = JSON.parse(await readFile(join(cx.repoRoot, 'bench', 'timings.json'), 'utf8')) as Record<string, unknown>;
    assert.ok(typeof timings['generatedAt'] === 'string' && typeof timings['machine'] === 'object');
    // A second run on the same sources and inputs writes the same artifact.
    await benchRun(cx);
    assert.equal(await readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8'), text);
  });
});

test('bench run refuses a ROM or an ELF whose digest differs from the dataset, and a dump of another PoC', async () => {
  await withTempDir('romlift-run-refuse-', async (root) => {
    const sha = await syntheticTier(join(root, 'a'), { datasetOverrides: { sha1: '1'.repeat(40) } });
    await assert.rejects(benchRun(sha), /refusing tiny\/tiny\.gba: SHA-1/);
    const elf = await syntheticTier(join(root, 'b'), { datasetOverrides: { elfSha256: '2'.repeat(64) } });
    await assert.rejects(benchRun(elf), /refusing tiny\/tiny\.elf: sha256/);
    const poc = await syntheticTier(join(root, 'c'), { dump: tinyDump({ pocSourceDigest: '3'.repeat(64) }) });
    await assert.rejects(benchRun(poc), /not the pinned/);
  });
});

test('poc-check, dataset-check and provenance pass on the synthetic tier', async () => {
  await withTempDir('romlift-checks-', async (root) => {
    const cx = await syntheticTier(root);
    const report = await pocCheck(cx);
    assert.deepEqual(report, { ok: true, roms: [{ name: 'tiny', rowsEqual: true, pocRowEqual: true, diffs: [], scaffoldOk: true, deterministic: true, pocSourceDigestOk: true }] });
    assert.deepEqual(await datasetCheck(cx), { ok: true, problems: [] });
    await benchRun(cx);
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

test('the CLI dispatches exactly the phase-1 commands and prints the frozen --json lines', async () => {
  assert.deepEqual(Object.keys(COMMANDS).sort(), ['baseline', 'dataset-check', 'diff', 'doctor-real', 'gates', 'poc-check', 'provenance', 'regression', 'run', 'stale-check', 'web']);
  await withTempDir('romlift-cli-', async (root) => {
    const cx = await syntheticTier(root);
    let io = capture();
    assert.equal(await main(['adopt', 'tiny'], cx, io), 2);
    assert.equal(await main(['run', '--bogus'], cx, (io = capture())), 2);
    assert.equal(await main([], cx, (io = capture())), 2);
    assert.equal(await main(['run'], cx, (io = capture())), 0);
    assert.match(io.lines.at(-1) ?? '', /^wrote bench\/results\.json \(1 rows/);

    assert.equal(await main(['poc-check', '--json'], cx, (io = capture())), 0);
    const poc = JSON.parse(io.lines.at(-1) ?? '') as { ok: boolean; roms: Record<string, unknown>[] };
    assert.equal(poc.ok, true);
    assert.deepEqual(Object.keys(poc.roms[0] ?? {}), ['name', 'rowsEqual', 'pocRowEqual', 'diffs', 'scaffoldOk', 'deterministic', 'pocSourceDigestOk']);

    assert.equal(await main(['dataset-check', '--json'], cx, (io = capture())), 0);
    assert.deepEqual(JSON.parse(io.lines.at(-1) ?? ''), { ok: true, problems: [] });

    assert.equal(await main(['provenance', '--json'], cx, (io = capture())), 0);
    const prov = JSON.parse(io.lines.at(-1) ?? '') as { ok: boolean; checks: { id: string; ok: boolean; detail: string }[] };
    assert.equal(prov.ok, true);
    assert.deepEqual(prov.checks.map((c) => c.id), ['source-digest', 'gate-record', 'families', 'dataset-rows', 'heldout-rows']);
    assert.equal(await main(['stale-check'], cx, (io = capture())), 0);

    assert.equal(await main(['baseline', 'tiny', '--base', join(cx.repoRoot, 'bench', 'results.json')], cx, (io = capture())), 0);
    assert.match(io.lines[0] ?? '', /^tiny /);
    // The synthetic run misses thumb_two and its dataset does not list it: a regression.
    assert.equal(await main(['regression', '--base', join(cx.repoRoot, 'bench', 'results.json')], cx, (io = capture())), 1);
    assert.deepEqual(io.lines.slice(1), ['REGRESSION against ' + join(cx.repoRoot, 'bench', 'results.json') + ': 1 failure(s)', '  tiny: miss 0x0800000E thumb_two (unanchored) is not in the labels list']);
    assert.equal(await main(['diff', '--base', join(cx.repoRoot, 'bench', 'results.json')], cx, (io = capture())), 0);
    assert.match(io.lines.at(-1) ?? '', /^no row moved/);
    assert.equal(await main(['regression', '--base', join(root, 'none.json')], cx, (io = capture())), 0);
    assert.match(io.lines[0] ?? '', /^note: the base .* has no bench\/results\.json/);
  });
});
