// Fault injection into the structural part of the text-layout check (link-scripts.ts) and its unit-level
// alignment check (text-layout.ts unitAlignment), the branches architecture-r1-11 found uncovered: a line the
// ldscript writer never prints inside a section and outside one, a unit put into another unit's runs_at section,
// and a unit whose file asks a section alignment its start is not a multiple of. Each fails with
// E_SELF_CHECK_TEXT naming the file and the line.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WRITERS } from '../../../src/core/emit/writers/index.ts';
import { ldscriptText } from '../../../src/core/emit/writers/ldscript.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { checkLdscript } from '../../../src/core/verify/link-scripts.ts';
import { checkEntries } from '../../../src/core/verify/text-layout.ts';
import { dataItem, modelOf, romWith } from '../../helpers/model.ts';
import { fixtureEntries, fixtureModel, fixtureRom } from '../../unit/verify/fixture.ts';

const CX = { decomp: { defined: [] } };

function messages(found: readonly { readonly code: string; readonly message: string }[]): string[] {
  return found.map((d) => `${d.code} ${d.message}`);
}

test('a line the writer never prints, inside a section or outside one, is E_SELF_CHECK_TEXT at its line', () => {
  const rom = fixtureRom();
  const model = fixtureModel(rom);
  const text = ldscriptText(model);
  assert.deepEqual(checkLdscript(model, 'ldscript.txt', text), []);
  const inside = text.replace('        build/crt0.o(.text);\n', '        build/crt0.o(.text);\n        KEEP(*(.init));\n');
  const lineOf = (t: string, needle: string): number => t.split('\n').findIndex((l) => l.includes(needle)) + 1;
  assert.deepEqual(messages(checkLdscript(model, 'ldscript.txt', inside)), [`E_SELF_CHECK_TEXT ldscript.txt line ${lineOf(inside, 'KEEP')}: unexpected \`KEEP(*(.init));\` inside section .text (at 0x08000000)`]);
  const outside = text.replace('    . = 0x08000000;\n', '    . = 0x08000000;\n    PROVIDE(end = .);\n');
  assert.deepEqual(messages(checkLdscript(model, 'ldscript.txt', outside)), [`E_SELF_CHECK_TEXT ldscript.txt line ${lineOf(outside, 'PROVIDE')}: unexpected \`PROVIDE(end = .);\` (at 0x08000000)`]);
});

test("a unit put into another unit's runs_at section is E_SELF_CHECK_TEXT", () => {
  const rom = romWith([], { size: 0x400 });
  const model = modelOf(rom, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
      { name: 'main', chunks: [{ name: 'Func', items: [dataItem(0x0800_00c0, 0x40)] }] },
      { name: 'sound_ram', runAt: 0x0300_0388, chunks: [{ name: 'SoundMain', runAt: 0x0300_0388, items: [dataItem(0x0800_0100, 0x80)] }] },
      { name: 'main_2', chunks: [{ name: 'Other', items: [dataItem(0x0800_0180, 0x80)] }] },
      { name: 'data', kind: 'data', chunks: [{ kind: 'data', name: 'data', items: [dataItem(0x0800_0200, 0x200)] }] },
    ],
  });
  const text = ldscriptText(model);
  assert.deepEqual(checkLdscript(model, 'ldscript.txt', text), []);
  const shared = text
    .replace('        build/sound_ram.o(.text);\n', '        build/sound_ram.o(.text);\n        build/main_2.o(.text);\n')
    .replace('    .text.main_2 0x08000180 : AT(0x08000180) {\n        build/main_2.o(.text);\n', '    .text.main_2 0x08000180 : AT(0x08000180) {\n');
  const found = messages(checkLdscript(model, 'ldscript.txt', shared));
  assert.ok(found.includes('E_SELF_CHECK_TEXT ldscript.txt line 10: build/main_2.o shares a runs_at section with another unit (at 0x08000180)'), found.join('\n'));
});

test("a unit whose file asks a section alignment its start is not a multiple of fails: ld would place it past the module's start", () => {
  const rom = fixtureRom();
  const model = fixtureModel(rom);
  const written = WRITERS.filter((w) => w.id === 'data' || w.id === 'ldscript' || w.id === 'symbols').flatMap((w) =>
    w.scope === 'global' ? [...w.emit(rom, model, CX, null)] : model.modules.flatMap((_, i) => [...w.emit(rom, model, CX, i)]),
  );
  const stream = (): FileEntry[] => [...fixtureEntries(), ...written];
  assert.equal(checkEntries(rom, model, stream()).ok, true);
  // crt0 spans 0x080000C0..0x08000100. `.align 7` at its end emits no byte (0x100 is a multiple of 128) but makes
  // the object's section 128-aligned, and 0xC0 is not a multiple of 128.
  const entries = stream().map((e) =>
    e.path === 'asm/crt0.s' && e.ownership === 'generated' ? { ...e, text: e.text.replace('\tarm_func_end start\n', '\t.align 7, 0\n\tarm_func_end start\n') } : e,
  );
  const report = checkEntries(rom, model, entries);
  assert.equal(report.ok, false);
  const layout = report.checks.find((c) => c.id === 'text-layout');
  assert.deepEqual(
    layout?.diagnostics.map((d) => [d.code, d.path, d.addr, d.message]),
    [['E_SELF_CHECK_TEXT', 'asm/crt0.s', 0x0800_00c0, "asm/crt0.s line 1: the object's section is aligned to 128 bytes, so ld places it past 0x080000C0, the module's start (at 0x080000C0)"]],
  );
});
