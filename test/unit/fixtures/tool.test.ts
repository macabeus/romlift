// The pure comparison logic of bench/tools/fixtures.ts (architecture §8.1, D28) on synthetic inputs:
// the build.mk toolchain record, commit spellings, the compared symbol list and the per-fixture verdict.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ElfFile, ElfSymbol } from 'romlift';

import {
  bytesDifference,
  compareFixture,
  FIXTURES_SCHEMA,
  parseToolchainRecord,
  sameCommit,
  summaryLine,
  symbolDifferences,
  symbolRows,
  withToolchainRecord,
  type FixtureBuild,
  type SymbolRow,
  type ToolchainRecord,
} from '../../../bench/tools/fixtures.ts';

const COMMIT = 'da598c1d918402c42c0c0d7128ba14567f3175e9';
const AS = 'GNU assembler (GNU Binutils) 2.42';
const RECORD: ToolchainRecord = { agbccCommit: COMMIT, asVersion: AS };

const MK = ['# about the fixture', 'NAME := demo', 'SRCS := a.s b.c', 'include ../common/rules.mk', ''].join('\n');

function symbol(name: string, value: number, size: number, type: ElfSymbol['type']): ElfSymbol {
  const func = type === 'func';
  return { name, value, addr: func ? value & ~1 : value, size, type, bind: 'global', thumb: func && (value & 1) === 1, sectionIndex: 1 };
}

function elf(symbols: readonly ElfSymbol[]): ElfFile {
  return { machine: 40, entry: 0x0800_0000, sections: [], symbols };
}

const ROWS: readonly SymbolRow[] = [
  { name: 'main', value: 0x080000f5, size: 16, type: 'func' },
  { name: 'gTable', value: 0x08000110, size: 8, type: 'object' },
];
const BUILD: FixtureBuild = { gba: new Uint8Array([1, 2, 3, 4]), symbols: ROWS };

test('the toolchain record is read from build.mk, and its missing keys are named', () => {
  assert.deepEqual(parseToolchainRecord(MK), { missing: ['AGBCC_COMMIT', 'AS_VERSION'] });
  const written = withToolchainRecord(MK, RECORD);
  assert.deepEqual(parseToolchainRecord(written), RECORD);
  assert.deepEqual(parseToolchainRecord(`AGBCC_COMMIT := ${COMMIT}\nAS_VERSION := \n`), { missing: ['AS_VERSION'] });
});

test('the record is written before the include line and replaced in place on a rewrite', () => {
  const once = withToolchainRecord(MK, RECORD);
  const lines = once.split('\n');
  const include = lines.indexOf('include ../common/rules.mk');
  assert.equal(lines[include - 1], `AS_VERSION := ${AS}`);
  assert.equal(lines[include - 2], `AGBCC_COMMIT := ${COMMIT}`);
  assert.ok(lines.slice(0, 3).join('\n') === MK.split('\n').slice(0, 3).join('\n'), 'the lines before the record are kept');
  const twice = withToolchainRecord(once, { agbccCommit: '0123456789abcdef0123456789abcdef01234567', asVersion: 'GNU assembler 2.45' });
  assert.equal(twice.split('\n').length, once.split('\n').length);
  assert.deepEqual(parseToolchainRecord(twice), { agbccCommit: '0123456789abcdef0123456789abcdef01234567', asVersion: 'GNU assembler 2.45' });
  assert.equal(withToolchainRecord(once, RECORD), once, 'rewriting the same record changes nothing');
  assert.ok(withToolchainRecord('NAME := x', RECORD).endsWith(`AS_VERSION := ${AS}`), 'appended when there is no include');
});

test('commits are the same when equal or when one is an abbreviation of at least 7 digits', () => {
  assert.ok(sameCommit(COMMIT, COMMIT));
  assert.ok(sameCommit('da598c1', COMMIT));
  assert.ok(sameCommit(COMMIT.toUpperCase(), 'da598c1d9'));
  assert.ok(!sameCommit('da598c', COMMIT), 'six digits are too few');
  assert.ok(!sameCommit('84d56fc', COMMIT));
  assert.ok(!sameCommit('', COMMIT));
});

test('the compared symbol list is every symbol, sorted by name, value, size, type', () => {
  const rows = symbolRows(
    elf([
      symbol('main', 0x080000f5, 16, 'func'),
      symbol('crt0.o', 0, 0, 'file'),
      symbol('.text', 0x08000000, 0, 'section'),
      symbol('$t', 0x08000104, 0, 'notype'),
      symbol('$t', 0x080000f4, 0, 'notype'),
      symbol('gTable', 0x08000110, 8, 'object'),
    ]),
  );
  assert.deepEqual(rows, [
    { name: '$t', value: 0x080000f4, size: 0, type: 'notype' },
    { name: '$t', value: 0x08000104, size: 0, type: 'notype' },
    { name: '.text', value: 0x08000000, size: 0, type: 'section' },
    { name: 'crt0.o', value: 0, size: 0, type: 'file' },
    { name: 'gTable', value: 0x08000110, size: 8, type: 'object' },
    { name: 'main', value: 0x080000f5, size: 16, type: 'func' },
  ]);
  assert.equal(symbolRows(elf([symbol('main', 0x080000f5, 16, 'func')]))[0]?.value, 0x080000f5, 'the raw value keeps the Thumb bit');
});

