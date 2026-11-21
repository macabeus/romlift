// The `expected` writer (architecture §6.3, §6.8, roadmap 6.F, D92, D101 a): one file per generated module with chunks,
// expected/<module>.s, the module as its build unit assembles it (a `c` module's chunk files included in ROM order, at
// the paths the tree writes them, an asm or data module's own source included), so its object, which `make expected`
// assembles as it is, has the build object's symbols, relocations and bytes. The text-layout check lays it out to the
// ROM range; a misordered include fails it. With binutils, each object of two fixtures has a `.text` exactly as long
// as its ROM range.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { emitTree } from '../../../../src/core/emit/emit-tree.ts';
import type { EmitContext, FileEntry } from '../../../../src/core/emit/tree.ts';
import { expectedText, expectedWriter } from '../../../../src/core/emit/writers/expected.ts';
import { stubAssemblyText } from '../../../../src/core/model/c-unit.ts';
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

test('one generated file per module with chunks, laid out by the text-layout check to its ROM range', () => {
  for (const name of ['composite', 'c-data', 'code-copied-to-ram']) {
    const { rom, model } = fixtureModel(name);
    const entries = entriesOf(rom, model);
    assert.deepEqual(
      entries.map((e) => e.path),
      model.modules.map((m) => `expected/${m.name}.s`),
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
  assert.ok(
    text.endsWith(
      stubAssemblyText(
        includes.map((l) => l.slice('.include "'.length, -1)),
        main.compiler,
      ),
    ),
    "agbcc's stub assembly, c-unit.ts stubAssemblyText (architecture-r1-3)",
  );
  assert.ok(includes.every((l) => l.startsWith('.include "asm/nonmatchings/main/')));
  const first = model.chunks[main.chunks.first];
  assert.ok(first !== undefined && first.kind === 'function');
  const decompiled: EmitContext = { decomp: { defined: [first.name] } };
  const [entry] = entriesOf(rom, model, decompiled).filter((e) => e.path === 'expected/main.s');
  assert.match(textOf(entry), new RegExp(`\\.include "asm/matchings/main/${first.name}\\.s"`));
  assert.ok(entry !== undefined);
  assert.deepEqual(entryDiagnostics(rom, model, entry), []);
});

test("an asm or data module's target includes its own source", () => {
  const { model } = fixtureModel('c-data');
  const data = model.modules.find((m) => m.kind === 'data');
  assert.ok(data !== undefined);
  assert.match(expectedText(model, CX, data), /\n\.include "data\/data\.s"\n$/);
});

test('a module that is not generated has no file; a misordered include fails the text-layout check', () => {
  const { rom, model } = fixtureModel('c-data');
  const main = model.modules.findIndex((m) => m.name === 'main');
  const retained: Model = {
    ...model,
    modules: model.modules.map((m, i) => (i === main ? { ...m, generated: false } : m)),
  };
  assert.deepEqual([...expectedWriter.emit(rom, retained, CX, main)], []);
  const [target, ...rest] = [...expectedWriter.emit(rom, model, CX, main)];
  assert.ok(target !== undefined && 'text' in target);
  assert.deepEqual(rest, [], 'one file per module');
  const lines = target.text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('.include "asm/'));
  const next = lines.findIndex((l, i) => i > at && l.startsWith('.include "asm/'));
  assert.ok(at >= 0 && next > at, 'the c-data fixture has two chunk files in main');
  const swapped = lines.map((l, i) => (i === at ? (lines[next] ?? '') : i === next ? (lines[at] ?? '') : l));
  const misordered = entryDiagnostics(rom, model, { ...target, text: swapped.join('\n') });
  assert.equal(misordered[0]?.code, 'E_SELF_CHECK_TEXT');
  assert.match(misordered[0]?.message ?? '', /where the module's chunk file in ROM order is/);
});

for (const name of ['composite', 'c-data']) {
  test(`${name}: each target assembles to a .text as long as its ROM range`, { skip }, async () => {
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
      const source = `expected/${module.name}.s`;
      const ran = await runTool(tools.as, [...DIALECT.asArgs, '-I', '.', '-o', `${module.name}.o`, source], dir);
      assert.equal(ran.code, 0, `${name}: ${source}: ${ran.stderr}`);
      assert.equal(
        (await textOfObject(`${module.name}.o`)).length,
        module.span.end - module.span.start,
        `${name}: ${module.name}`,
      );
    }
  });
}
