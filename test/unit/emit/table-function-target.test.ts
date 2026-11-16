// A jump-table entry without the Thumb bit whose target a Thumb function names (phase-6 fix round 6,
// architecture-o1-1). On table-jump-hoisted, `0x0800013C = "CaseA"` under [entry_points] makes a case target of
// sub_08000108's table a Thumb function label. R_ARM_ABS32 is (S + A) | T, so no addend makes `CaseA` link to the even
// entry 0x0800013C: the old printer wrote `.4byte CaseA - 1`, which ld links to 0x0800013B (generate exited 0 and the
// link failed the SHA-1 at 0x08000124 before fix round 5; E_SELF_CHECK_TEXT after it). The entry now names the local
// label labels.ts places beside the function (resolver.ts addendTo, the rule the printer and the scopes read), the
// tree passes the text-layout check, and with binutils both printers' trees link to the fixture's SHA-1.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { emitTree } from '../../../src/core/emit/emit-tree.ts';
import type { Printer } from '../../../src/core/emit/tree.ts';
import { buildUnits } from '../../../src/core/model/paths.ts';
import { checkEntries } from '../../../src/core/verify/text-layout.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { confirmModel } from '../../../src/core/workflow/generate.ts';
import { findBinutils } from '../../../src/shell/toolchain/binutils.ts';
import { linkCheck } from '../../../src/shell/toolchain/link-check.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const FIXTURE = listSyntheticFixtures().find((f) => f.name === 'table-jump-hoisted');
if (FIXTURE === undefined) throw new Error('the table-jump-hoisted fixture is not committed');
const rom = readFixtureRom(FIXTURE);
const CASE_A = 0x0800_013c;
const base = configFromDiscover(rom, discover(rom));
const config = { ...base, entryPoints: new Map([...base.entryPoints, [CASE_A, { name: 'CaseA', mode: 'thumb' as const, aliases: [] }]]) };
const { model } = confirmModel({ rom, config });
const tools = findBinutils(process.env);
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** Every `.4byte` line of the tree a printer writes. */
function words(printer: Printer): readonly string[] {
  return [...emitTree(rom, model, { decomp: { defined: [] }, printer })].flatMap((e) => ('text' in e ? e.text.split('\n').filter((l) => l.includes('.4byte ')) : []));
}

test('the model: CaseA is a Thumb function label with a local label beside it', () => {
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(
    model.labels.filter((l) => l.addr === CASE_A).map((l) => [l.name, l.kind, l.thumb]),
    [
      ['CaseA', 'func', true],
      ['_0800013C', 'local', false],
    ],
  );
});

test('the even entry names the local label, never `CaseA - 1`', () => {
  const lines = words('readable');
  assert.ok(lines.includes('\t.4byte _0800013C'), lines.join('\n'));
  assert.equal(
    lines.some((l) => l.includes('CaseA')),
    false,
    lines.join('\n'),
  );
});

test('the readable tree passes the text-layout check', () => {
  const report = checkEntries(rom, model, emitTree(rom, model, { decomp: { defined: [] } }));
  assert.ok(report.ok, report.checks.filter((k) => !k.ok).map((k) => k.detail).join('; '));
});

for (const printer of ['readable', 'raw'] as const satisfies readonly Printer[]) {
  test(`the ${printer} tree links to the fixture's SHA-1`, { skip: 'code' in tools ? `unavailable: ${tools.message}` : false }, async () => {
    assert.ok(!('code' in tools));
    const dir = await mkdtemp(join(tmpdir(), `romlift-table-function-target-${printer}-`));
    roots.push(dir);
    for (const e of emitTree(rom, model, { decomp: { defined: [] }, printer })) {
      if (!('text' in e)) throw new Error(`${e.path}: a reconciled entry`);
      await mkdir(dirname(join(dir, e.path)), { recursive: true });
      await writeFile(join(dir, e.path), e.text);
    }
    const linked = await linkCheck({ dir, rom, units: buildUnits(model), tools });
    assert.equal(linked.sha1, rom.sha1, `${linked.detail} ${linked.diagnostics.map((d) => d.message).join('; ')}`);
  });
}
