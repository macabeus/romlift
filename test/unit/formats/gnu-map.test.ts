import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseGnuMap } from '../../../src/foundation/formats/gnu-map.ts';
import type { GnuMap, GnuMapSection } from '../../../src/foundation/formats/types.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`../../fixtures/formats/${name}`, import.meta.url), 'utf8');
}

function parsed(text: string): GnuMap {
  const result = parseGnuMap(text);
  if (!result.ok) assert.fail(result.error);
  return result.value;
}

function section(map: GnuMap, name: string): GnuMapSection {
  const found = map.sections.find((s) => s.name === name);
  assert.ok(found, name);
  return found;
}

test('tiny.map: output sections with addresses, sizes and load addresses', () => {
  const map = parsed(fixture('tiny.map'));
  assert.deepEqual(
    map.sections.map((s) => s.name),
    ['.text', '.glue_7', '.glue_7t', '.vfp11_veneer', '.v4_bx', '.iplt', '.rodata', '.rel.dyn', '.data', '.igot.plt', '.bss'],
  );
  const text = section(map, '.text');
  assert.equal(text.address, 0x0800_0000);
  assert.equal(text.size, 0x20);
  assert.equal(text.loadAddress, undefined);
  const data = section(map, '.data');
  assert.equal(data.address, 0x0300_0000);
  assert.equal(data.loadAddress, 0x0800_0028);
});

test('tiny.map: input sections, archive members and symbols; fill and assignments skipped', () => {
  const map = parsed(fixture('tiny.map'));
  assert.deepEqual(section(map, '.text').inputs, [
    {
      section: '.text',
      address: 0x0800_0000,
      size: 0x18,
      file: 'tiny.o',
      symbols: [
        { name: 'arm_entry', address: 0x0800_0000 },
        { name: 'thumb_one', address: 0x0800_0008 },
        { name: 'thumb_two', address: 0x0800_000e },
      ],
    },
    {
      section: '.text',
      address: 0x0800_0018,
      size: 0x4,
      file: 'libtiny.a',
      member: 'libpart.o',
      symbols: [{ name: 'lib_helper', address: 0x0800_0018 }],
    },
  ]);
  assert.deepEqual(section(map, '.glue_7').inputs[0]?.file, 'linker stubs');
});

test('tiny.map: a long input section name wrapped onto two lines', () => {
  const map = parsed(fixture('tiny.map'));
  assert.deepEqual(section(map, '.rodata').inputs, [
    {
      section: '.rodata.tiny_section_with_a_long_name',
      address: 0x0800_0020,
      size: 0x8,
      file: 'tiny.o',
      symbols: [{ name: 'tiny_table', address: 0x0800_0020 }],
    },
  ]);
  const data = section(map, '.data');
  assert.deepEqual(data.inputs.map((i) => i.symbols.map((s) => s.name)), [['tiny_counter'], []], 'PROVIDE and ASSERT skipped');
});

test('tiny.map: LOAD lines in order', () => {
  assert.deepEqual(parsed(fixture('tiny.map')).loads, ['tiny.o', 'libtiny.a', 'linker stubs']);
});

test('archive-members.txt: wrapped output and input names, members with paths, COMMON, cross reference ignored', () => {
  const map = parsed(fixture('archive-members.txt'));
  assert.deepEqual(map.sections.map((s) => s.name), ['iwram', 'rom_text_with_a_long_output_name'], 'ewram and /DISCARD/ have no address');
  const iwram = section(map, 'iwram');
  assert.deepEqual(iwram.inputs, [
    {
      section: 'COMMON',
      address: 0x0300_0000,
      size: 0x20,
      file: 'build/main.o',
      symbols: [{ name: 'fixture_buffer', address: 0x0300_0000 }],
    },
    {
      section: 'iwram_code_with_a_long_input_name',
      address: 0x0300_0030,
      size: 0xf0,
      file: 'lib/libfixture.a',
      member: 'iwram_copy.o',
      symbols: [{ name: 'fixture_copy_loop', address: 0x0300_0030 }],
    },
  ]);
  const rom = section(map, 'rom_text_with_a_long_output_name');
  assert.equal(rom.address, 0x0800_0000);
  assert.equal(rom.size, 0x200);
  assert.equal(rom.loadAddress, 0x0810_0000);
  assert.deepEqual(
    rom.inputs.map((i) => [i.section, i.file, i.member, i.symbols.map((s) => s.name)]),
    [
      ['.text', 'build/main.o', undefined, ['fixture_main', 'fixture_tick']],
      ['.text', 'lib/libfixture.a', 'div.o', ['fixture_div', 'fixture_mod']],
      ['.text.unwrapped', '../../tools/lib/libgcc.a', '_call_via_rX.o', ['_call_via_r0']],
    ],
  );
  assert.deepEqual(map.loads, ['build/main.o', 'lib/libfixture.a', 'linker stubs']);
});

test('CRLF line endings parse the same', () => {
  const text = fixture('tiny.map');
  assert.deepEqual(parsed(text.replace(/\n/g, '\r\n')), parsed(text));
});

test('text without the memory map part is ok:false; garbage after the marker is skipped', () => {
  const missing = parseGnuMap('Memory Configuration\n\nName Origin\n');
  assert.equal(missing.ok, false);
  assert.deepEqual(parsed('Linker script and memory map\n\u0000\u0001 ))) 0xZZ\n   \t\n(((\n'), { sections: [], loads: [] });
  assert.deepEqual(parsed('Linker script and memory map\n .orphan  0x10  0x4 x.o\n').sections, [], 'an input outside any section');
});

test('parseGnuMap is deterministic', () => {
  const text = fixture('archive-members.txt');
  assert.deepEqual(parsed(text), parsed(text));
});
