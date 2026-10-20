// linkCheck and assembleCheck (architecture §2.1, §6.4) on a tiny hand-written tree: two modules, a
// cross-module `bl`, and a pool word naming a Thumb function, which must link to a hand-built image's
// SHA-1, and assemble module by module to the image's ranges outside the relocated fields; the same tree with
// one module a C unit, built from its stub's agbcc assembly (D74 f), and the ldscript's C-data ASSERT. Tests that run
// binutils skip as unavailable only when the toolchain is not installed (CI installs it).
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { C_STUB_HEADER, DIALECT } from '../../../../src/foundation/asm/dialect.ts';
import { cDataAssertLine, cDataSectionLine, stubAssemblyText } from '../../../../src/core/model/c-unit.ts';
import { romFromBytes } from '../../../../src/foundation/rom/rom.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import type { AssembleUnit } from '../../../../src/core/model/paths.ts';
import { BASEROM_PATH, MACROS_PATH } from '../../../../src/core/model/paths.ts';
import { assembleCheck, linkCheck } from '../../../../src/shell/toolchain/link-check.ts';
import { findBinutils, runTool } from '../../../../src/shell/toolchain/binutils.ts';
import { sha1Of } from '../../../../src/shell/hash.ts';
import { stubBinutils } from './stub.ts';

const tools = findBinutils(process.env);
const skip = 'code' in tools ? 'unavailable: toolchain' : false;

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/**
 * The image, by hand: Start at 0x08000000 calls Helper (0x0800000C) with a bl (offset 8: F000 F804), loads
 * Helper's address from its pool (ldr r0, [pc, #0]: 4800) and jumps to it (bx r0: 4700); the pool word is
 * Helper | 1 (0x0800000D). Helper is movs r0, #1 (2001) and bx lr (4770).
 */
const IMAGE = Uint8Array.from([0x00, 0xf0, 0x04, 0xf8, 0x00, 0x48, 0x00, 0x47, 0x0d, 0x00, 0x00, 0x08, 0x01, 0x20, 0x70, 0x47]);

const MAIN = `${DIALECT.preamble('thumb')}
\tthumb_func_start Start
Start:
\tbl Helper
\tldr r0, .Lpool
\tbx r0
\t.align 2, 0
.Lpool:
\t.4byte Helper
\tthumb_func_end Start
`;

const HELPER = `${DIALECT.preamble('thumb')}
\tthumb_func_start Helper
Helper:
\tmovs r0, #1
\tbx lr
\tthumb_func_end Helper
`;

const LDSCRIPT = `SECTIONS {
    . = 0x08000000;
    .text : {
        build/main.o(.text);
        build/helper.o(.text);
    }
}
`;

const UNITS: readonly AssembleUnit[] = [
  { module: 'main', source: 'asm/main.s', object: 'build/main.o', span: { start: 0x0800_0000, end: 0x0800_000c } },
  { module: 'helper', source: 'asm/helper.s', object: 'build/helper.o', span: { start: 0x0800_000c, end: 0x0800_0010 } },
];

function romOf(bytes: Uint8Array): Rom {
  return romFromBytes(bytes, sha1Of(bytes));
}

async function treeDir(files: Readonly<Record<string, string>> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-link-'));
  roots.push(dir);
  const all = { 'asm/main.s': MAIN, 'asm/helper.s': HELPER, 'ldscript.txt': LDSCRIPT, ...files };
  for (const [path, text] of Object.entries(all)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return dir;
}

test('the tree links to the hand-built image, writing macros.inc and baserom.gba', { skip }, async () => {
  const dir = await treeDir();
  const rom = romOf(IMAGE);
  const result = await linkCheck({ dir, rom, units: UNITS });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.id, 'link');
  assert.equal(result.ok, true, result.detail);
  assert.equal(result.sha1, sha1Of(IMAGE));
  assert.equal(await readFile(join(dir, MACROS_PATH), 'utf8'), DIALECT.macrosInc);
  assert.deepEqual(new Uint8Array(await readFile(join(dir, BASEROM_PATH))), IMAGE);
});

test('files already present are not overwritten', { skip }, async () => {
  const dir = await treeDir({ [MACROS_PATH]: `${DIALECT.macrosInc}@ user line\n`, [BASEROM_PATH]: 'not the rom' });
  const result = await linkCheck({ dir, rom: romOf(IMAGE), units: UNITS });
  assert.equal(result.ok, true, result.detail);
  assert.equal(await readFile(join(dir, MACROS_PATH), 'utf8'), `${DIALECT.macrosInc}@ user line\n`);
  assert.equal(await readFile(join(dir, BASEROM_PATH), 'utf8'), 'not the rom');
});

