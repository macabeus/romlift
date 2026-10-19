// The toolchain verdicts (core/verify/toolchain.ts) and the ELF relocation reader they use
// (foundation/formats/elf.ts relocationsOf), on a hand-built relocatable object: the link verdict and where two
// images first differ, a unit's `.text` compared outside its relocated fields, and the assemble summary.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assembleVerdict, compareObject, firstDifference, linkVerdict, unassemblable } from '../../../src/core/verify/toolchain.ts';
import { parseElf, relocationsOf, relocationWidth } from '../../../src/foundation/formats/elf.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';

/** A relocatable ARM ELF32 with `.text` = `text` and one `.rel.text` holding `rels` ([offset, type] pairs). */
function objectWith(text: Uint8Array, rels: readonly (readonly [number, number])[]): Uint8Array {
  const names = '\0.text\0.rel.text\0.shstrtab\0';
  const nameAt = (n: string): number => names.indexOf(n);
  const textOff = 52;
  const relOff = textOff + text.length;
  const strOff = relOff + rels.length * 8;
  const shOff = (strOff + names.length + 3) & ~3;
  const bytes = new Uint8Array(shOff + 4 * 40);
  const v = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1], 0);
  v.setUint16(16, 1, true); // ET_REL
  v.setUint16(18, 40, true); // EM_ARM
  v.setUint32(20, 1, true);
  v.setUint32(32, shOff, true);
  v.setUint16(40, 52, true);
  v.setUint16(46, 40, true);
  v.setUint16(48, 4, true);
  v.setUint16(50, 3, true);
  bytes.set(text, textOff);
  rels.forEach(([offset, type], i) => {
    v.setUint32(relOff + 8 * i, offset, true);
    v.setUint32(relOff + 8 * i + 4, (1 << 8) | type, true);
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
  section(2, nameAt('.rel.text'), 9, relOff, rels.length * 8, 1, 8);
  section(3, nameAt('.shstrtab'), 3, strOff, names.length);
  return bytes;
}

const ROM_BYTES = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const rom = romFromBytes(ROM_BYTES, 'a'.repeat(40));

test('relocationsOf reads every SHT_REL entry of a section with its type, symbol and field width', () => {
  const object = objectWith(new Uint8Array(8), [
    [0, 10], // R_ARM_THM_CALL: a word (the bl pair)
    [4, 102], // R_ARM_THM_JUMP11: a halfword
    [6, 40], // R_ARM_V4BX: no byte
  ]);
  const elf = parseElf(object);
  assert.ok(elf.ok);
  const text = elf.value.sections.find((s) => s.name === '.text');
  assert.ok(text !== undefined);
  const rels = relocationsOf(object, elf.value, text);
  assert.ok(rels.ok);
  assert.deepEqual(rels.value, [
    { offset: 0, type: 10, symbol: 1, width: 4 },
    { offset: 4, type: 102, symbol: 1, width: 2 },
    { offset: 6, type: 40, symbol: 1, width: 0 },
  ]);
  assert.deepEqual([0, 2, 5, 8, 11, 40, 102, 103].map(relocationWidth), [0, 4, 2, 1, 2, 0, 2, 2]);
});

test('compareObject: equal outside the relocated fields, the first difference otherwise, the span length enforced', () => {
  const unit = { module: 'main', source: 'asm/main.s', object: 'build/main.o', span: { start: 0x0800_0000, end: 0x0800_0008 } };
  const text = ROM_BYTES.slice(0, 8);
  text[1] = 0xee; // inside the relocated word at 0
  assert.deepEqual(compareObject(objectWith(text, [[0, 2]]), unit, rom), { module: 'main', ok: true, detail: 'equals 0x08000000..0x08000008', masked: 4 });
  text[5] = 0xee;
  assert.equal(compareObject(objectWith(text, [[0, 2]]), unit, rom).detail, 'first difference at 0x08000005');
  assert.match(compareObject(objectWith(new Uint8Array(6), []), unit, rom).detail, /0x6 bytes of \.text, the module spans 0x8/);
  assert.match(compareObject(Uint8Array.from([1, 2, 3]), unit, rom).detail, /^build\/main\.o: ELF: /);
});

test('linkVerdict and firstDifference: the SHA-1 decides, the detail says where', () => {
  assert.deepEqual(linkVerdict(ROM_BYTES, rom.sha1, rom, 3), { id: 'link', ok: true, detail: `3 units link to the ROM's SHA-1 ${rom.sha1}`, diagnostics: [], sha1: rom.sha1 });
  const other = ROM_BYTES.slice();
  other[9] = 0;
  const failed = linkVerdict(other, 'b'.repeat(40), rom, 3);
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /first difference at 0x08000009$/);
  assert.equal(firstDifference(Uint8Array.from([...ROM_BYTES, 0]), rom), 'the image is 0x11 bytes, the ROM 0x10');
});

test('assembleVerdict: ok only with every module ok and no diagnostic', () => {
  const ok = { module: 'a', ok: true, detail: 'equals' };
  assert.equal(assembleVerdict([ok], 8, []).ok, true);
  assert.match(assembleVerdict([ok], 8, []).detail, /1 modules assemble to their ROM ranges \(8 relocated bytes left to the linker\)/);
  assert.equal(assembleVerdict([ok, { module: 'b', ok: false, detail: 'first difference at 0x08000004' }], 0, []).detail, '1 of 2 modules differ: b: first difference at 0x08000004');
});

test('unassemblable: a unit whose source is no assembly file, a C module before phase 4, cannot be assembled (architecture-r1-10)', () => {
  assert.equal(unassemblable({ module: 'main', source: 'asm/main.s', object: 'build/main.o' }), undefined);
  assert.equal(unassemblable({ module: 'main', source: 'src/main.c', object: 'build/main.o' }), 'src/main.c (module main) is not an assembly source');
});
