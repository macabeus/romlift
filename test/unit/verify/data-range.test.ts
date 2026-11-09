// C data ranges through the model, the writers, the self-checks and the toolchain checks (architecture §6.4, §6.6,
// phase 6, D92), on the c-data fixture: its main module's table, sPrices (16 bytes at 0x0800014C, the ROM's last
// bytes), as main's data range in three layouts:
//   - `at`: data_start at the data module's start, which is dropped; the range follows main's text;
//   - `inside`: data_start 8 bytes into the data module, which is clipped there; the range ends the ROM;
//   - `between`: data_start 4 bytes into the data module, which is clipped, and a data module `tail` 4 bytes before the
//     ROM end, which ends the range and follows it.
// Each model passes the model self-checks (tiling counts the range as main's), its stream the text-layout and paths
// checks (the ldscript's data-range lines included, every label of the range resolved as the C object defines it), and,
// with binutils, every unit assembles to its ROM range (main's `.rodata` to its range) and the tree links to the
// fixture's SHA-1, the stub's assembly standing in for main's C with the range's ROM bytes as its `.rodata`. Mutations of
// the ldscript's data-range lines and of the range's chunks fail the checks. Toolchain tests skip as unavailable only
// without binutils.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { emitTree } from '../../../src/core/emit/emit-tree.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { ldscriptText } from '../../../src/core/emit/writers/ldscript.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import { assembleUnits, buildUnits } from '../../../src/core/model/paths.ts';
import type { AssembleUnit } from '../../../src/core/model/paths.ts';
import type { Model } from '../../../src/core/model/types.ts';
import { profileById } from '../../../src/core/profile/registry.ts';
import { checkLdscript } from '../../../src/core/verify/link-scripts.ts';
import { checkEntries } from '../../../src/core/verify/text-layout.ts';
import { checkTiling, verifyModel } from '../../../src/core/verify/tiling.ts';
import { compareObject } from '../../../src/core/verify/toolchain.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { findBinutils } from '../../../src/shell/toolchain/binutils.ts';
import { assembleCheck, linkCheck } from '../../../src/shell/toolchain/link-check.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const tools = findBinutils(process.env);
const skip = 'code' in tools ? 'unavailable: toolchain' : false;
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const fixture = listSyntheticFixtures().find((f) => f.name === 'c-data');
if (fixture === undefined) throw new Error('no c-data fixture');
const rom: Rom = readFixtureRom(fixture);
const profile = profileById('agbcc');
if (profile === undefined) throw new Error('the agbcc profile is not registered');
const analysis = discover(rom, { profile });
const base = configFromDiscover(rom, analysis);
const TABLE = 0x0800_014c;

/** The discover config with main's data_start and, optionally, a data module `tail` at `tail`. */
function withRange(dataStart: number, tail?: number): RomliftConfig {
  const modules = base.modules.map((m) => (m.name === 'main' ? { ...m, dataStart } : m));
  return { ...base, modules: tail === undefined ? modules : [...modules, { name: 'tail', start: tail, kind: 'data', generated: true }] };
}

const LAYOUTS = {
  at: buildModel(rom, analysis, withRange(TABLE)),
  inside: buildModel(rom, analysis, withRange(TABLE + 8)),
  between: buildModel(rom, analysis, withRange(TABLE + 4, TABLE + 0xc)),
} as const;

function spans(model: Model): readonly (readonly (string | number)[])[] {
  return model.modules.map((m) => [m.name, m.span.start, m.span.end, ...(m.dataRange === undefined ? [] : [m.dataRange.start, m.dataRange.end])]);
}

function failures(report: { readonly checks: readonly { readonly id: string; readonly ok: boolean; readonly detail: string }[] }): string {
  return report.checks
    .filter((c) => !c.ok)
    .map((c) => `${c.id}: ${c.detail}`)
    .join('; ');
}