test('byte differences name the first differing offset or the lengths', () => {
  assert.equal(bytesDifference(new Uint8Array([1, 2]), new Uint8Array([1, 2])), undefined);
  assert.match(bytesDifference(new Uint8Array([1, 2]), new Uint8Array([1, 3])) ?? '', /offset 0x00000001/);
  assert.match(bytesDifference(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0])) ?? '', /2 bytes committed and 3 rebuilt/);
});

test('symbol differences list both sides and are capped', () => {
  assert.deepEqual(symbolDifferences(ROWS, ROWS), []);
  const moved = [{ ...ROWS[0], value: 0x080000f7 } as SymbolRow, ROWS[1] as SymbolRow];
  assert.deepEqual(symbolDifferences(ROWS, moved), [
    'symbol only in the committed ELF: main 0x080000F5 16 func',
    'symbol only in the rebuilt ELF: main 0x080000F7 16 func',
  ]);
  const many = Array.from({ length: 12 }, (_, i): SymbolRow => ({ name: `s${i}`, value: i, size: 0, type: 'notype' }));
  const capped = symbolDifferences([], many, 8);
  assert.equal(capped.length, 9);
  assert.equal(capped[8], '4 more symbol differences');
});

test('a fixture agrees when bytes, symbols and the agbcc commit agree; a different as is a note', () => {
  const same = compareFixture('demo', BUILD, RECORD, BUILD, { agbccCommit: COMMIT, asVersion: AS });
  assert.deepEqual(same, { name: 'demo', ok: true, problems: [], notes: [] });
  const otherAs = compareFixture('demo', BUILD, RECORD, BUILD, { agbccCommit: 'da598c1', asVersion: 'GNU assembler 2.45' });
  assert.equal(otherAs.ok, true);
  assert.equal(otherAs.notes.length, 1);
  assert.match(otherAs.notes[0] ?? '', /as is 'GNU assembler 2\.45'/);
});

test('another agbcc commit, other bytes, other symbols or a missing record fail the fixture', () => {
  const otherCommit = compareFixture('demo', BUILD, RECORD, BUILD, { agbccCommit: '84d56fc', asVersion: AS });
  assert.equal(otherCommit.ok, false);
  assert.match(otherCommit.problems[0] ?? '', /agbcc commit 84d56fc differs from the recorded/);
  const otherBytes = compareFixture('demo', BUILD, RECORD, { ...BUILD, gba: new Uint8Array([1, 2, 3, 5]) }, { agbccCommit: COMMIT, asVersion: AS });
  assert.equal(otherBytes.ok, false);
  const otherSymbols = compareFixture('demo', BUILD, RECORD, { ...BUILD, symbols: ROWS.slice(1) }, { agbccCommit: COMMIT, asVersion: AS });
  assert.deepEqual(otherSymbols.problems, ['symbol only in the committed ELF: main 0x080000F5 16 func']);
  const noRecord = compareFixture('demo', BUILD, { missing: ['AGBCC_COMMIT'] }, BUILD, { agbccCommit: COMMIT, asVersion: AS });
  assert.deepEqual(noRecord.problems, ['build.mk has no toolchain record (AGBCC_COMMIT)']);
});

test('an unknown agbcc commit is a note, and the rebuilt bytes decide', () => {
  const unknown = compareFixture('demo', BUILD, RECORD, BUILD, { agbccCommit: undefined, asVersion: AS });
  assert.equal(unknown.ok, true);
  assert.match(unknown.notes[0] ?? '', /agbcc commit in use is unknown/);
  const unknownAndDifferent = compareFixture('demo', BUILD, RECORD, { ...BUILD, gba: new Uint8Array([9]) }, { agbccCommit: undefined, asVersion: AS });
  assert.equal(unknownAndDifferent.ok, false);
});

test('the --json summary line names the failed fixtures and the toolchain', () => {
  const good = compareFixture('a', BUILD, RECORD, BUILD, { agbccCommit: COMMIT, asVersion: AS });
  const bad = compareFixture('b', BUILD, RECORD, { ...BUILD, gba: new Uint8Array() }, { agbccCommit: COMMIT, asVersion: AS });
  const summary = JSON.parse(summaryLine('check', [good, bad], { agbccCommit: undefined, asVersion: AS })) as Record<string, unknown>;
  assert.equal(summary['schema'], FIXTURES_SCHEMA);
  assert.equal(summary['command'], 'check');
  assert.equal(summary['ok'], false);
  assert.equal(summary['fixtures'], 2);
  assert.deepEqual(summary['failed'], ['b']);
  assert.deepEqual(summary['toolchain'], { agbccCommit: null, as: AS });
  assert.equal((JSON.parse(summaryLine('rebuild', [good], { agbccCommit: COMMIT, asVersion: AS })) as { ok: boolean }).ok, true);
});
