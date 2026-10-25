// bench/src/objdiff.ts, the base of one reference object (g6.objdiff, D34, phase-3.md Q1 option a): the facts each
// difference carries from a recorded objdiff-cli run (test/fixtures/objdiff/facts, architecture-r2-3: sectionBase,
// offset, the reference addend and the base field), how the base takes the reference object's names and bindings while
// every word keeps romlift's own spelling (D102), where an object's sections are linked, and the ELF sizes and
// definitions the base reads.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import type { ElfSymbol } from 'romlift';

import { objectFacts, parseObjdiffDiff } from '../../../bench/src/objdiff-cli.ts';
import { nameAddresses, objdiffClass } from '../../../bench/src/objdiff-classes.ts';
import {
  arOf,
  baseBindings,
  baseRenames,
  globalDefinitions,
  linkedSpans,
  nameBase,
  objdiffDifferences,
  preferredNames,
  symbolSizes,
  type BaseLabel,
} from '../../../bench/src/objdiff.ts';
import type { ObjectName } from '../../../bench/src/objects.ts';

const FACTS = new URL('../../fixtures/objdiff/facts/', import.meta.url);

async function factsDiff() {
  const reference = objectFacts(new Uint8Array(await readFile(new URL('reference.o', FACTS))));
  const base = objectFacts(new Uint8Array(await readFile(new URL('base.o', FACTS))));
  assert.ok(reference.ok && base.ok);
  const parsed = parseObjdiffDiff(JSON.parse(await readFile(new URL('diff.json', FACTS), 'utf8')) as unknown, reference.value, base.value);
  assert.ok(parsed.ok);
  const diff = parsed.value.functions.find((f) => f.name === 'FactsFunc');
  assert.ok(diff !== undefined);
  return diff;
}

test('objdiffDifferences: each difference of the recording carries its section base, offset, addend and base field (architecture-r2-3)', async () => {
  const diff = await factsDiff();
  assert.equal(diff.offset, 4, 'FactsFunc lies 4 bytes into the reference .text');
  const entry = 0x0800_0104;
  const differences = objdiffDifferences({ name: 'FactsFunc', diff, entry });
  assert.deepEqual(differences, [
    {
      kind: 'missing-relocation',
      example: { function: 'FactsFunc', kind: 'missing-relocation', detail: '+0x6 R_ARM_THM_PC22: Callee | a plain value' },
      facts: { sectionBase: 0x0800_0100, offset: 6, relocationType: 10, referenceAddend: -4, baseField: 14 },
    },
    {
      kind: 'missing-relocation',
      example: { function: 'FactsFunc', kind: 'missing-relocation', detail: '+0x14 R_ARM_ABS32: gRam | a plain value' },
      facts: { sectionBase: 0x0800_0100, offset: 20, relocationType: 2, referenceAddend: 8, baseField: 0x0300_0008 },
    },
  ]);
  // The base's bl at 0x08000106 reaches 0x08000106 + 4 + 14; the reference's Callee - 4 + 4 must be that address.
  const names = nameAddresses([
    { name: 'Callee', addr: 0x0800_0118, thumb: true },
    { name: 'gRam', addr: 0x0300_0000, size: 0x10 },
  ]);
  assert.deepEqual(differences.map((d) => objdiffClass(d, names)), ['value-for-symbol', 'value-for-symbol']);
  const moved = nameAddresses([
    { name: 'Callee', addr: 0x0800_011a, thumb: true },
    { name: 'gRam', addr: 0x0300_0004 },
  ]);
  assert.deepEqual(differences.map((d) => objdiffClass(d, moved)), ['relocation-other', 'relocation-other']);
  const unplaced = objdiffDifferences({ name: 'FactsFunc', diff });
  assert.equal(unplaced[0]?.facts.sectionBase, undefined, 'no entry, no section base');
  assert.equal(objdiffClass(unplaced[0] ?? differences[0]!, names), 'unverified');
});

const name = (n: string, addr: number, extra: Partial<ObjectName> = {}): ObjectName => ({ name: n, addr, bind: 'global', defined: false, func: false, size: 0, ...extra });

