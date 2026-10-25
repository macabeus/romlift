import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { elfFunctions, implicitAddend, parseElf, R_ARM, R_ARM_BRANCHES, relocationsOf, SHT } from '../../../src/foundation/formats/elf.ts';
import type { ElfFile } from '../../../src/foundation/formats/types.ts';

const tinyElf = new Uint8Array(readFileSync(new URL('../../fixtures/formats/tiny.elf', import.meta.url)));

function parsed(bytes: Uint8Array): ElfFile {
  const result = parseElf(bytes);
  if (!result.ok) assert.fail(result.error);
  return result.value;
}

function symbol(elf: ElfFile, name: string) {
  const found = elf.symbols.find((s) => s.name === name);
  assert.ok(found, name);
  return found;
}

test('parseElf reads the machine, the entry and the named sections', () => {
  const elf = parsed(tinyElf);
  assert.equal(elf.machine, 40);
  assert.equal(elf.entry, 0x0800_0000);
  assert.deepEqual(
    elf.sections.map((s) => s.name),
    ['', '.text', '.rodata', '.data', '.symtab', '.strtab', '.shstrtab'],
  );
  const text = elf.sections[1];
  assert.ok(text);
  assert.equal(text.index, 1);
  assert.equal(text.type, 1);
  assert.equal(text.addr, 0x0800_0000);
  assert.equal(text.size, 0x20);
  assert.equal(text.flags, 0x6, 'SHF_ALLOC | SHF_EXECINSTR');
  const symtab = elf.sections[4];
  assert.equal(symtab?.type, 2);
  assert.equal(symtab?.entsize, 16);
  assert.equal(symtab?.link, 5);
});

test('parseElf lists defined symbols in table order, without the null symbol', () => {
  const elf = parsed(tinyElf);
  assert.equal(elf.symbols.length, 18);
  assert.deepEqual(
    elf.symbols.filter((s) => s.bind === 'global').map((s) => s.name),
    ['__data_load', 'thumb_two', 'tiny_counter', 'lib_helper', 'tiny_table', 'arm_entry', 'thumb_one'],
  );
  assert.ok(elf.symbols.every((s) => s.sectionIndex !== 0));
});

test('func symbols: Thumb flag from bit 0, addr with bit 0 cleared, value kept raw', () => {
  const elf = parsed(tinyElf);
  const arm = symbol(elf, 'arm_entry');
  assert.deepEqual([arm.type, arm.thumb, arm.value, arm.addr, arm.size], ['func', false, 0x0800_0000, 0x0800_0000, 8]);
  const one = symbol(elf, 'thumb_one');
  assert.deepEqual([one.type, one.thumb, one.value, one.addr, one.size], ['func', true, 0x0800_0009, 0x0800_0008, 6]);
  const two = symbol(elf, 'thumb_two');
  assert.deepEqual([two.thumb, two.value, two.addr], [true, 0x0800_000f, 0x0800_000e]);
  assert.equal(two.addr % 4, 2, 'a Thumb function at 2 mod 4');
  assert.equal(two.sectionName, '.text');
});

test('object, notype, section and file symbols keep their raw value', () => {
  const elf = parsed(tinyElf);
  const table = symbol(elf, 'tiny_table');
  assert.deepEqual([table.type, table.bind, table.addr, table.size, table.thumb], ['object', 'global', 0x0800_0020, 8, false]);
  assert.equal(table.sectionName, '.rodata');
  const counter = symbol(elf, 'tiny_counter');
  assert.deepEqual([counter.type, counter.addr, counter.sectionName], ['object', 0x0300_0000, '.data']);
  const local = symbol(elf, 'tiny_local');
  assert.deepEqual([local.type, local.bind, local.value, local.addr, local.thumb], ['notype', 'local', 0x0800_000a, 0x0800_000a, false]);
  const file = symbol(elf, 'tiny.o');
  assert.equal(file.type, 'file');
  assert.equal(file.sectionIndex, 0xfff1, 'SHN_ABS');
  assert.equal(file.sectionName, undefined);
  assert.equal(elf.symbols.filter((s) => s.type === 'section').length, 3);
  const mapping = elf.symbols.filter((s) => s.name === '$t').map((s) => s.value);
  assert.deepEqual(mapping, [0x0800_0008, 0x0800_0018]);
});

