// The resolver (architecture §3.2, §5, §6.2, D62): labels are visible in their own module or when global,
// a module-scoped name may repeat in two modules and each resolves its own, several labels at one address
// print by kind then name, runs_at modules own their run range, and wordValueOf is what `.4byte Name` links to.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { moduleIndexAt, relocatedModules } from '../../../src/core/model/modules.ts';
import { compareLabels, moduleAt, resolverFor, resolverOver, wordValueOf } from '../../../src/core/model/resolver.ts';
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