const LABELS: Readonly<Record<string, BaseLabel>> = {
  sub_08000100: { addr: 0x0800_0100, value: 0x0800_0101, func: true, defined: true },
  sub_08000110: { addr: 0x0800_0110, value: 0x0800_0111, func: true, defined: true },
  Other: { addr: 0x0800_0200, value: 0x0800_0201, func: true, defined: true },
  gELF: { addr: 0x0300_0000, value: 0x0300_0000, func: false, defined: false },
  gUnused: { addr: 0x0300_0100, value: 0x0300_0100, func: false, defined: false },
  gInner: { addr: 0x0200_0010, value: 0x0200_0010, func: false, defined: false },
};
const labelOf = (n: string): BaseLabel | undefined => LABELS[n];

test('baseRenames: a label takes the name its object gives its address, unless another token already holds it', () => {
  const names = new Map([
    [0x0800_0100, name('sStatic', 0x0800_0100, { defined: true, func: true, bind: 'local' })],
    [0x0300_0000, name('gObject', 0x0300_0000)],
    [0x0800_0110, name('Other', 0x0800_0110, { defined: true, func: true })],
  ]);
  const renames = baseRenames(new Set(['sub_08000100', 'gELF', 'sub_08000110', 'Other', 'bl']), labelOf, names);
  assert.deepEqual([...renames], [
    ['gELF', 'gObject'],
    ['sub_08000100', 'sStatic'],
  ], 'sub_08000110 keeps its name: the text already holds Other');
});

test('baseBindings: the object binds what it defines; a function it does not define is global', () => {
  const names = new Map([
    [0x0800_0100, name('sStatic', 0x0800_0100, { defined: true, func: true, bind: 'local' })],
    [0x0800_0110, name('Global', 0x0800_0110, { defined: true, func: true })],
  ]);
  const binds = baseBindings(
    [
      { name: 'sStatic', label: { addr: 0x0800_0100, value: 0x0800_0101, func: true, defined: true } },
      { name: 'Global', label: { addr: 0x0800_0110, value: 0x0800_0111, func: true, defined: true } },
      { name: 'Foreign', label: { addr: 0x0800_0200, value: 0x0800_0201, func: true, defined: true } },
      { name: '_08000120', label: { addr: 0x0800_0120, value: 0x0800_0120, func: false, defined: true } },
    ],
    names,
  );
  assert.deepEqual([...binds], [
    ['sStatic', 'local'],
    ['Global', 'global'],
    ['Foreign', 'global'],
  ]);
});

test('nameBase: renames labels, binds a static function local and another object\'s global, and keeps every word as romlift spells it (D102)', () => {
  const text = [
    '.thumb',
    '\tthumb_func_start sub_08000100',
    'sub_08000100: @ 08000100',
    '\tbl Other',
    '\tbx lr',
    '\tthumb_func_end sub_08000100',
    '\tthumb_func_start_local Other',
    'Other: @ 08000200',
    '\tbx lr',
    '\tthumb_func_end Other',
    '_08000210: .4byte gELF',
    '\t.4byte gUnused',
    '\t.4byte gInner + 8',
    '\t.4byte 0x03000004',
    '',
  ].join('\n');
  const names = new Map([
    [0x0800_0100, name('sStatic', 0x0800_0100, { defined: true, func: true, bind: 'local' })],
    [0x0300_0000, name('gObject', 0x0300_0000, { size: 0x10 })],
    [0x0200_0000, name('gOuter', 0x0200_0000, { size: 0x40 })],
  ]);
  assert.equal(
    nameBase(text, labelOf, names),
    [
      '.thumb',
      '\tthumb_func_start_local sStatic',
      'sStatic: @ 08000100',
      '\tbl Other',
      '\tbx lr',
      '\tthumb_func_end sStatic',
      '\tthumb_func_start Other',
      'Other: @ 08000200',
      '\tbx lr',
      '\tthumb_func_end Other',
      '_08000210: .4byte gObject',
      '\t.4byte gUnused',
      '\t.4byte gInner + 8',
      '\t.4byte 0x03000004',
      '',
    ].join('\n'),
  );
});

