// `bench run` with the phase-3 families on the synthetic tier (harness.ts, the emission faked): the
// readability member and the tree digest on every run; --scaffold with romlift's raw link as the scaffold
// verdict, the objdiff member, the objects digest it read and objdiff-cli in the toolchain; the refusals of a
// dataset without objects or with other objects; --write-readability-floor adding floors once and never
// changing them; and the CLI: --scaffold in the frozen --json line, and `large-rom` relaying the script.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { BenchContext } from '../../../../bench/src/context.ts';
import { main, type BenchIo } from '../../../../bench/src/cli.ts';
import { objectsDigest } from '../../../../bench/src/objects.ts';
import { readabilityFloorPath, READABILITY_FLOOR_SCHEMA } from '../../../../bench/src/readability.ts';
import { LARGE_ROM_SCHEMA as SCRIPT_SCHEMA, LARGE_ROM_SCRIPT as SCRIPT_PATH, type LargeRomReport } from '../../../../bench/src/large-rom.ts';
import { benchRun, LARGE_ROM_SCHEMA, LARGE_ROM_SCRIPT, parseLargeRom } from '../../../../bench/src/run.ts';
import type { ScaffoldInput } from '../../../../bench/src/scaffold.ts';
import { withTempDir } from '../fixtures.ts';
import { EXPECTED_ROMLIFT_ROW, EXPECTED_SCAFFOLD_ROW, runWith, syntheticTier, TINY_DEPS, tinyDeps, TINY_MEMORY, TINY_SHARES, tinyResult } from '../harness.ts';

