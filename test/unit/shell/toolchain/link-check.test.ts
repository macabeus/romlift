// linkCheck and assembleCheck (architecture §2.1, §6.4) on a tiny hand-written tree: two modules, a
// cross-module `bl`, and a pool word naming a Thumb function, which must link to a hand-built image's
// SHA-1, and assemble module by module to the image's ranges outside the relocated fields. Tests that run
// binutils skip as unavailable only when the toolchain is not installed (CI installs it).
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { DIALECT } from '../../../../src/foundation/asm/dialect.ts';
import { romFromBytes } from '../../../../src/foundation/rom/rom.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import type { AssembleUnit } from '../../../../src/shell/toolchain/link-check.ts';
import { assembleCheck, BASEROM_PATH, linkCheck, MACROS_INC_PATH } from '../../../../src/shell/toolchain/link-check.ts';
import { findBinutils } from '../../../../src/shell/toolchain/binutils.ts';
import { sha1Of } from '../../../../src/shell/hash.ts';

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
  assert.equal(await readFile(join(dir, MACROS_INC_PATH), 'utf8'), DIALECT.macrosInc);
  assert.deepEqual(new Uint8Array(await readFile(join(dir, BASEROM_PATH))), IMAGE);
});

test('files already present are not overwritten', { skip }, async () => {
  const dir = await treeDir({ [MACROS_INC_PATH]: `${DIALECT.macrosInc}@ user line\n`, [BASEROM_PATH]: 'not the rom' });
  const result = await linkCheck({ dir, rom: romOf(IMAGE), units: UNITS });
  assert.equal(result.ok, true, result.detail);
  assert.equal(await readFile(join(dir, MACROS_INC_PATH), 'utf8'), `${DIALECT.macrosInc}@ user line\n`);
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