test('elfFunctions merges func symbols by address inside a span, in address order', () => {
  const elf = parsed(tinyElf);
  assert.deepEqual(elfFunctions(elf, { start: 0x0800_0000, end: 0x0a00_0000 }), [
    { addr: 0x0800_0000, size: 8, name: 'arm_entry', thumb: false },
    { addr: 0x0800_0008, size: 6, name: 'thumb_one', thumb: true },
    { addr: 0x0800_000e, size: 10, name: 'thumb_two', thumb: true },
    { addr: 0x0800_0018, size: 4, name: 'lib_helper', thumb: true },
  ]);
  assert.deepEqual(elfFunctions(elf, { start: 0x0800_0008, end: 0x0800_000e }).map((f) => f.name), ['thumb_one']);
  const duplicated: ElfFile = {
    ...elf,
    symbols: [...elf.symbols, { ...symbol(elf, 'thumb_one'), name: 'alias', size: 12 }],
  };
  const merged = elfFunctions(duplicated, { start: 0x0800_0008, end: 0x0800_0009 });
  assert.deepEqual(merged, [{ addr: 0x0800_0008, size: 12, name: 'thumb_one', thumb: true }]);
  // symbol-table order: each address where its first symbol appears; the merge is the same.
  const reversed: ElfFile = { ...elf, symbols: [...elf.symbols].reverse() };
  const span = { start: 0x0800_0000, end: 0x0a00_0000 };
  const firsts: number[] = [];
  for (const s of reversed.symbols) if (s.type === 'func' && s.addr >= span.start && s.addr < span.end && !firsts.includes(s.addr)) firsts.push(s.addr);
  assert.deepEqual(elfFunctions(reversed, span, 'symbol-table').map((f) => f.addr), firsts);
  assert.notDeepEqual(firsts, [...firsts].sort((x, y) => x - y), 'the fixture tells the two orders apart');
  assert.deepEqual([...elfFunctions(reversed, span, 'symbol-table')].sort((x, y) => x.addr - y.addr), [...elfFunctions(reversed, span)]);
});

test('every truncation of the fixture returns ok:false, never throws', () => {
  for (let length = 0; length < tinyElf.length; length++) {
    assert.equal(parseElf(tinyElf.subarray(0, length)).ok, false, `a ${length}-byte prefix parsed`);
  }
  const cut = parseElf(tinyElf.subarray(0, 0x2140));
  assert.equal(cut.ok, false);
  if (!cut.ok) assert.match(cut.error, /outside/);
});

test('non-ELF, ELF64, big-endian and non-ARM inputs return ok:false', () => {
  const garbage = new Uint8Array(256).map((_, i) => (i * 37) & 0xff);
  assert.equal(parseElf(garbage).ok, false);
  assert.equal(parseElf(new Uint8Array(0)).ok, false);

  const elf64 = tinyElf.slice();
  elf64[4] = 2;
  const r64 = parseElf(elf64);
  assert.ok(!r64.ok && /ELF32/.test(r64.error));

  const big = tinyElf.slice();
  big[5] = 2;
  const rBig = parseElf(big);
  assert.ok(!rBig.ok && /little-endian/.test(rBig.error));

  const x86 = tinyElf.slice();
  x86[0x12] = 3;
  x86[0x13] = 0;
  const rX86 = parseElf(x86);
  assert.ok(!rX86.ok && /not ARM/.test(rX86.error));
});

test('corrupt section and string offsets return ok:false', () => {
  const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const badShoff = tinyElf.slice();
  view(badShoff).setUint32(0x20, 0xffff_0000, true);
  assert.equal(parseElf(badShoff).ok, false);

  const badStrndx = tinyElf.slice();
  view(badStrndx).setUint16(0x32, 99, true);
  assert.equal(parseElf(badStrndx).ok, false);

  const badName = tinyElf.slice();
  const shoff = view(badName).getUint32(0x20, true);
  view(badName).setUint32(shoff + 40, 0x7fff_ffff, true);
  assert.equal(parseElf(badName).ok, false);
});

test('implicitAddend reads the addend each ARM REL type keeps in its field (architecture-r1-1, r2-2)', () => {
  const view = (bytes: readonly number[]): DataView => new DataView(Uint8Array.from(bytes).buffer);
  assert.equal(implicitAddend(R_ARM.ABS32, view([0x10, 0, 0, 0]), 0), 0x10, 'R_ARM_ABS32: the word');
  assert.equal(implicitAddend(R_ARM.ABS32, view([0xfc, 0xff, 0xff, 0xff]), 0), -4);
  // R_ARM_THM_CALL: `bl .` as GNU as leaves it for a relocation, 0xF7FF 0xFFFE, is -4.
  assert.equal(implicitAddend(R_ARM.THM_CALL, view([0xff, 0xf7, 0xfe, 0xff]), 0), -4);
  assert.equal(implicitAddend(R_ARM.THM_CALL, view([0x00, 0xf0, 0x04, 0xf8]), 0), 8);
  assert.equal(implicitAddend(R_ARM.CALL, view([0xfe, 0xff, 0xff, 0xeb]), 0), -8, 'R_ARM_CALL: bl . in ARM state');
  assert.equal(implicitAddend(R_ARM.THM_JUMP11, view([0xfe, 0xe7]), 0), -4, 'R_ARM_THM_JUMP11: b .');
  assert.equal(implicitAddend(R_ARM.THM_JUMP8, view([0xfe, 0xd0]), 0), -4, 'R_ARM_THM_JUMP8: beq .');
  assert.equal(implicitAddend(R_ARM.ABS16, view([0xff, 0xff]), 0), -1);
  assert.equal(implicitAddend(R_ARM.ABS8, view([0x80]), 0), -128);
  assert.equal(implicitAddend(R_ARM.V4BX, view([0, 0, 0, 0]), 0), undefined, 'R_ARM_V4BX changes no addend this reader knows');
  assert.equal(implicitAddend(R_ARM.ABS32, view([0, 0]), 0), undefined, 'a field past the bytes');
  assert.deepEqual([...R_ARM_BRANCHES].sort((a, b) => a - b), [1, 10, 28, 29, 102, 103]);
  assert.deepEqual(SHT, { SYMTAB: 2, RELA: 4, NOBITS: 8, REL: 9 });
});

