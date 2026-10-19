// Fault injection into the text-layout self-check (g3.checks-fail, architecture §6.4, §10, D49): on a
// consistent stream, a flipped byte in a FileEntry's text, a wrong `.align` and a missing include each fail
// with E_SELF_CHECK_TEXT naming the file, the line and the address, and the stream's report is not ok.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WRITERS } from '../../../src/core/emit/writers/index.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { checkEntries, checkEntry, textLayoutIndex } from '../../../src/core/verify/text-layout.ts';
import { fixtureEntries, fixtureModel, fixtureRom } from '../../unit/verify/fixture.ts';

const rom = fixtureRom();
const model = fixtureModel(rom);
const CX = { decomp: { defined: [] } };

function stream(): FileEntry[] {
  const written = WRITERS.filter((w) => w.id === 'data' || w.id === 'ldscript' || w.id === 'symbols').flatMap((w) =>
    w.scope === 'global' ? [...w.emit(rom, model, CX, null)] : model.modules.flatMap((_, i) => [...w.emit(rom, model, CX, i)]),
  );
  return [...fixtureEntries(), ...written];
}

/** The stream with the text of `path` rewritten. */
function mutated(path: string, edit: (text: string) => string): { readonly entries: FileEntry[]; readonly entry: FileEntry } {
  const entries = stream().map((e) => (e.path === path && e.ownership === 'generated' ? { ...e, text: edit(e.text) } : e));
  const entry = entries.find((e) => e.path === path);
  assert.ok(entry !== undefined);
  assert.notDeepEqual(entry, stream().find((e) => e.path === path), 'the mutation changed the text');
  return { entries, entry };
}

function assertFails(entries: readonly FileEntry[], entry: FileEntry, line: number, addr: number): void {
  const found = checkEntry(rom, model, textLayoutIndex(model), entry);
  assert.equal(found[0]?.code, 'E_SELF_CHECK_TEXT');
  assert.equal(found[0]?.severity, 'error');
  assert.equal(found[0]?.path, entry.path);
  assert.equal(found[0]?.addr, addr);
  assert.match(found[0]?.message ?? '', new RegExp(`^${entry.path.replace(/[./]/g, '\\$&')} line ${line}: `));
  const report = checkEntries(rom, model, entries);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((c) => c.id === 'text-layout')?.ok, false);
}

test('the unmutated stream passes', () => {
  assert.equal(checkEntries(rom, model, stream()).ok, true);
});

test('a flipped byte in a FileEntry fails with E_SELF_CHECK_TEXT at its file, line and address', () => {
  // crt0's `mov r0, #1` (line 6, 0x080000C0) becomes `mov r0, #3`: one bit of the immediate.
  const { entries, entry } = mutated('asm/crt0.s', (t) => t.replace('mov r0, #1', 'mov r0, #3'));
  assertFails(entries, entry, 6, 0x0800_00c0);
  // The data writer's slice read one byte further on (line 10, 0x08000144).
  const data = mutated('data/data.s', (t) => t.replace('0x144, 0x2BC', '0x145, 0x2BC'));
  assertFails(data.entries, data.entry, 10, 0x0800_0144);
});

test('a wrong `.align` fails with E_SELF_CHECK_TEXT at its line and address', () => {
  // Func's pool alignment widened to 16 bytes emits 10 bytes at 0x08000106, where the padding item is 2.
  const { entries, entry } = mutated('asm/nonmatchings/main/Func.s', (t) => t.replace('.align 2, 0', '.align 4, 0'));
  const found = checkEntry(rom, model, textLayoutIndex(model), entry);
  assert.ok(found.some((d) => d.code === 'E_SELF_CHECK_TEXT' && d.addr === 0x0800_0106 && /line 7: the alignment emits 10 bytes, but the padding item there is 2 bytes/.test(d.message)));
  assertFails(entries, entry, 5, 0x0800_0102);
});

test('a missing include fails with E_SELF_CHECK_TEXT at its line and the chunk address', () => {
  const { entries, entry } = mutated('asm/main.s', (t) => t.replace('.include "asm/nonmatchings/main/Veneer.s"\n', ''));
  assertFails(entries, entry, 6, 0x0800_010c);
  assert.match(checkEntry(rom, model, textLayoutIndex(model), entry)[0]?.message ?? '', /"asm\/nonmatchings\/main\/Veneer\.s"/);
});

test('a [symbols] entry inside the ROM that no file defines is an undefined symbol, as for `as` (correctness-1)', () => {
  // gOddSym names 0x08000101, Func + 1: the inside of Func's push, where no printer can place a label. Only its
  // label could define it (symbols.ld holds the symbols outside the ROM), so a pool word naming it does not link.
  const odd = { ...model, symbols: [{ addr: 0x0200_0000, name: 'gRam' }, { addr: 0x0800_0101, name: 'gOddSym' }] };
  const entries = stream().map((e) => (e.path === 'asm/nonmatchings/main/Func.s' && e.ownership === 'generated' ? { ...e, text: e.text.replace('_08000108: .4byte Func', '_08000108: .4byte gOddSym') } : e));
  const entry = entries.find((e) => e.path === 'asm/nonmatchings/main/Func.s');
  assert.ok(entry !== undefined && 'text' in entry && entry.text.includes('gOddSym'));
  const found = checkEntry(rom, odd, textLayoutIndex(odd), entry);
  assert.equal(found[0]?.code, 'E_SELF_CHECK_TEXT');
  assert.match(found[0]?.message ?? '', /gOddSym/);
  assert.equal(checkEntries(rom, odd, entries).ok, false);
  // A RAM symbol still resolves through symbols.ld.
  const ram = stream().map((e) => (e.path === 'asm/nonmatchings/main/Func.s' && e.ownership === 'generated' ? { ...e, text: e.text.replace('_08000108: .4byte Func', '_08000108: .4byte gRam') } : e));
  const ramEntry = ram.find((e) => e.path === 'asm/nonmatchings/main/Func.s');
  assert.ok(ramEntry !== undefined);
  assert.match(checkEntry(rom, model, textLayoutIndex(model), ramEntry)[0]?.message ?? '', /lays out 0x00 where the ROM holds 0x01/);
});
