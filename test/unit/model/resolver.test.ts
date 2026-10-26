// The resolver (architecture §3.2, §5, §6.2, D62): labels are visible in their own module or when global,
// a module-scoped name may repeat in two modules and each resolves its own, several labels at one address
// print by kind then name, runs_at modules own their run range, and wordValueOf is what `.4byte Name` links to. A word
// holding a load address of a runs_at module names no label (its labels hold run addresses) and loadWordOperand names
// it through `__load_<module>` (§6.7).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { moduleIndexAt, relocatedModules } from '../../../src/core/model/modules.ts';
import { wordScope, wordText } from '../../../src/core/emit/print/pool.ts';
import { addendTo, adrResolverFor, compareLabels, entryLabelOf, isExactLabel, isNamedEntry, loadWordOperand, moduleAt, resolverFor, resolverOver, linkedWordOf, sizedEntries, sizedEntryAt, wordNameOf, wordValueOf } from '../../../src/core/model/resolver.ts';
import { loadSymbolOf } from '../../../src/core/model/modules.ts';
import type { Label } from '../../../src/core/model/types.ts';
import { dataItem, label, modelOf, romWith } from '../../helpers/model.ts';

const A = 0x0800_1000;
const B = 0x0800_2000;
const RAM = 0x0300_0000;

function model(labels: readonly Label[]) {
  const rom = romWith([], { size: 0x4000 });
  return modelOf(rom, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, A - 0x0800_0000)] }] },
      { name: 'alpha', chunks: [{ name: 'Alpha', items: [dataItem(A, 0x1000)] }] },
      { name: 'beta', chunks: [{ name: 'Beta', items: [dataItem(B, 0x1000)] }] },
      { name: 'ram', runAt: RAM, chunks: [{ name: 'RamCode', runAt: RAM, items: [dataItem(0x0800_3000, 0x1000)] }] },
    ],
    labels,
  });
}

test('a module-scoped name repeated in two modules resolves to each module its own', () => {
  const m = model([label('sub_static', A + 0x10), label('sub_static', B + 0x20)]);
  const alpha = resolverFor(m, 'alpha');
  const beta = resolverFor(m, 'beta');
  assert.equal(alpha.addressOf('sub_static'), A + 0x10);
  assert.equal(beta.addressOf('sub_static'), B + 0x20);
  assert.equal(alpha.labelFor(A + 0x10, A), 'sub_static');
  assert.equal(alpha.labelFor(B + 0x20, A), undefined, "beta's module-scoped label is not visible in alpha");
  assert.equal(beta.labelFor(B + 0x20, B), 'sub_static');
  assert.equal(resolverFor(m, 'rom_header').addressOf('sub_static'), undefined);
});

test('a global label is visible everywhere; the own module wins a name clash', () => {
  const m = model([label('Shared', B + 0x40, { scope: 'global' }), label('Shared', A + 0x40)]);
  assert.equal(resolverFor(m, 'beta').labelFor(B + 0x40, A), 'Shared');
  assert.equal(resolverFor(m, 'alpha').labelFor(B + 0x40, A), 'Shared');
  assert.equal(resolverFor(m, 'alpha').addressOf('Shared'), A + 0x40, "alpha's own label first");
  assert.equal(resolverFor(m, 'beta').addressOf('Shared'), B + 0x40);
  assert.equal(resolverFor(m, 'rom_header').addressOf('Shared'), B + 0x40, 'else the global one');
});

test('several labels at one address: func, table, pool, local, data, then name', () => {
  const at = A + 0x80;
  const labels = [label('z_data', at, { kind: 'data' }), label('_local', at, { kind: 'local' }), label('pool', at, { kind: 'pool' }), label('b_func', at), label('a_func', at)];
  assert.equal(resolverFor(model(labels), 'alpha').labelFor(at, at), 'a_func');
  assert.equal(resolverFor(model(labels.slice(0, 3)), 'alpha').labelFor(at, at), 'pool');
  assert.equal(resolverFor(model([labels[0] as Label, labels[1] as Label]), 'alpha').labelFor(at, at), '_local');
  const sorted = [...labels].sort(compareLabels).map((l) => l.name);
  assert.deepEqual(sorted, ['a_func', 'b_func', 'pool', '_local', 'z_data']);
});