async function writeTree(entries: readonly FileEntry[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-data-range-'));
  roots.push(dir);
  for (const e of entries) {
    if (!('text' in e)) throw new Error(`${e.path}: a reconciled entry`);
    await mkdir(dirname(join(dir, e.path)), { recursive: true });
    await writeFile(join(dir, e.path), e.text);
  }
  return dir;
}

test('the three layouts: the data module dropped, clipped, or clipped with a module after the range', () => {
  assert.equal(base.modules.find((m) => m.name === 'data')?.start, TABLE, 'the fixture as this test knows it');
  // A range nothing ends runs to the ROM end, and says so (D112); the range a module after it ends does not.
  assert.deepEqual(LAYOUTS.at.diagnostics.map((d) => d.code), ['W_DATA_RANGE_TO_ROM_END']);
  assert.deepEqual(LAYOUTS.inside.diagnostics.map((d) => d.code), ['W_DATA_RANGE_TO_ROM_END']);
  assert.deepEqual(LAYOUTS.between.diagnostics, []);
  const mainStart = LAYOUTS.at.modules.find((m) => m.name === 'main')?.span.start ?? 0;
  assert.deepEqual(spans(LAYOUTS.at).slice(2), [['main', mainStart, TABLE, TABLE, rom.end]]);
  assert.deepEqual(spans(LAYOUTS.inside).slice(2), [
    ['main', mainStart, TABLE, TABLE + 8, rom.end],
    ['data', TABLE, TABLE + 8],
  ]);
  assert.deepEqual(spans(LAYOUTS.between).slice(2), [
    ['main', mainStart, TABLE, TABLE + 4, TABLE + 0xc],
    ['data', TABLE, TABLE + 4],
    ['tail', TABLE + 0xc, rom.end],
  ]);
  // The range's chunks: data chunks naming main, in ROM order, outside main's chunk range.
  const range = LAYOUTS.between.chunks.filter((c) => c.span.start >= TABLE + 4 && c.span.end <= TABLE + 0xc);
  assert.deepEqual(range.map((c) => [c.kind, c.module, c.span.start, c.span.end]), [['data', 'main', TABLE + 4, TABLE + 0xc]]);
  const main = LAYOUTS.between.modules.find((m) => m.name === 'main');
  assert.ok(main !== undefined && LAYOUTS.between.chunks.slice(main.chunks.first, main.chunks.first + main.chunks.count).every((c) => c.span.end <= TABLE));
  // The pool word naming the table names a global data label, which the C object defines.
  const label = LAYOUTS.at.labels.find((l) => l.addr === TABLE);
  assert.deepEqual([label?.name, label?.kind, label?.scope], ['gUnk_0800014C', 'data', 'global']);
});

test('each layout passes the model self-checks and its stream the text-layout and paths checks', () => {
  for (const [name, model] of Object.entries(LAYOUTS)) {
    const report = verifyModel(rom, model);
    assert.ok(report.ok, `${name}: ${failures(report)}`);
    const entries = [...emitTree(rom, model, { decomp: { defined: [] } })];
    const layout = checkEntries(rom, model, entries);
    assert.ok(layout.ok, `${name}: ${failures(layout)}`);
    assert.ok(!entries.some((e) => e.path === 'data/data.s') || name !== 'at', 'a dropped data module writes no file');
    for (const e of entries) if ('text' in e && e.path !== 'ldscript.txt') assert.ok(!e.text.includes('0x14C, 0x10'), `${e.path} emits no byte of the range`);
  }
});

test('the ldscript places main\'s .rodata at its range, in ROM order, with its ASSERT; main\'s check section keeps only RAM data', () => {
  const text = ldscriptText(LAYOUTS.between);
  // From the line after `SECTIONS {`: an INCLUDE of symbols.ld comes first when the code names RAM (D111).
  const lines = text.split('\n');
  assert.equal(
    lines.slice(lines.indexOf('SECTIONS {') + 1).join('\n'),
    `    . = 0x08000000;
    .text : {
        build/rom_header.o(.text);
        build/crt0.o(.text);
        build/src/main.o(.text);
        build/data.o(.text);
    }
    .rodata_main 0x08000150 : AT(0x08000150) { build/src/main.o(.rodata .rodata.*) }
    ASSERT(SIZEOF(.rodata_main) == 8, "src/main.c's read-only data is not the 8 bytes of its data range [0x08000150, 0x08000158); if the range ends in the zero padding before an aligned object, extend it over that object, as the original file did; see AGENTS.md")
    .text.tail 0x08000158 : AT(0x08000158) {
        build/tail.o(.text);
    }
    .c_data_main (NOLOAD) : { *src/main.o(.data* .bss* COMMON) }
    ASSERT(SIZEOF(.c_data_main) == 0, "src/main.c defines data; see AGENTS.md (only read-only data is placed, in a data range: data_start)")
}
`,
  );
  assert.deepEqual(checkLdscript(LAYOUTS.between, 'ldscript.txt', text), []);
  assert.match(ldscriptText(LAYOUTS.at), /\.rodata_main 0x0800014C : AT\(0x0800014C\) \{ build\/src\/main\.o\(\.rodata \.rodata\.\*\) \}\n {4}ASSERT\(SIZEOF\(\.rodata_main\) == 16, /);
});

test('mutations of the data-range lines are E_SELF_CHECK_TEXT at their line', () => {
  const model = LAYOUTS.between;
  const text = ldscriptText(model);
  const messages = (t: string): string[] => checkLdscript(model, 'ldscript.txt', t).map((d) => d.message);
  const fails = (t: string, pattern: RegExp): void => {
    const found = messages(t);
    assert.ok(found.some((m) => pattern.test(m)), `${pattern}:\n${found.join('\n')}`);
  };
  const rodata = '    .rodata_main 0x08000150 : AT(0x08000150) { build/src/main.o(.rodata .rodata.*) }\n';
  const assertLine = text.split('\n').find((l) => l.includes('SIZEOF(.rodata_main)')) ?? '';
  fails(text.replace(rodata, ''), /lacks `\.rodata_main 0x08000150 : AT\(0x08000150\)/);
  fails(text.replace(`${assertLine}\n`, ''), /does not follow `\.rodata_main .*` with `ASSERT\(SIZEOF\(\.rodata_main\) == 8,/);
  fails(text.replace('== 8,', '== 4,'), /does not follow/);
  fails(text.replace('0x08000150 : AT(0x08000150)', '0x08000154 : AT(0x08000154)'), /holds `\.rodata_main 0x08000154.*` where the data range of C unit main needs/);
  // The range moved before main's text: after 2 units, where ROM order puts it after 4.
  const early = text.replace(rodata + assertLine + '\n', '').replace('    .text : {\n', `${rodata}${assertLine}\n    .text : {\n`);
  fails(early, /places the data range of C unit main after 0 units, where ROM order puts it after 4/);
  // The unit after the range in a section without its load address.
  const unplaced = text.replace('    .text.tail 0x08000158 : AT(0x08000158) {\n', '    .text.tail : {\n');
  fails(unplaced, /build\/tail\.o follows a data range and must open its own section at 0x08000158 : AT\(0x08000158\)/);
  // The phase-4 check section of a module with a range.
  fails(text.replace('(.data* .bss* COMMON)', '(.rodata* .data* .bss* COMMON)'), /where C unit main needs `\.c_data_main \(NOLOAD\) : \{ \*src\/main\.o\(\.data\* \.bss\* COMMON\) \}`/);
});

test('tiling: a data range spanned by a chunk of another module, or by no chunk, fails at the range', () => {
  const model = LAYOUTS.at;
  const i = model.chunks.findIndex((c) => c.span.start === TABLE);
  const renamed: Model = { ...model, chunks: model.chunks.map((c, k) => (k === i ? { ...c, module: 'data' } : c)) };
  assert.match(checkTiling(rom, renamed).detail, /chunk gUnk_0800014C lies in module main's data range \(0x0800014C\.\.0x0800015C\) but is a data chunk of module data/);
  const dropped: Model = { ...model, chunks: model.chunks.filter((_, k) => k !== i) };
  assert.equal(checkTiling(rom, dropped).ok, false);
  const moved: Model = { ...model, modules: model.modules.map((m) => (m.name === 'main' && m.dataRange !== undefined ? { ...m, dataRange: { start: TABLE + 4, end: rom.end } } : m)) };
  assert.equal(checkTiling(rom, moved).ok, false, 'a range that leaves a gap after the text');
});

for (const [name, model] of Object.entries(LAYOUTS)) {
  test(`${name}: every unit assembles to its ROM range, main's .rodata to its data range, and the tree links to the SHA-1`, { skip }, async () => {
    if ('code' in tools) return;
    const entries = [...emitTree(rom, model, { decomp: { defined: [] } })];
    const dir = await writeTree(entries);
    const assembled = await assembleCheck({ dir, rom, units: assembleUnits(model), tools });
    assert.ok(assembled.ok, assembled.detail);
    assert.match(assembled.modules.find((m) => m.module === 'main')?.detail ?? '', /and its data range 0x0800/);
    const linked = await linkCheck({ dir, rom, units: buildUnits(model), tools });
    assert.ok(linked.ok, linked.detail);
    assert.equal(linked.sha1, rom.sha1);
    if (name !== 'at') return;
    // The verdict reads the object's .rodata against the range the unit names: 4 bytes later it differs; 4 bytes
    // shorter, its size does.
    const object = new Uint8Array(await readFile(join(dir, 'build', 'src', 'main.o')));
    const unit = assembleUnits(model).find((u) => u.module === 'main');
    const data = unit?.data;
    assert.ok(unit !== undefined && data !== undefined);
    const at = (start: number, end: number): AssembleUnit => ({ ...unit, data: { ...data, span: { start, end } } });
    assert.match(compareObject(object, at(TABLE - 4, rom.end - 4), rom).detail, /^first difference at 0x0800014/);
    assert.equal(compareObject(object, at(TABLE, rom.end - 4), rom).detail, 'build/src/main.o has 0x10 bytes of .rodata, its data range spans 0xC');
    assert.equal(compareObject(object, at(TABLE, rom.end), rom).ok, true);
  });
}
