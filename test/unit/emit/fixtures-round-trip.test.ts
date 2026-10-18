// Wave 2 put together (D63): for every committed fixture, the model configFromDiscover and buildModel make from
// its seedless discover run passes the model self-checks (tiling, re-encode, module size); the tree emitTree
// streams from it passes the text-layout and paths checks; and, with binutils, the tree assembles and links to
// the fixture's own SHA-1. Both printers. This is the ci-tier substance of g3.self-check, g3.text-layout,
// g3.link and g3.raw-link before wave 3 lands the commands those gates drive; it found the PC-relative
// references the legal borders had to stop crossing (D63). Linking skips as unavailable only without binutils.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { emitTree } from '../../../src/core/emit/emit-tree.ts';
import type { FileEntry, Printer } from '../../../src/core/emit/tree.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import { buildUnits } from '../../../src/core/model/paths.ts';
import { profileById } from '../../../src/core/profile/registry.ts';
import { checkEntries } from '../../../src/core/verify/text-layout.ts';
import { verifyModel } from '../../../src/core/verify/tiling.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { findBinutils } from '../../../src/shell/toolchain/binutils.ts';
import { linkCheck } from '../../../src/shell/toolchain/link-check.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const tools = findBinutils(process.env);
const skip = 'code' in tools ? 'unavailable: toolchain' : false;
const PRINTERS: readonly Printer[] = ['readable', 'raw'];
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** The failing checks of a report, for the assertion message. */
function failures(report: { readonly checks: readonly { readonly id: string; readonly ok: boolean; readonly detail: string }[] }): string {
  return report.checks
    .filter((c) => !c.ok)
    .map((c) => `${c.id}: ${c.detail}`)
    .join('; ');
}

/** Writes the generated entries of a stream under a fresh directory. */
async function writeTree(entries: readonly FileEntry[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-fixture-tree-'));
  roots.push(dir);
  for (const e of entries) {
    if (!('text' in e)) throw new Error(`${e.path}: a reconciled entry in a phase-3 stream`);
    await mkdir(dirname(join(dir, e.path)), { recursive: true });
    await writeFile(join(dir, e.path), e.text);
  }
  return dir;
}

const profile = profileById('agbcc');
if (profile === undefined) throw new Error('the agbcc profile is not registered');

for (const fixture of listSyntheticFixtures()) {
  const rom = readFixtureRom(fixture);
  const analysis = discover(rom, { profile });
  const model = buildModel(rom, analysis, configFromDiscover(rom, analysis));

  test(`${fixture.name}: the model passes its self-checks`, () => {
    const report = verifyModel(rom, model);
    assert.ok(report.ok, failures(report));
  });

  for (const printer of PRINTERS) {
    const entries = [...emitTree(rom, model, { decomp: { defined: new Set<string>() }, printer })];

    test(`${fixture.name} (${printer}): the stream passes the text-layout and paths checks`, () => {
      const report = checkEntries(rom, model, entries);
      assert.ok(report.ok, failures(report));
    });

    test(`${fixture.name} (${printer}): the tree links to the fixture's SHA-1`, { skip }, async () => {
      const result = await linkCheck({ dir: await writeTree(entries), rom, units: buildUnits(model), ...('code' in tools ? {} : { tools }) });
      assert.ok(result.ok, `${result.detail} ${result.diagnostics.map((d) => d.message).join('; ')}`);
      assert.equal(result.sha1, rom.sha1);
    });
  }
}

// correctness-4: GNU as pads each object's section to its alignment and ld places it on one, so a ROM whose size
// is not a multiple of its last unit's alignment links to a longer image. The text-layout check must say so
// exactly when the link does: on the first fixture whose last module is data and the first whose last is code,
// cut by 0 to 3 bytes, the check passes exactly when the readable tree links to the cut ROM's SHA-1.
for (const lastKind of ['data', 'asm'] as const) {
  const fixture = listSyntheticFixtures().find((f) => {
    const rom = readFixtureRom(f);
    return configFromDiscover(rom, discover(rom, { profile })).modules.at(-1)?.kind === lastKind;
  });
  if (fixture === undefined) continue;
  for (const cut of [0, 1, 2, 3]) {
    test(`${fixture.name} cut by ${cut} byte(s) (last module ${lastKind}): the text-layout check agrees with the link`, { skip }, async () => {
      const whole = readFixtureRom(fixture);
      const bytes = whole.bytes.slice(0, whole.bytes.length - cut);
      const rom = romFromBytes(bytes, createHash('sha1').update(bytes).digest('hex'));
      const analysis = discover(rom, { profile });
      const model = buildModel(rom, analysis, configFromDiscover(rom, analysis));
      const entries = [...emitTree(rom, model, { decomp: { defined: new Set<string>() }, printer: 'readable' })];
      const report = checkEntries(rom, model, entries);
      const linked = await linkCheck({ dir: await writeTree(entries), rom, units: buildUnits(model), ...('code' in tools ? {} : { tools }) });
      assert.equal(report.ok, linked.ok, `check: ${failures(report) || 'ok'}; link: ${linked.detail}`);
      assert.equal(report.ok, lastKind === 'data' ? cut % 2 === 0 : cut === 0, 'exactly the cuts the alignment of the last unit does not divide fail');
      if (!report.ok) assert.match(failures(report), /GNU as pads the object's section to a multiple of [24] bytes/);
    });
  }
}