test('no label, no name: the resolver never invents one', () => {
  const m = model([label('Alpha', A)]);
  assert.equal(resolverFor(m, 'alpha').labelFor(A + 2, A), undefined);
  assert.equal(resolverFor(m, 'alpha').addressOf('Nope'), undefined);
});

test('a runs_at module owns its run range; its labels hold run addresses', () => {
  const m = model([label('RamCode', RAM), label('RamHelper', RAM + 0x10)]);
  assert.equal(moduleAt(m, RAM + 0x10)?.name, 'ram');
  assert.equal(moduleAt(m, 0x0800_3010)?.name, 'ram', 'and its load span');
  assert.equal(moduleAt(m, A)?.name, 'alpha');
  assert.equal(moduleIndexAt(m.modules, 0x0200_0000, relocatedModules(m.modules)), -1);
  assert.equal(moduleAt(m, 0x0800_4000), undefined);
  assert.equal(resolverFor(m, 'ram').labelFor(RAM + 0x10, RAM), 'RamHelper');
  assert.equal(resolverFor(m, 'alpha').labelFor(RAM + 0x10, A), undefined);
});

test('resolverOver indexes unsorted labels afresh, so a growing array is read as it is now', () => {
  const m = model([]);
  const labels: Label[] = [label('Late', A + 8), label('Early', A + 4)];
  assert.equal(resolverOver(labels, m.modules, 'alpha').labelFor(A + 4, A), 'Early');
  labels.push(label('Later', A + 12));
  assert.equal(resolverOver(labels, m.modules, 'alpha').labelFor(A + 12, A), 'Later');
});

test('wordValueOf: a Thumb function links to its address plus one, everything else to its address', () => {
  assert.equal(wordValueOf(label('ThumbFunc', A)), A + 1);
  assert.equal(wordValueOf(label('ArmFunc', A, { thumb: false })), A);
  assert.equal(wordValueOf(label('_08001000', A, { kind: 'local' })), A, 'a Thumb local label (a branch target) is not a function symbol');
  assert.equal(wordValueOf(label('gTable', A, { kind: 'table' })), A);
  assert.equal(wordValueOf({ addr: 0xffff_fffe, kind: 'func', thumb: true }), 0xffff_ffff);
});

test('adrResolverFor names only a label that links to the address itself: never a Thumb function (D72 c)', () => {
  const m = model([label('Func', A + 0x10, { kind: 'func', thumb: true }), label('_08001010', A + 0x10, { kind: 'local' }), label('ArmFunc', A + 0x20, { kind: 'func', thumb: false }), label('OnlyThumb', A + 0x30, { kind: 'func', thumb: true })]);
  const adr = adrResolverFor(m, 'alpha');
  const all = resolverFor(m, 'alpha');
  assert.equal(all.labelFor(A + 0x10, A), 'Func', 'a branch names the function');
  assert.equal(adr.labelFor(A + 0x10, A), '_08001010');
  assert.equal(adr.labelFor(A + 0x20, A), 'ArmFunc');
  assert.equal(adr.labelFor(A + 0x30, A), undefined, 'no label links to the address itself');
  assert.equal(adr.addressOf('Func'), A + 0x10);
  assert.deepEqual([isExactLabel({ addr: A, kind: 'func', thumb: true }), isExactLabel({ addr: A, kind: 'func', thumb: false }), isExactLabel({ addr: A, kind: 'local', thumb: false })], [false, true, true]);
});

test('a word holding a load address of a runs_at module: no label names it, loadWordOperand names it through __load_<module>', () => {
  const m = model([{ ...label('RamCode', RAM), kind: 'func', thumb: true }, label('Alpha', A)]);
  assert.equal(loadSymbolOf({ name: 'ram' }), '__load_ram');
  assert.equal(wordText(wordScope(m, 'alpha'), 0x0800_3001), '__load_ram + 1', 'never RamCode, which links to its run address');
  assert.equal(wordText(wordScope(m, 'ram'), RAM + 1), 'RamCode', 'the run address prints the label');
  assert.equal(loadWordOperand(m, 0x0800_3000), '__load_ram');
  assert.equal(loadWordOperand(m, 0x0800_3001), '__load_ram + 1');
  assert.equal(loadWordOperand(m, 0x0800_4000), '__load_ram + 4096', 'the end of the copy');
  assert.equal(loadWordOperand(m, RAM), undefined);
  assert.equal(loadWordOperand(m, A), undefined, 'a module that runs where it is loaded');
});