test('a ROM that differs fails the link check with the linked SHA-1 and the first difference', { skip }, async () => {
  const dir = await treeDir();
  const other = Uint8Array.from(IMAGE);
  other[13] = 0x21; // movs r0, #1 -> movs r1, #1
  const result = await linkCheck({ dir, rom: romOf(other), units: UNITS });
  assert.equal(result.ok, false);
  assert.equal(result.sha1, sha1Of(IMAGE));
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.detail, /first difference at 0x0800000D/);
});

test('a source that does not assemble is E_TOOLCHAIN_FAILED', { skip }, async () => {
  const dir = await treeDir({ 'asm/helper.s': `${HELPER}\tnot_an_instruction r0\n` });
  const result = await linkCheck({ dir, rom: romOf(IMAGE), units: UNITS });
  assert.equal(result.ok, false);
  assert.equal(result.sha1, null);
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['E_TOOLCHAIN_FAILED']);
  assert.match(result.diagnostics[0]?.message ?? '', /asm\/helper\.s/);
});

test('a missing toolchain is E_TOOLCHAIN_MISSING', async () => {
  const dir = await treeDir();
  const saved = process.env['PATH'];
  process.env['PATH'] = dir;
  try {
    const link = await linkCheck({ dir, rom: romOf(IMAGE), units: UNITS });
    const assemble = await assembleCheck({ dir, rom: romOf(IMAGE), units: UNITS });
    assert.deepEqual(link.diagnostics.map((d) => d.code), ['E_TOOLCHAIN_MISSING']);
    assert.deepEqual(assemble.diagnostics.map((d) => d.code), ['E_TOOLCHAIN_MISSING']);
    assert.equal(link.ok || assemble.ok, false);
  } finally {
    process.env['PATH'] = saved;
  }
});

test('each module assembles to its ROM range outside the relocated fields', { skip }, async () => {
  const dir = await treeDir();
  const result = await assembleCheck({ dir, rom: romOf(IMAGE), units: UNITS });
  assert.equal(result.id, 'assemble');
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.modules.map((m) => [m.module, m.ok]), [['main', true], ['helper', true]]);
  // the bl pair and the pool word are left to the linker
  assert.match(result.detail, /\(8 relocated bytes left to the linker\)/);
});

test('assembleCheck names every module that differs, and where', { skip }, async () => {
  const dir = await treeDir();
  const other = Uint8Array.from(IMAGE);
  other[6] = 0x08; // bx r0 -> bx r1
  other[12] = 0x02; // movs r0, #1 -> movs r0, #2
  other[2] = 0xff; // inside the bl: relocated, so not compared
  const result = await assembleCheck({ dir, rom: romOf(other), units: UNITS });
  assert.equal(result.ok, false);
  assert.deepEqual(result.modules.map((m) => [m.module, m.ok, m.detail]), [
    ['main', false, 'first difference at 0x08000006'],
    ['helper', false, 'first difference at 0x0800000C'],
  ]);
  assert.match(result.detail, /2 of 2 modules differ/);
});

test('assembleCheck reports a module whose object is not its span length', { skip }, async () => {
  const dir = await treeDir();
  const units = UNITS.map((u) => (u.module === 'helper' ? { ...u, span: { start: 0x0800_000c, end: 0x0800_0012 } } : u));
  const result = await assembleCheck({ dir, rom: romOf(IMAGE), units });
  assert.equal(result.ok, false);
  assert.match(result.modules[1]?.detail ?? '', /0x4 bytes of \.text, the module spans 0x6/);
});

test('assembleCheck with a unit that does not assemble and one whose object cannot be read checks every unit (stub toolchain)', async () => {
  // as fails on asm/helper.s, and "assembles" asm/main.s without writing its object.
  const body = 'for a in "$@"; do last="$a"; done\ncase "$last" in *helper.s) echo "helper.s:1: Error: bad" >&2; exit 1;; esac\nexit 0';
  await stubBinutils({ as: body }, async (bin) => {
    const dir = await treeDir();
    const tools = { as: join(bin, 'arm-none-eabi-as'), ld: join(bin, 'arm-none-eabi-ld'), objcopy: join(bin, 'arm-none-eabi-objcopy') };
    const result = await assembleCheck({ dir, rom: romOf(IMAGE), units: UNITS, tools });
    assert.equal(result.ok, false);
    assert.deepEqual(result.modules.map((m) => [m.module, m.ok]), [['main', false], ['helper', false]]);
    assert.match(result.modules[0]?.detail ?? '', /cannot read build\/main\.o/);
    assert.equal(result.modules[1]?.detail, 'asm/helper.s does not assemble');
    assert.deepEqual(result.diagnostics.map((d) => d.code), ['E_IO_READ', 'E_TOOLCHAIN_FAILED']);
    assert.match(result.detail, /^2 of 2 modules differ/);
  });
});