const REFERENCE_O = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'objdiff', 'reference.o');
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function capture(): BenchIo & { readonly lines: string[]; readonly errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

/** A map that links src/reference.o (its .text is 0x2c bytes); the build directory's stale old/ copy is not linked. */
const MAP = ['Linker script and memory map', '', '.text           0x08000000       0x2c', ' .text          0x08000000       0x2c ./src/reference.o', ''].join('\n');

/** The synthetic tier with a reference objects directory (one linked object, one stale copy) and its map recorded in the dataset. */
async function tierWithObjects(root: string, digest?: string): Promise<{ readonly cx: BenchContext; readonly digest: string }> {
  const objects = join(root, 'bench', 'tiny', 'build');
  for (const dir of ['src', 'old']) {
    await mkdir(join(objects, dir), { recursive: true });
    await copyFile(REFERENCE_O, join(objects, dir, 'reference.o'));
  }
  const actual = await objectsDigest(objects);
  const cx = await syntheticTier(root, { datasetOverrides: { objectsDir: 'tiny/build', objectsDigest: digest ?? actual } });
  await writeFile(join(root, 'bench', 'tiny', 'tiny.map'), MAP);
  return { cx, digest: actual };
}

test('every run measures readability and the tree digest; without --scaffold the row has no scaffold or objdiff member', async () => {
  await withTempDir('romlift-run3-', async (root) => {
    const { cx } = await tierWithObjects(root);
    const { report } = await benchRun(cx, { ...runWith(), json: true });
    const [row] = report.roms;
    assert.ok(row !== undefined && !('scaffold' in row) && !('objdiff' in row));
    assert.deepEqual(report.roms, [EXPECTED_ROMLIFT_ROW]);
  });
});

test('--scaffold: the raw link is the scaffold verdict, the readable build gives the objdiff member, the inputs record the objects', async () => {
  await withTempDir('romlift-run3-scaffold-', async (root) => {
    const { cx, digest } = await tierWithObjects(root);
    const calls: ScaffoldInput[] = [];
    const deps = tinyDeps(tinyResult(), {}, { onScaffold: (input) => calls.push(input) });
    const { report, results } = await benchRun(cx, { ...runWith(deps), scaffold: true });
    assert.deepEqual(report.roms, [EXPECTED_SCAFFOLD_ROW]);
    assert.deepEqual(results?.roms, [EXPECTED_SCAFFOLD_ROW]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.objectsDir, join(cx.benchRoot, 'tiny', 'build'));
    assert.equal(calls[0]?.objdiff, '/fake/objdiff-cli');
    assert.ok((calls[0]?.symbols.length ?? 0) > 0, 'the ELF symbols name the objdiff base');
    assert.deepEqual(calls[0]?.linkedObjects, new Set(['src/reference.o']), 'only the objects the map links define names');
    assert.deepEqual(results?.meta.families, { tiny: ['code-end', 'determinism', 'entries', 'extents', 'readability', 'scaffold'] });
    assert.deepEqual(results?.meta.inputs['tiny'], { sha1: EXPECTED_ROMLIFT_ROW.sha1, elfSha256: (results?.meta.inputs['tiny'] as { elfSha256: string }).elfSha256, objectsDigest: digest });
    assert.ok(results !== undefined && 'objdiff' in results.meta.toolchain, 'objdiff-cli is part of the toolchain of a --scaffold run');
    const timings = JSON.parse(await readFile(join(cx.repoRoot, 'bench', 'timings.json'), 'utf8')) as { roms: Record<string, Record<string, unknown>> };
    assert.deepEqual(Object.keys(timings.roms['tiny'] ?? {}), ['scoreMs', 'analysisCpuMs', 'analysisWallMs', 'readabilityMs', 'rawLinkMs', 'readableLinkMs', 'objdiffMs', 'scaffoldMs']);
  });
});

test('--scaffold: a failed raw link fails the scaffold verdict; a failed readable link leaves objdiff unscored', async () => {
  await withTempDir('romlift-run3-fail-', async (root) => {
    const { cx } = await tierWithObjects(root);
    const raw = await benchRun(cx, { ...runWith(tinyDeps(tinyResult(), {}, { rawOk: false })), scaffold: true, json: true });
    assert.deepEqual(raw.report.roms[0]?.scaffold, { ok: false });
    const readable = await benchRun(cx, { ...runWith(tinyDeps(tinyResult(), {}, { readableOk: false })), scaffold: true, json: true });
    assert.deepEqual(readable.report.roms[0]?.scaffold, { ok: true });
    assert.deepEqual(readable.report.roms[0]?.objdiff, { linked: false, scored: 0, differences: {}, examples: [] });
  });
});

test('--scaffold refuses a dataset without reference objects, objects with another digest, and a missing objdiff-cli', async () => {
  await withTempDir('romlift-run3-refuse-', async (root) => {
    const bare = await syntheticTier(join(root, 'a'));
    await assert.rejects(benchRun(bare, { ...runWith(), scaffold: true, json: true }), /records no objectsDir and objectsDigest/);
    const { cx } = await tierWithObjects(join(root, 'b'), '9'.repeat(64));
    await assert.rejects(benchRun(cx, { ...runWith(), scaffold: true, json: true }), /refusing tiny\/build: digest [0-9a-f]{64}, the dataset records 9{64}/);
    const noTool = { ...runWith(), objdiffTool: async () => Promise.reject(new Error('no objdiff-cli')) };
    await assert.rejects(benchRun(cx, { ...noTool, scaffold: true, json: true }), /no objdiff-cli/);
  });
});

test('--write-readability-floor adds the floors of the ROMs without one, puts them in the rows, and never changes them', async () => {
  await withTempDir('romlift-run3-floor-', async (root) => {
    const { cx } = await tierWithObjects(root);
    const lines: string[] = [];
    const first = await benchRun(cx, { ...runWith(), json: true, writeReadabilityFloor: true, log: (l) => lines.push(l) });
    assert.deepEqual(first.report.roms[0]?.readability, { ...TINY_SHARES, floor: TINY_SHARES });
    assert.ok(lines.some((l) => l === 'bench/baseline/readability.json: floors added for tiny; kept as committed for no ROM'));
    const written = await readFile(readabilityFloorPath(cx), 'utf8');
    assert.deepEqual(JSON.parse(written), { schema: READABILITY_FLOOR_SCHEMA, roms: { tiny: TINY_SHARES } });
    // A later run reads the floor; writing again keeps it as committed.
    const second = await benchRun(cx, { ...runWith(), json: true });
    assert.deepEqual(second.report.roms[0]?.readability.floor, TINY_SHARES);
    await benchRun(cx, { ...runWith(), json: true, writeReadabilityFloor: true });
    assert.equal(await readFile(readabilityFloorPath(cx), 'utf8'), written);
    await assert.rejects(benchRun(cx, { ...runWith(), json: true, writeReadabilityFloor: true, tuning: { disabled: ['valid.dense'] } }), /floors are written only with the default tuning/);
  });
});

test('parseLargeRom keeps the frozen fields in the member and the rest of each run as volatile', () => {
  const line = JSON.stringify({ schema: 'romlift/bench-large-rom@1', ...TINY_MEMORY.member, runs: TINY_MEMORY.member.runs.map((r) => ({ ...r, wallMs: 5, cpuMs: 4 })) });
  const parsed = parseLargeRom(`progress\n${line}\n`);
  assert.deepEqual(parsed.member, TINY_MEMORY.member);
  assert.deepEqual(parsed.timings, { runs: [{ command: 'init', wallMs: 5, cpuMs: 4 }, { command: 'generate', wallMs: 5, cpuMs: 4 }] });
  assert.throws(() => parseLargeRom('not json\n'), /printed no JSON last line/);
  assert.throws(() => parseLargeRom('{"schema":"other"}\n'), /printed no romlift\/bench-large-rom@1 line/);
});

test('parseLargeRom reads what bench/src/large-rom.ts prints: the same script and schema, its runs with detail as volatile', () => {
  assert.equal(LARGE_ROM_SCHEMA, SCRIPT_SCHEMA);
  assert.equal(join(REPO_ROOT, LARGE_ROM_SCRIPT), SCRIPT_PATH);
  const report: LargeRomReport = {
    schema: SCRIPT_SCHEMA,
    romBytes: 33554432,
    sha1: 'b846b9453414ce93afc5e8fd559eaac582dc570e',
    runs: [
      { command: 'init', exitCode: 0, maxRssMiB: 300.5, maxOldSpaceSizeMiB: 384, treeDigest: 'a'.repeat(64), detail: '12 files written' },
      { command: 'generate', exitCode: 3, maxRssMiB: 280.25, maxOldSpaceSizeMiB: 384, detail: 'the paths check failed' },
    ],
  };
  const parsed = parseLargeRom(`${JSON.stringify(report)}\n`);
  assert.deepEqual(parsed.member, {
    romBytes: 33554432,
    sha1: 'b846b9453414ce93afc5e8fd559eaac582dc570e',
    runs: [
      { command: 'init', exitCode: 0, maxRssMiB: 300.5, treeDigest: 'a'.repeat(64) },
      { command: 'generate', exitCode: 3, maxRssMiB: 280.25 },
    ],
  });
  assert.deepEqual(parsed.timings, {
    runs: [
      { command: 'init', maxOldSpaceSizeMiB: 384, detail: '12 files written' },
      { command: 'generate', maxOldSpaceSizeMiB: 384, detail: 'the paths check failed' },
    ],
  });
});

test('the CLI: run --scaffold prints the frozen line with objdiff; large-rom relays the script with its arguments and exit code', async () => {
  await withTempDir('romlift-run3-cli-', async (root) => {
    const { cx } = await tierWithObjects(root);
    let io = capture();
    assert.equal(await main(['run', '--scaffold', '--json'], cx, io, TINY_DEPS), 0);
    const line = JSON.parse(io.lines.at(-1) ?? '') as { schema: string; roms: Record<string, unknown>[] };
    assert.equal(line.schema, 'romlift/bench-run@1');
    assert.deepEqual(line.roms, [EXPECTED_SCAFFOLD_ROW]);
    assert.ok(io.lines.some((l) => /^tiny +raw link SHA-1, readable link SHA-1, objdiff scored 2, differences: 1 unnamed-target$/.test(l)));
    assert.equal(await main(['run', '--reveal', 'tiny', '--reason', 'x', '--scaffold'], cx, (io = capture()), TINY_DEPS), 2);

    const seen: (readonly string[])[] = [];
    const deps = { ...TINY_DEPS, largeRomProcess: async (_cx: BenchContext, args: readonly string[]) => {
      seen.push(args);
      return { code: 3, stdout: 'first\n\n{"schema":"romlift/bench-large-rom@1"}\n', stderr: '' };
    } };
    assert.equal(await main(['large-rom', '--json', '--keep'], cx, (io = capture()), deps), 3);
    assert.deepEqual(seen, [['--json', '--keep']]);
    assert.deepEqual(io.lines, ['first', '', '{"schema":"romlift/bench-large-rom@1"}']);
  });
});