test('the pool printer names a load address of a runs_at module through __load_<module> (correctness-5)', () => {
  const m = model([{ ...label('RamCode', RAM), kind: 'func', thumb: true }]);
  assert.equal(wordText(wordScope(m, 'alpha'), 0x0800_3001), '__load_ram + 1');
  assert.equal(wordText(wordScope(m, 'alpha'), 0x0800_3000), '__load_ram');
  assert.equal(wordText(wordScope(m, 'ram'), RAM + 1), 'RamCode', 'the run address still prints the label');
});

test('sizedEntries and sizedEntryAt: the innermost sized entry holding a word; every function and symbol a named entry', () => {
  const symbols = [
    { addr: 0x0300_0000, name: 'gOuter', size: 0x100 },
    { addr: 0x0300_0010, name: 'gInner', size: 0x10 },
    { addr: 0x0300_0200, name: 'gUnsized' },
  ];
  const functions = [
    { entry: 0x0800_0100, extent: { start: 0x0800_0100, end: 0x0800_0110 }, mode: 'thumb' as const, name: 'Sized', aliases: [], source: { name: { kind: 'default' as const }, extent: 'toml-size' as const } },
    { entry: 0x0800_0200, extent: { start: 0x0800_0200, end: 0x0800_0210 }, mode: 'thumb' as const, name: 'Found', aliases: [], source: { name: { kind: 'default' as const }, extent: 'analysis' as const } },
  ];
  const entries = sizedEntries({ symbols, functions });
  assert.equal(sizedEntries({ symbols, functions }), entries, 'cached per model');
  assert.equal(sizedEntryAt(entries, 0x0300_0014)?.name, 'gInner');
  assert.equal(sizedEntryAt(entries, 0x0300_0024)?.name, 'gOuter');
  assert.equal(sizedEntryAt(entries, 0x0300_0000), undefined, 'the start is the entry itself, not inside it');
  assert.equal(sizedEntryAt(entries, 0x0300_0100), undefined);
  assert.equal(sizedEntryAt(entries, 0x0300_0204), undefined, 'an unsized symbol holds nothing');
  assert.equal(sizedEntryAt(entries, 0x0800_0104)?.name, 'Sized');
  assert.equal(sizedEntryAt(entries, 0x0800_0204), undefined, 'an analysis extent is no TOML size');
  assert.equal(isNamedEntry(entries, { addr: 0x0300_0200, name: 'gUnsized' }), true);
  assert.equal(isNamedEntry(entries, { addr: 0x0800_0200, name: 'Found' }), true);
  assert.equal(isNamedEntry(entries, { addr: 0x0800_0204, name: '_08000204' }), false);
});

test('wordNameOf: a named entry at the word, else the sized entry holding it with its offset, else a label linking to it', () => {
  const symbols = [
    { addr: 0x0300_0000, name: 'gOuter', size: 0x100 },
    { addr: 0x0300_0010, name: 'gNamed' },
  ];
  const functions = [{ entry: 0x0800_0100, extent: { start: 0x0800_0100, end: 0x0800_0110 }, mode: 'thumb' as const, name: 'Sized', aliases: [], source: { name: { kind: 'default' as const }, extent: 'toml-size' as const } }];
  const entries = sizedEntries({ symbols, functions });
  const outer = label('gOuter', 0x0300_0000, { kind: 'data', thumb: false });
  const sized = label('Sized', 0x0800_0100);
  const entryLabel = (e: { readonly name: string }): Label | undefined => (e.name === 'gOuter' ? outer : e.name === 'Sized' ? sized : undefined);
  const named = label('gNamed', 0x0300_0010, { kind: 'data', thumb: false });
  const unk = label('gUnk_03000020', 0x0300_0020, { kind: 'data', thumb: false });
  assert.deepEqual(wordNameOf(entries, 0x0300_0010, [named], entryLabel), { kind: 'label', label: named }, 'a [symbols] entry at the word');
  assert.deepEqual(wordNameOf(entries, 0x0300_0020, [unk], entryLabel), { kind: 'inside', label: outer, offset: 0x20 }, 'an unnamed label gives way to the entry');
  assert.deepEqual(wordNameOf(entries, 0x0300_0020, [unk], () => undefined), { kind: 'label', label: unk }, 'no label for the entry: the word keeps its own');
  assert.deepEqual(wordNameOf(entries, 0x0800_0105, [], entryLabel), { kind: 'inside', label: sized, offset: 4 }, 'from the word a Thumb function links to');
  assert.equal(wordNameOf(entries, 0x0300_0200, [], entryLabel), undefined);
});