/** A relocatable ARM ELF32 with `.text` = `text`, a `.rel.text` of `rel` and a `.rela.text` of `rela` ([offset, type, addend]). */
function relocatable(text: readonly number[], rel: readonly (readonly [number, number])[], rela: readonly (readonly [number, number, number])[]): Uint8Array {
  const names = '\0.text\0.rel.text\0.rela.text\0.shstrtab\0';
  const nameAt = (n: string): number => names.indexOf(n);
  const textOff = 52;
  const relOff = textOff + ((text.length + 3) & ~3);
  const relaOff = relOff + rel.length * 8;
  const strOff = relaOff + rela.length * 12;
  const shOff = (strOff + names.length + 3) & ~3;
  const bytes = new Uint8Array(shOff + 5 * 40);
  const v = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1], 0);
  v.setUint16(16, 1, true);
  v.setUint16(18, 40, true);
  v.setUint32(32, shOff, true);
  v.setUint16(40, 52, true);
  v.setUint16(46, 40, true);
  v.setUint16(48, 5, true);
  v.setUint16(50, 4, true);
  bytes.set(text, textOff);
  rel.forEach(([offset, type], i) => {
    v.setUint32(relOff + 8 * i, offset, true);
    v.setUint32(relOff + 8 * i + 4, (1 << 8) | type, true);
  });
  rela.forEach(([offset, type, addend], i) => {
    v.setUint32(relaOff + 12 * i, offset, true);
    v.setUint32(relaOff + 12 * i + 4, (2 << 8) | type, true);
    v.setInt32(relaOff + 12 * i + 8, addend, true);
  });
  for (let i = 0; i < names.length; i++) bytes[strOff + i] = names.charCodeAt(i);
  const section = (i: number, name: number, type: number, offset: number, size: number, info = 0, entsize = 0): void => {
    const o = shOff + 40 * i;
    v.setUint32(o, name, true);
    v.setUint32(o + 4, type, true);
    v.setUint32(o + 16, offset, true);
    v.setUint32(o + 20, size, true);
    v.setUint32(o + 28, info, true);
    v.setUint32(o + 36, entsize, true);
  };
  section(1, nameAt('.text'), 1, textOff, text.length);
  section(2, nameAt('.rel.text'), SHT.REL, relOff, rel.length * 8, 1, 8);
  section(3, nameAt('.rela.text'), SHT.RELA, relaOff, rela.length * 12, 1, 12);
  section(4, nameAt('.shstrtab'), 3, strOff, names.length);
  return bytes;
}

test('relocationsOf reads REL and RELA entries alike: a REL addend from its field, a RELA one from its entry', () => {
  const object = relocatable(
    [0x10, 0, 0, 0, 0xff, 0xf7, 0xfe, 0xff, 0, 0, 0, 0],
    [
      [0, R_ARM.ABS32],
      [4, R_ARM.THM_CALL],
      [10, R_ARM.ABS32],
    ],
    [[8, R_ARM.ABS32, -8]],
  );
  const elf = parsed(object);
  const text = elf.sections[1];
  assert.ok(text !== undefined);
  const rels = relocationsOf(object, elf, text);
  assert.ok(rels.ok);
  assert.deepEqual(rels.value, [
    { offset: 0, type: R_ARM.ABS32, symbol: 1, width: 4, addend: 0x10 },
    { offset: 4, type: R_ARM.THM_CALL, symbol: 1, width: 4, addend: -4 },
    { offset: 10, type: R_ARM.ABS32, symbol: 1, width: 4 },
    { offset: 8, type: R_ARM.ABS32, symbol: 2, width: 4, addend: -8 },
  ], 'a REL field past the section has no addend');
  const broken = relocatable([0, 0, 0, 0], [], [[0, R_ARM.ABS32, 0]]);
  new DataView(broken.buffer).setUint32(new DataView(broken.buffer).getUint32(32, true) + 3 * 40 + 36, 8, true);
  const refused = relocationsOf(broken, parsed(broken), parsed(broken).sections[1] ?? text);
  assert.equal(refused.ok, false, 'a RELA entry size below 12 bytes');
});
