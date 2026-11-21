// The readable printer's `adr` of a Thumb function (the owner's answer to Q7 of phase 3, D72 c; roadmap.md, phase 4,
// "Carried from phase 3"). On the doubled pokeemerald ROM the readable printer wrote `adr r6, sub_0906A708`, naming
// a Thumb function's label, which links to its address plus one: the text-layout check refused the Thumb adr as
// unencodable (E_SELF_CHECK_TEXT, verify exit 3). GNU as encodes it at the even address under the dialect's
// `-mcpu=arm7tdmi`, but with `-mthumb-interwork` it assembles an ARM adr of a Thumb function defined before it to
// the address plus one, so the text was fragile either way. The fixture adr-function-label holds both: a Thumb adr
// in main and an ARM adr in Work_arm, after Handler, take the address of Handler, a Thumb function main also calls.
// Before the fix its readable tree failed the check (`cannot encode \`adr r0, sub_08000104\``), and its module file,
// assembled with -mthumb-interwork, gave `sub r1, pc, #15` where the ROM holds `#16`.
//
// On the fixture's discover model: each adr prints as a mnemonic naming a label that is no function's, the call
// still names the function, the readable tree passes the text-layout check, and with binutils both printers'
// trees link to the fixture's SHA-1.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { emitTree } from '../../../src/core/emit/emit-tree.ts';
import { printChunk } from '../../../src/core/emit/print/chunk.ts';
import type { Printer } from '../../../src/core/emit/tree.ts';
import { buildUnits } from '../../../src/core/model/paths.ts';
import { ItemKind } from '../../../src/core/model/types.ts';
import { checkEntries } from '../../../src/core/verify/text-layout.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { discoverModel } from '../../../src/core/workflow/generate.ts';
import { findBinutils } from '../../../src/shell/toolchain/binutils.ts';
import { linkCheck } from '../../../src/shell/toolchain/link-check.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const FIXTURE = listSyntheticFixtures().find((f) => f.name === 'adr-function-label');
if (FIXTURE === undefined) throw new Error('the adr-function-label fixture is not committed');
const rom = readFixtureRom(FIXTURE);
const model = discoverModel(rom, discover(rom));
const MAIN = 0x0800_00f4;
const HANDLER = 0x0800_0104;
const WORK_ARM = 0x0800_010c;
const tools = findBinutils(process.env);
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** The printed lines of the function chunk starting at `entry`. */
function linesAt(entry: number): readonly string[] {
  const i = model.chunks.findIndex((c) => c.kind === 'function' && c.span.start === entry);
  assert.ok(i >= 0, `no function chunk at 0x${entry.toString(16)}`);
  return printChunk(rom, model, i).lines;
}

test('the model: Handler is a Thumb function with a local label beside its function label', () => {
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(
    model.labels.filter((l) => l.addr === HANDLER).map((l) => [l.name, l.kind, l.thumb]),
    [
      ['_08000104', 'local', false],
      ['sub_08000104', 'func', true],
    ],
  );
  for (let i = 0; i < model.items.count; i++)
    assert.notEqual(
      model.items.kind[i],
      ItemKind.rawInsn,
      `a raw item at 0x${(model.items.start[i] ?? 0).toString(16)}`,
    );
});

test('each adr names the local label, which links to the address itself; the call names the function', () => {
  const functions = new Set(model.labels.filter((l) => l.kind === 'func').map((l) => l.name));
  const adrs = [...linesAt(MAIN), ...linesAt(WORK_ARM)].filter((l) => /^\tadr\b/.test(l));
  assert.deepEqual(adrs, ['\tadr r0, _08000104', '\tadr r1, _08000104']);
  for (const line of adrs) assert.equal(functions.has(line.split(', ')[1] ?? ''), false, line);
  assert.ok(linesAt(MAIN).includes('\tbl sub_08000104'));
});

test('the readable tree passes the text-layout check: no E_SELF_CHECK_TEXT', () => {
  const report = checkEntries(rom, model, emitTree(rom, model, { decomp: { defined: [] } }));
  const text = report.checks.flatMap((c) => c.diagnostics).filter((d) => d.code === 'E_SELF_CHECK_TEXT');
  assert.deepEqual(
    text.map((d) => d.message),
    [],
  );
  assert.equal(report.ok, true);
});

for (const printer of ['readable', 'raw'] as const satisfies readonly Printer[]) {
  test(
    `the ${printer} tree links to the fixture's SHA-1`,
    { skip: 'code' in tools ? `unavailable: ${tools.message}` : false },
    async () => {
      assert.ok(!('code' in tools));
      const dir = await mkdtemp(join(tmpdir(), `romlift-adr-function-label-${printer}-`));
      roots.push(dir);
      for (const e of emitTree(rom, model, { decomp: { defined: [] }, printer })) {
        if (!('text' in e)) continue;
        await mkdir(dirname(join(dir, e.path)), { recursive: true });
        await writeFile(join(dir, e.path), e.text);
      }
      const result = await linkCheck({ dir, rom, units: buildUnits(model), tools });
      assert.equal(result.sha1, rom.sha1, `${result.detail} ${result.diagnostics.map((d) => d.message).join('; ')}`);
    },
  );
}