test('a C unit that is not a stub-only unit is refused before as runs, naming its line (stub toolchain)', async () => {
  // A stub as that would fail loudly if it ran.
  await stubBinutils({ as: 'echo "as ran" >&2; exit 1' }, async (bin) => {
    const dir = await treeDir({ 'src/main.c': `${C_STUB_HEADER}int Start(void) { return 0; }\n` });
    const tools = { as: join(bin, 'arm-none-eabi-as'), ld: join(bin, 'arm-none-eabi-ld'), objcopy: join(bin, 'arm-none-eabi-objcopy') };
    const units = [{ ...(UNITS[0] as AssembleUnit), source: 'src/main.c', object: 'build/src/main.o' }];
    const assembled = await assembleCheck({ dir, rom: romOf(IMAGE), units, tools });
    assert.equal(assembled.ok, false);
    assert.deepEqual(assembled.diagnostics.map((d) => [d.code, d.path]), [['E_TOOLCHAIN_FAILED', 'src/main.c']]);
    assert.match(assembled.diagnostics[0]?.message ?? '', /^src\/main\.c line 3 defines the function Start;.*only a stub-only C unit assembles without a compiler$/);
    const linked = await linkCheck({ dir, rom: romOf(IMAGE), units, tools });
    assert.equal(linked.ok, false);
    assert.match(linked.diagnostics[0]?.message ?? '', /^src\/main\.c line 3 defines the function Start/);
    const missing = await assembleCheck({ dir, rom: romOf(IMAGE), units: [{ ...(UNITS[1] as AssembleUnit), source: 'src/helper.c', object: 'build/src/helper.o' }], tools });
    assert.deepEqual(missing.diagnostics.map((d) => d.code), ['E_IO_READ'], 'a C unit without its file');
  });
});

/** The tree with module helper as a C unit: its stub includes asm/nonmatchings/helper/Helper.s, its object is build/src/helper.o. */
async function cTree(stub: string): Promise<{ readonly dir: string; readonly units: readonly AssembleUnit[] }> {
  const ldscript = LDSCRIPT.replace('build/helper.o(.text);', 'build/src/helper.o(.text);').replace(
    '    }\n}',
    `    }\n    ${cDataSectionLine('helper')}\n    ${cDataAssertLine('helper')}\n}`,
  );
  const chunk = HELPER.slice(DIALECT.preamble('thumb').length);
  const dir = await treeDir({ 'ldscript.txt': ldscript, 'src/helper.c': stub, 'asm/nonmatchings/helper/Helper.s': chunk });
  const units = UNITS.map((u) => (u.module === 'helper' ? { ...u, source: 'src/helper.c', object: 'build/src/helper.o' } : u));
  return { dir, units };
}

test('a C unit links and assembles from its stub with binutils alone: build/src/<m>.s is the stub assembly agbcc emits', { skip }, async () => {
  const { dir, units } = await cTree(`${C_STUB_HEADER}INCLUDE_ASM("asm/nonmatchings/helper", Helper);\n`);
  const linked = await linkCheck({ dir, rom: romOf(IMAGE), units });
  assert.equal(linked.ok, true, linked.detail);
  assert.equal(linked.sha1, sha1Of(IMAGE));
  assert.equal(await readFile(join(dir, 'build/src/helper.s'), 'utf8'), stubAssemblyText(['asm/nonmatchings/helper/Helper.s']));
  const assembled = await assembleCheck({ dir, rom: romOf(IMAGE), units });
  assert.equal(assembled.ok, true, assembled.detail);
  assert.deepEqual(assembled.modules.map((m) => [m.module, m.ok]), [['main', true], ['helper', true]]);
});

test('a C object that defines data fails the link with the ldscript ASSERT message naming its C file', { skip }, async () => {
  // A stub-only unit cannot define data, an object compiled from C can: one with a .data word stands for it.
  const { dir } = await cTree(`${C_STUB_HEADER}INCLUDE_ASM("asm/nonmatchings/helper", Helper);\n`);
  await mkdir(join(dir, 'build/src'), { recursive: true });
  // Link by hand: main from its source, helper from an object that also defines .data.
  await writeFile(join(dir, 'with-data.s'), `${HELPER}\t.data\n\t.4byte 1\n`);
  const linkTools = 'code' in tools ? undefined : tools;
  assert.ok(linkTools !== undefined);
  await mkdir(join(dir, 'include'), { recursive: true });
  await writeFile(join(dir, MACROS_PATH), DIALECT.macrosInc);
  assert.equal((await runTool(linkTools.as, [...DIALECT.asArgs, '-I', dir, '-o', 'build/src/helper.o', 'with-data.s'], dir)).code, 0);
  assert.equal((await runTool(linkTools.as, [...DIALECT.asArgs, '-I', dir, '-o', 'build/main.o', 'asm/main.s'], dir)).code, 0);
  const ld = await runTool(linkTools.ld, ['-T', 'ldscript.txt', '-o', 'out.elf', 'build/main.o', 'build/src/helper.o'], dir);
  assert.notEqual(ld.code, 0);
  assert.match(ld.stderr, /src\/helper\.c defines data; see AGENTS\.md \(data ranges arrive in phase 5\)/);
});