test('linkedWordOf and wordNameOf: a Thumb function plus an addend links with the Thumb bit, so it never names an even word inside it', () => {
  const fn = label('Sized', 0x0800_0100);
  assert.equal(linkedWordOf(fn, 0), 0x0800_0101);
  assert.equal(linkedWordOf(fn, 0x13), 0x0800_0113, '(S + A) | T');
  assert.equal(linkedWordOf(label('gData', 0x0300_0000, { kind: 'data', thumb: false }), 0x13), 0x0300_0013);
  const functions = [{ entry: 0x0800_0100, extent: { start: 0x0800_0100, end: 0x0800_0110 }, mode: 'thumb' as const, name: 'Sized', aliases: [], source: { name: { kind: 'default' as const }, extent: 'toml-size' as const } }];
  const entries = sizedEntries({ symbols: [], functions });
  assert.deepEqual(wordNameOf(entries, 0x0800_0105, [], () => fn), { kind: 'inside', label: fn, offset: 4 });
  assert.equal(wordNameOf(entries, 0x0800_0104, [], () => fn), undefined, 'Sized + 3 would link to 0x08000103');
});

test('addendTo: the addend from the word a label links to, none when R_ARM_ABS32 cannot give the word (architecture-o1-1)', () => {
  const fn = label('Case', 0x0800_1020);
  assert.equal(addendTo(fn, 0x0800_1021), 0, 'a Thumb function names its odd word with addend 0');
  assert.equal(addendTo(fn, 0x0800_1020), undefined, '`Case - 1` links to 0x0800101F, not the even word');
  assert.equal(addendTo(fn, 0x0800_1025), 4);
  assert.equal(addendTo(fn, 0x0800_1024), undefined);
  const local = label('_08001020', 0x0800_1020, { kind: 'local', thumb: false });
  assert.equal(addendTo(local, 0x0800_1020), 0);
  assert.equal(addendTo(local, 0x0800_1021), 1);
  assert.equal(addendTo(label('ArmCase', 0x0800_1030, { thumb: false }), 0x0800_1031), 1);
});

test('entryLabelOf: the sized entry\'s own label, named as the entry at its run address and not local (architecture-o0-5)', () => {
  const fn = label('Sized', 0x0300_0100);
  const local = label('Sized', 0x0300_0100, { kind: 'local', thumb: false });
  const other = label('Other', 0x0300_0100, { kind: 'data', thumb: false });
  const at = (labels: readonly Label[]) => (addr: number): readonly Label[] => labels.filter((l) => l.addr === addr);
  // A runs_at function's sized entry sits at its run address (sizedEntries reads runAt), where its func label is.
  const functions = [{ entry: 0x0800_0400, runAt: 0x0300_0100, extent: { start: 0x0800_0400, end: 0x0800_0410 }, mode: 'thumb' as const, name: 'Sized', aliases: [], source: { name: { kind: 'default' as const }, extent: 'toml-size' as const } }];
  const [entry] = sizedEntries({ symbols: [], functions }).sized;
  assert.deepEqual(entry, { addr: 0x0300_0100, name: 'Sized', size: 0x10 });
  if (entry === undefined) return;
  assert.equal(entryLabelOf(entry, at([local, other, fn])), fn, 'never a local label, never another name');
  assert.equal(entryLabelOf(entry, at([local, other])), undefined);
  assert.equal(entryLabelOf({ ...entry, addr: 0x0800_0400 }, at([fn])), undefined, 'the load address holds none of its labels');
});
