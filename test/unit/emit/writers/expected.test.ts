// The `expected` writer (architecture §6.3, §6.8, roadmap 6.F, D92): expected/<module>.s of every generated module
// with chunks, the module at its ROM offsets as the ROM's bytes, its functions global and typed under their model
// names, and no symbol named anywhere else, so `as` leaves no relocation and the unlinked object's `.text` is the
// module's ROM range (g6.expected-bytes). The text-layout check lays it out like a module source; a flipped byte fails
// it. A switch to ARM state comes only at the ARM function's label, after the zero pad before it (GNU as word-aligns
// at `.arm`; the composite fixture's ARM function follows a Thumb one at 2 mod 4). With binutils, each object of two
// fixtures equals its range with no relocation and defines each function chunk as a global function of its size.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { expectedText, expectedWriter } from '../../../../src/core/emit/writers/expected.ts';
import type { FileEntry } from '../../../../src/core/emit/tree.ts';
import { buildModel } from '../../../../src/core/model/model.ts';
import type { Model } from '../../../../src/core/model/types.ts';
import { profileById } from '../../../../src/core/profile/registry.ts';
import { configFromDiscover } from '../../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../../src/core/workflow/discover.ts';
import { DIALECT } from '../../../../src/foundation/asm/dialect.ts';
import { parseElf, relocationsOf } from '../../../../src/foundation/formats/elf.ts';
import type { ElfSymbol } from '../../../../src/foundation/formats/types.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import { findBinutils, runTool } from '../../../../src/shell/toolchain/binutils.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../../helpers/fixtures.ts';
import { entryDiagnostics } from '../../../helpers/text-layout.ts';

const CX = { decomp: { defined: [] } };
const tools = findBinutils(process.env);
const skip = 'code' in tools ? 'unavailable: toolchain' : false;
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

function fixtureModel(name: string): { readonly rom: Rom; readonly model: Model } {
  const fixture = listSyntheticFixtures().find((f) => f.name === name);
  if (fixture === undefined) throw new Error(`no fixture ${name}`);
  const profile = profileById('agbcc');
  if (profile === undefined) throw new Error('the agbcc profile is not registered');
  const rom = readFixtureRom(fixture);
  const analysis = discover(rom, { profile });
  return { rom, model: buildModel(rom, analysis, configFromDiscover(rom, analysis)) };
}

function entriesOf(rom: Rom, model: Model): FileEntry[] {
  return model.modules.flatMap((_, i) => [...expectedWriter.emit(rom, model, CX, i)]);
}

/** What the writer may print: no instruction mnemonic and no symbol but the file's own labels. */
const ALLOWED = [/^$/, /^\.syntax unified$/, /^\.include "include\/macros\.inc"$/, /^\.(thumb|arm)$/, /^@ /, /^\t\.(thumb|arm)$/, /^\t\.global \w+$/, /^\t\.type \w+, %function$/, /^\t\.thumb_func$/, /^\w+:$/, /^\t\.inst(\.n|\.w)? 0x[0-9A-F]+$/, /^\t\.4byte 0x[0-9A-F]{8}$/, /^\t\.byte 0x[0-9A-F]{2}(, 0x[0-9A-F]{2})*$/, /^\t\.incbin "baserom\.gba", 0x[0-9A-F]+, 0x[0-9A-F]+$/, /^\t\.size (\w+), \.-\1$/];

test('one generated file per module with chunks, under expected/, laid out by the text-layout check to its ROM range', () => {
  for (const name of ['composite', 'c-data', 'code-copied-to-ram']) {
    const { rom, model } = fixtureModel(name);
    const entries = entriesOf(rom, model);
    assert.deepEqual(entries.map((e) => e.path), model.modules.map((m) => `expected/${m.name}.s`), name);
    for (const e of entries) {
      assert.equal(e.ownership, 'generated');
      assert.ok('text' in e && e.writer === 'expected');
      assert.deepEqual(entryDiagnostics(rom, model, e), [], `${name}: ${e.path}`);
      for (const line of e.text.split('\n')) assert.ok(ALLOWED.some((p) => p.test(line)), `${name}: ${e.path}: ${JSON.stringify(line)}`);
    }
  }
});