test('preferredNames keeps the first name per address and drops a name defined at the BIOS addresses', () => {
  const kept = preferredNames([name('first', 0x0300_0000), name('second', 0x0300_0000), name('_pseudo', 0x10, { defined: true }), name('gNumMusicPlayers', 4)]);
  assert.deepEqual([...kept.values()].map((n) => n.name), ['first', 'gNumMusicPlayers']);
});

function elfSymbol(n: string, addr: number, size: number, extra: Partial<ElfSymbol> = {}): ElfSymbol {
  return { name: n, value: addr, addr, size, type: 'object', bind: 'global', thumb: false, sectionIndex: 1, sectionName: '.bss', ...extra };
}

/** An absolute symbol: in no section. */
const ABSOLUTE: ElfSymbol = { name: 'gAbs', value: 4, addr: 4, size: 0, type: 'notype', bind: 'global', thumb: false, sectionIndex: 0xfff1 };

test('symbolSizes: the ELF size, else up to the next symbol of the section; an absolute symbol keeps its own', () => {
  const symbols = [
    elfSymbol('gSized', 0x0300_0000, 8),
    elfSymbol('gUnsized', 0x0300_0010, 0, { type: 'notype' }),
    elfSymbol('gNext', 0x0300_0030, 0, { type: 'notype' }),
    elfSymbol('gOther', 0x0300_0020, 0, { sectionIndex: 2 }),
    ABSOLUTE,
  ];
  const sizes = symbolSizes(symbols);
  assert.deepEqual(symbols.map((s) => sizes.get(s)), [8, 0x20, 0, 0, 0]);
});

test('globalDefinitions: one address per global name, null for two, none for a local or a BIOS-address section symbol', () => {
  const defs = globalDefinitions([
    elfSymbol('gOne', 0x0300_0000, 4),
    elfSymbol('gTwice', 0x0300_0010, 4),
    elfSymbol('gTwice', 0x0300_0020, 4),
    elfSymbol('sLocal', 0x0300_0030, 4, { bind: 'local' }),
    elfSymbol('_pokemonStorage', 0, 0x83d0, { sectionIndex: 3 }),
    ABSOLUTE,
  ]);
  assert.deepEqual(defs.get('gOne'), { addr: 0x0300_0000, size: 4 });
  assert.equal(defs.get('gTwice'), null);
  assert.equal(defs.has('sLocal'), false);
  assert.equal(defs.has('_pokemonStorage'), false);
  assert.deepEqual(defs.get('gAbs'), { addr: 4, size: 0 });
});

test('linkedSpans: each function entry minus its offset places its section; two disagreeing places drop it', () => {
  const symbols = [
    elfSymbol('A', 0x10, 8, { type: 'func', sectionName: '.text' }),
    elfSymbol('B', 0x20, 8, { type: 'func', sectionName: '.text' }),
    elfSymbol('C', 0, 8, { type: 'func', sectionName: '.text.other' }),
  ];
  const sections = [
    { index: 1, name: '.text', type: 1, flags: 6, addr: 0, offset: 0, size: 0x40, link: 0, info: 0, entsize: 0 },
    { index: 2, name: '.text.other', type: 1, flags: 6, addr: 0, offset: 0, size: 0x8, link: 0, info: 0, entsize: 0 },
  ];
  assert.deepEqual(
    linkedSpans({ sections, symbols }, [
      { name: 'A', entry: 0x0800_1010 },
      { name: 'B', entry: 0x0800_1020 },
    ]),
    [{ section: '.text', start: 0x0800_1000, end: 0x0800_1040 }],
  );
  assert.deepEqual(
    linkedSpans({ sections, symbols }, [
      { name: 'A', entry: 0x0800_1010 },
      { name: 'B', entry: 0x0800_2020 },
      { name: 'C', entry: 0x0800_3000 },
    ]),
    [{ section: '.text.other', start: 0x0800_3000, end: 0x0800_3008 }],
  );
});

test('arOf: the archiver beside the assembler', () => {
  assert.equal(arOf({ as: '/opt/bin/arm-none-eabi-as' }), '/opt/bin/arm-none-eabi-ar');
});
