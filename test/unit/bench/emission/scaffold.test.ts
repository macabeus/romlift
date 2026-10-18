// bench/src/scaffold.ts on committed fixtures: the discover model is built once per analysis; the readable
// printer's statistics and tree digest; each printer's tree, applied into an empty directory as a fresh
// project and linked, reproduces the fixture's SHA-1, and a ROM whose bytes differ does not; and the whole
// scaffold step, where every agreeing function is compared (here against an objects directory that defines
// none of them, so no objdiff-cli runs and each is a missing symbol). Linking skips as unavailable only
// without binutils.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';

import { discover, emitTree, parseElf, profileById, romFromBytes, type Rom } from 'romlift';
import { findBinutils } from 'romlift/node';

import { readableStats, treePass } from '../../../../bench/src/readability.ts';
import { discoverModel, ROMLIFT_FAMILIES, scaffoldTree } from '../../../../bench/src/scaffold.ts';
import { agreeingFunctions } from '../../../../bench/src/score.ts';
import { elfTruth } from '../../../../bench/src/truth.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../../helpers/fixtures.ts';
import { withTempDir } from '../fixtures.ts';

const tools = findBinutils(process.env);
const skip = 'code' in tools ? 'unavailable: toolchain' : false;

const profile = profileById('agbcc');
if (profile === undefined) throw new Error('the agbcc profile is not registered');

const fixture = listSyntheticFixtures().find((f) => f.name === 'far-jump');
if (fixture === undefined) throw new Error('no far-jump fixture');
const rom = readFixtureRom(fixture);
const analysis = discover(rom, { profile });

test('the discover model is built once per analysis', () => {
  assert.equal(discoverModel(rom, analysis), discoverModel(rom, analysis));
});

test("readability: the readable printer's statistics and the readable stream's digest", () => {
  const model = discoverModel(rom, analysis);
  assert.deepEqual(ROMLIFT_FAMILIES.readability(rom, analysis), {
    stats: readableStats(rom, model),
    treeDigest: treePass(emitTree(rom, model, { decomp: { defined: new Set() } })).treeDigest,
  });
});

test('each printer: the tree applied into an empty directory links to the SHA-1', { skip }, async () => {
  const model = discoverModel(rom, analysis);
  for (const printer of ['raw', 'readable'] as const) {
    await withTempDir(`romlift-scaffold-${printer}-`, async (dir) => {
      const outcome = await scaffoldTree(rom, model, printer, dir);
      assert.ok(outcome.ok, outcome.detail);
      assert.equal(outcome.sha1, rom.sha1);
      assert.equal(outcome.treeDigest, treePass(emitTree(rom, model, { decomp: { defined: new Set() }, printer })).treeDigest);
      // Written as a fresh project: the manifest, no journal left behind.
      assert.ok((await readdir(`${dir}/.romlift`)).includes('manifest.json'));
    });
  }
});

test('a ROM whose bytes differ from the tree does not link to its SHA-1', { skip }, async () => {
  const bytes = rom.bytes.slice();
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
  const other: Rom = romFromBytes(bytes, 'e'.repeat(40));
  await withTempDir('romlift-scaffold-differs-', async (dir) => {
    const outcome = await scaffoldTree(other, discoverModel(rom, analysis), 'readable', dir);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.sha1, rom.sha1, 'the tree still links to what it prints');
  });
});

test('the scaffold step: both links, then every agreeing function compared', { skip }, async () => {
  const elf = parseElf(new Uint8Array(readFileSync(fixture.elf)));
  assert.ok(elf.ok);
  const truth = elfTruth(elf.value, rom.bytes.length);
  const agreeing = agreeingFunctions(
    analysis.functions.map((f) => ({ entry: f.entry, end: f.extent.end })),
    truth,
    analysis.startup.span.end,
  );
  assert.ok(agreeing.length > 0);
  await withTempDir('romlift-scaffold-objects-', async (objectsDir) => {
    const run = await ROMLIFT_FAMILIES.scaffold({ rom, analysis, truth, symbols: elf.value.symbols, objectsDir, objdiff: '/nonexistent/objdiff-cli' });
    assert.ok(run.raw.ok && run.readable.ok, `${run.raw.detail} / ${run.readable.detail}`);
    assert.deepEqual(run.objdiff.linked, true);
    assert.equal(run.objdiff.scored, agreeing.length);
    assert.deepEqual(run.objdiff.differences, { 'missing-symbol': agreeing.length });
    assert.deepEqual(Object.keys(run.timings), ['rawLinkMs', 'readableLinkMs', 'objdiffMs']);
  });
});