test('a module that is not generated has no file; a flipped byte fails the text-layout check at its line', () => {
  const { rom, model } = fixtureModel('c-data');
  const main = model.modules.findIndex((m) => m.name === 'main');
  const retained: Model = { ...model, modules: model.modules.map((m, i) => (i === main ? { ...m, generated: false } : m)) };
  assert.deepEqual([...expectedWriter.emit(rom, retained, CX, main)], []);
  const [entry] = [...expectedWriter.emit(rom, model, CX, main)];
  assert.ok(entry !== undefined && 'text' in entry);
  const flipped = { ...entry, text: entry.text.replace('.inst.n 0x4770', '.inst.n 0x4771') };
  const found = entryDiagnostics(rom, model, flipped);
  assert.equal(found[0]?.code, 'E_SELF_CHECK_TEXT');
  assert.equal(found[0]?.path, 'expected/main.s');
  assert.match(found[0]?.message ?? '', /^expected\/main\.s line \d+: the file lays out 0x71 where the ROM holds 0x70/);
});

test('the ARM function after a Thumb one at 2 mod 4: its pad first, then `.arm` and its label', () => {
  const { rom, model } = fixtureModel('composite');
  const module = model.modules.find((m) => m.name === 'asm_0800028C');
  assert.ok(module !== undefined, 'the composite fixture as this test knows it');
  const text = expectedText(rom, model, module);
  assert.match(text, /\t\.inst\.n 0x4770\n\t\.size sub_080002A2, \.-sub_080002A2\n\n\t\.byte 0x00, 0x00\n\t\.arm\n\t\.global sub_080002A8\n\t\.type sub_080002A8, %function\nsub_080002A8:\n\t\.inst 0xE59F0008\n/);
  assert.ok(text.startsWith(`${DIALECT.preamble('thumb')}@ expected/asm_0800028C.s: module asm_0800028C (0x0800028C..0x080002BC)`));
});

for (const name of ['composite', 'c-data']) {
  test(`${name}: every object equals its module's ROM range with no relocation, its functions global and sized`, { skip }, async () => {
    if ('code' in tools) return;
    const { rom, model } = fixtureModel(name);
    const dir = await mkdtemp(join(tmpdir(), 'romlift-expected-'));
    roots.push(dir);
    await mkdir(join(dir, 'include'), { recursive: true });
    await mkdir(join(dir, 'expected'), { recursive: true });
    await writeFile(join(dir, 'include', 'macros.inc'), DIALECT.macrosInc);
    await writeFile(join(dir, 'baserom.gba'), rom.bytes);
    for (const entry of entriesOf(rom, model)) {
      if (!('text' in entry)) continue;
      const module = model.modules.find((m) => entry.path === `expected/${m.name}.s`);
      assert.ok(module !== undefined);
      await writeFile(join(dir, entry.path), entry.text);
      const object = entry.path.replace(/\.s$/, '.o');
      const ran = await runTool(tools.as, [...DIALECT.asArgs, '-I', '.', '-o', object, entry.path], dir);
      assert.equal(ran.code, 0, ran.stderr);
      const bytes = new Uint8Array(await readFile(join(dir, object)));
      const elf = parseElf(bytes);
      assert.ok(elf.ok);
      const textSection = elf.value.sections.find((s) => s.name === '.text');
      assert.ok(textSection !== undefined);
      assert.deepEqual([...bytes.subarray(textSection.offset, textSection.offset + textSection.size)], [...rom.bytes.subarray(module.span.start - rom.base, module.span.end - rom.base)], `${name}: ${entry.path}`);
      const relocations = relocationsOf(bytes, elf.value, textSection);
      assert.ok(relocations.ok && relocations.value.length === 0, `${name}: ${entry.path} has relocations`);
      for (let c = module.chunks.first; c < module.chunks.first + module.chunks.count; c++) {
        const chunk = model.chunks[c];
        if (chunk === undefined || (chunk.kind !== 'function' && chunk.kind !== 'startup')) continue;
        const defined: ElfSymbol | undefined = elf.value.symbols.find((s) => s.name === chunk.name);
        const entryAddr = chunk.entry ?? chunk.span.start;
        assert.deepEqual([defined?.type, defined?.bind, defined?.addr, defined?.size, defined?.thumb], ['func', 'global', entryAddr - module.span.start, chunk.span.end - entryAddr, chunk.mode === 'thumb'], `${name}: ${chunk.name}`);
      }
    }
  });
}
