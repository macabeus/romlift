// The `expected` writer (architecture §6.3, §6.8, roadmap 6.F, D92, D95 a): two files per generated module with chunks.
// expected/<module>.s is the module as its build unit assembles it (a `c` module's chunk files included in ROM order,
// at the paths the tree writes them, an asm or data module's own source included), so its object has the build
// object's symbols and relocations; expected/rom/<module>.s is the module's ROM range, which `make expected` writes over
// the first object's `.text`. The text-layout check lays both out to the ROM range; a misordered include or a wrong
// range fails it. With binutils, each symbolic object of two fixtures has a `.text` exactly as long as its ROM range
// (so `make expected` can write the ROM's bytes over it), and each ROM object equals its range.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { emitTree } from '../../../../src/core/emit/emit-tree.ts';
import type { EmitContext, FileEntry } from '../../../../src/core/emit/tree.ts';
import { expectedRomText, expectedText, expectedWriter } from '../../../../src/core/emit/writers/expected.ts';
import { buildModel } from '../../../../src/core/model/model.ts';
import type { Model } from '../../../../src/core/model/types.ts';
import { profileById } from '../../../../src/core/profile/registry.ts';
import { configFromDiscover } from '../../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../../src/core/workflow/discover.ts';
import { DIALECT } from '../../../../src/foundation/asm/dialect.ts';
import { parseElf } from '../../../../src/foundation/formats/elf.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import { findBinutils, runTool } from '../../../../src/shell/toolchain/binutils.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../../helpers/fixtures.ts';
import { entryDiagnostics } from '../../../helpers/text-layout.ts';

const CX: EmitContext = { decomp: { defined: [] } };
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

function entriesOf(rom: Rom, model: Model, cx: EmitContext = CX): FileEntry[] {
  return model.modules.flatMap((_, i) => [...expectedWriter.emit(rom, model, cx, i)]);
}

function textOf(entry: FileEntry | undefined): string {
  assert.ok(entry !== undefined && 'text' in entry);
  return entry.text;
}

test('two generated files per module with chunks, laid out by the text-layout check to its ROM range', () => {
  for (const name of ['composite', 'c-data', 'code-copied-to-ram']) {
    const { rom, model } = fixtureModel(name);
    const entries = entriesOf(rom, model);
    assert.deepEqual(
      entries.map((e) => e.path),
      model.modules.flatMap((m) => [`expected/${m.name}.s`, `expected/rom/${m.name}.s`]),
      name,
    );
    for (const e of entries) {
      assert.equal(e.ownership, 'generated');
      assert.ok('text' in e && e.writer === 'expected');
      assert.deepEqual(entryDiagnostics(rom, model, e), [], `${name}: ${e.path}`);
    }
  }
});

test("a c module's target includes its chunk files in ROM order, a decompiled function's at its asm/matchings twin", () => {
  const { rom, model } = fixtureModel('c-data');
  const main = model.modules.find((m) => m.name === 'main');
  assert.ok(main !== undefined && main.kind === 'c', 'the c-data fixture as this test knows it');
  const text = expectedText(model, CX, main);
  const includes = text.split('\n').filter((l) => l.startsWith('.include "asm/'));
  assert.ok(includes.length > 0);
  assert.ok(text.startsWith(DIALECT.preamble('thumb')));
  assert.ok(includes.every((l) => l.startsWith('.include "asm/nonmatchings/main/')));
  const first = model.chunks[main.chunks.first];
  assert.ok(first !== undefined && first.kind === 'function');
  const decompiled: EmitContext = { decomp: { defined: [first.name] } };
  const [entry] = entriesOf(rom, model, decompiled).filter((e) => e.path === 'expected/main.s');
  assert.match(textOf(entry), new RegExp(`\\.include "asm/matchings/main/${first.name}\\.s"`));
  assert.ok(entry !== undefined);
  assert.deepEqual(entryDiagnostics(rom, model, entry), []);
});

test("an asm or data module's target includes its own source; the ROM file is one .incbin of the module's range", () => {
  const { model } = fixtureModel('c-data');
  const data = model.modules.find((m) => m.kind === 'data');
  assert.ok(data !== undefined);
  assert.match(expectedText(model, CX, data), /\n\.include "data\/data\.s"\n$/);
  const span = data.span;
  assert.match(expectedRomText(data), new RegExp(`\\n\\t\\.incbin "baserom\\.gba", 0x${(span.start - 0x0800_0000).toString(16).toUpperCase()}, 0x${(span.end - span.start).toString(16).toUpperCase()}\\n$`));
});

test('a module that is not generated has no file; a misordered include and a wrong range fail the text-layout check', () => {
  const { rom, model } = fixtureModel('c-data');
  const main = model.modules.findIndex((m) => m.name === 'main');
  const retained: Model = { ...model, modules: model.modules.map((m, i) => (i === main ? { ...m, generated: false } : m)) };
  assert.deepEqual([...expectedWriter.emit(rom, retained, CX, main)], []);
  const [target, romFile] = [...expectedWriter.emit(rom, model, CX, main)];
  assert.ok(target !== undefined && 'text' in target && romFile !== undefined && 'text' in romFile);
  const lines = target.text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('.include "asm/'));
  const next = lines[at + 1];
  assert.ok(next?.startsWith('.include "asm/') === true, 'the c-data fixture has two chunk files in main');
  const swapped = [...lines.slice(0, at), next, lines[at] ?? '', ...lines.slice(at + 2)];
  const misordered = entryDiagnostics(rom, model, { ...target, text: swapped.join('\n') });
  assert.equal(misordered[0]?.code, 'E_SELF_CHECK_TEXT');
  assert.match(misordered[0]?.message ?? '', /where the module's chunk file in ROM order is/);
  const shorter = romFile.text.replace(/, 0x([0-9A-F]+)\n$/, (_, n: string) => `, 0x${(Number.parseInt(n, 16) - 2).toString(16).toUpperCase()}\n`);
  const found = entryDiagnostics(rom, model, { ...romFile, text: shorter });
  assert.equal(found[0]?.code, 'E_SELF_CHECK_TEXT');
  assert.match(found[0]?.message ?? '', /the file lays out \d+ bytes, but its range/);
});

for (const name of ['composite', 'c-data']) {
  test(`${name}: each target's .text is as long as its ROM range, and each ROM object equals that range`, { skip }, async () => {
    if ('code' in tools) return;
    const { rom, model } = fixtureModel(name);
    const dir = await mkdtemp(join(tmpdir(), 'romlift-expected-'));
    roots.push(dir);
    await mkdir(join(dir, 'include'), { recursive: true });
    await writeFile(join(dir, 'include', 'macros.inc'), DIALECT.macrosInc);
    await writeFile(join(dir, 'baserom.gba'), rom.bytes);
    for (const entry of emitTree(rom, model, CX)) {
      if (!('text' in entry) || entry.path.endsWith('.c')) continue;
      await mkdir(join(dir, dirname(entry.path)), { recursive: true });
      await writeFile(join(dir, entry.path), entry.text);
    }
    const textOfObject = async (object: string): Promise<Uint8Array> => {
      const bytes = new Uint8Array(await readFile(join(dir, object)));
      const elf = parseElf(bytes);
      assert.ok(elf.ok);
      const section = elf.value.sections.find((s) => s.name === '.text');
      assert.ok(section !== undefined, `${object} has a .text`);
      return bytes.subarray(section.offset, section.offset + section.size);
    };
    for (const module of model.modules) {
      for (const source of [`expected/${module.name}.s`, `expected/rom/${module.name}.s`]) {
        const ran = await runTool(tools.as, [...DIALECT.asArgs, '-I', '.', '-o', source.replace(/\.s$/, '.o'), source], dir);
        assert.equal(ran.code, 0, `${name}: ${source}: ${ran.stderr}`);
      }
      const range = rom.bytes.subarray(module.span.start - rom.base, module.span.end - rom.base);
      assert.equal((await textOfObject(`expected/${module.name}.o`)).length, range.length, `${name}: ${module.name}`);
      assert.deepEqual([...(await textOfObject(`expected/rom/${module.name}.o`))], [...range], `${name}: ${module.name}`);
    }
  });
}
