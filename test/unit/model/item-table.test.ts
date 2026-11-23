// The ItemTable builder and itemAt (architecture §3.4, §9.4, D19): every item kind round-trips through
// the struct of arrays, instructions are re-decoded lazily (at the run address when given an offset),
// lengths are 32-bit, and a caller bug is an invariant error, never a silent truncation.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decodeItemAt,
  emptyItemTable,
  findItem,
  itemAt,
  itemSpan,
  itemTableBuilder,
  specIdAt,
  specIndex,
} from '../../../src/core/model/item-table.ts';
import { DATA_NOTES, ITEM_RAW_REASONS, ItemKind, NO_SPEC } from '../../../src/core/model/types.ts';
import { RomliftInvariantError } from '../../../src/foundation/diagnostics/diagnostic.ts';
import { armAt } from '../../helpers/arm.ts';
import { romWith, words } from '../../helpers/model.ts';
import { thumbAt } from '../../helpers/thumb.ts';

const CODE = 0x0800_0200;

function rom() {
  return romWith([
    { at: CODE, bytes: thumbAt(CODE)`push {lr}; bl _08000300; ldr r0, _0800020C; pop {pc}` },
    { at: CODE + 0x0c, bytes: words(0x0800_0301, 0x0800_0300) },
    { at: 0x0800_0300, bytes: armAt(0x0800_0300)`bx lr` },
  ]);
}

test('every item kind round-trips through the table', () => {
  const r = rom();
  const b = itemTableBuilder(1);
  b.append({ kind: 'insn', start: CODE, length: 2, specId: 'thumb.push' });
  b.append({ kind: 'insn', start: CODE + 2, length: 4, specId: 'thumb.bl' });
  b.append({
    kind: 'raw-insn',
    start: CODE + 6,
    length: 2,
    specId: 'thumb.ldr_literal',
    reason: 'cross-module-short-branch',
  });
  b.append({ kind: 'raw-insn', start: CODE + 8, length: 2, specId: null, reason: 'undefined' });
  b.append({ kind: 'padding', start: CODE + 0x0a, length: 2 });
  b.append({ kind: 'pool', start: CODE + 0x0c, value: 0x0800_0301 });
  b.append({ kind: 'table-entry', start: CODE + 0x10, target: 0x0800_0300, thumbBit: false });
  b.append({ kind: 'table-entry', start: CODE + 0x14, target: 0x0800_0300, thumbBit: true });
  b.append({ kind: 'data', start: CODE + 0x18, length: 3, note: 'mixer-hole' });
  b.append({ kind: 'data', start: CODE + 0x1b, length: 1 });
  b.append({ kind: 'insn', start: 0x0800_0300, length: 4, specId: 'arm.bx' });
  assert.equal(b.count, 11);
  const t = b.finish();
  assert.equal(t.count, 11);
  for (const array of [t.kind, t.start, t.length, t.spec, t.aux]) assert.equal(array.length, 11);
  assert.deepEqual(
    [...t.kind],
    [
      ItemKind.insn,
      ItemKind.insn,
      ItemKind.rawInsn,
      ItemKind.rawInsn,
      ItemKind.padding,
      ItemKind.pool,
      ItemKind.tableEntry,
      ItemKind.tableEntry,
      ItemKind.data,
      ItemKind.data,
      ItemKind.insn,
    ],
  );
  assert.equal(t.spec[3], NO_SPEC);
  assert.equal(t.aux[2], ITEM_RAW_REASONS.indexOf('cross-module-short-branch'));
  assert.equal(t.aux[8], DATA_NOTES.indexOf('mixer-hole') + 1);
  assert.equal(t.aux[9], 0);

  const push = itemAt(t, 0, r);
  assert.equal(push.kind, 'insn');
  assert.deepEqual(push.span, { start: CODE, end: CODE + 2 });
  if (push.kind === 'insn') assert.equal(push.insn.specId, 'thumb.push');
  const bl = itemAt(t, 1, r);
  assert.ok(
    bl.kind === 'insn' && bl.insn.size === 4 && bl.insn.flow.kind === 'call' && bl.insn.flow.target === 0x0800_0300,
  );
  const raw = itemAt(t, 2, r);
  assert.ok(
    raw.kind === 'raw-insn' && raw.reason === 'cross-module-short-branch' && raw.insn?.specId === 'thumb.ldr_literal',
  );
  assert.deepEqual(itemAt(t, 3, r), {
    kind: 'raw-insn',
    span: { start: CODE + 8, end: CODE + 10 },
    reason: 'undefined',
  });
  assert.deepEqual(itemAt(t, 4, r), { kind: 'padding', span: { start: CODE + 0x0a, end: CODE + 0x0c } });
  assert.deepEqual(itemAt(t, 5, r), {
    kind: 'pool',
    span: { start: CODE + 0x0c, end: CODE + 0x10 },
    value: 0x0800_0301,
  });
  assert.deepEqual(itemAt(t, 6, r), {
    kind: 'table-entry',
    span: { start: CODE + 0x10, end: CODE + 0x14 },
    target: 0x0800_0300,
    thumbBit: false,
  });
  assert.deepEqual(itemAt(t, 7, r), {
    kind: 'table-entry',
    span: { start: CODE + 0x14, end: CODE + 0x18 },
    target: 0x0800_0300,
    thumbBit: true,
  });
  assert.deepEqual(itemAt(t, 8, r), {
    kind: 'data',
    span: { start: CODE + 0x18, end: CODE + 0x1b },
    note: 'mixer-hole',
  });
  assert.deepEqual(itemAt(t, 9, r), { kind: 'data', span: { start: CODE + 0x1b, end: CODE + 0x1c } });
  const bx = itemAt(t, 10, r);
  assert.ok(bx.kind === 'insn' && bx.insn.mode === 'arm' && bx.insn.specId === 'arm.bx');
});

test('lengths are 32-bit: a 16 MiB data item keeps its length', () => {
  const b = itemTableBuilder();
  b.append({ kind: 'data', start: 0x0800_0000, length: 0x0100_0000 });
  b.append({ kind: 'data', start: 0x0900_0000, length: 0xffff_ffff - 0x0900_0000 + 1 });
  const t = b.finish();
  assert.equal(t.length[0], 0x0100_0000);
  assert.deepEqual(itemSpan(t, 0), { start: 0x0800_0000, end: 0x0900_0000 });
  assert.deepEqual(itemSpan(t, 1), { start: 0x0900_0000, end: 0x1_0000_0000 });
});

test('the builder grows past its capacity and finish trims to the count', () => {
  const b = itemTableBuilder(2);
  for (let i = 0; i < 1000; i++)
    b.append({ kind: 'data', start: 0x0800_0000 + 4 * i, length: 4, note: DATA_NOTES[i % 3] ?? 'dead' });
  const t = b.finish();
  assert.equal(t.count, 1000);
  assert.equal(t.start.length, 1000);
  assert.equal(t.start[999], 0x0800_0000 + 4 * 999);
  assert.equal(t.aux[998], (998 % 3) + 1);
  assert.throws(() => b.append({ kind: 'data', start: 0, length: 1 }), RomliftInvariantError);
});

test('an instruction decodes at its run address when given the chunk offset', () => {
  const r = rom();
  const b = itemTableBuilder();
  b.append({ kind: 'insn', start: CODE + 2, length: 4, specId: 'thumb.bl' });
  const t = b.finish();
  const delta = 0x0300_0000 - CODE;
  const item = itemAt(t, 0, r, delta);
  assert.ok(item.kind === 'insn');
  assert.equal(item.insn.addr, 0x0300_0002);
  assert.deepEqual(item.span, { start: CODE + 2, end: CODE + 6 }, 'the span stays in load addresses');
});

test('a spec that does not decode at its bytes is an invariant error, as are malformed items', () => {
  const r = rom();
  const wrong = itemTableBuilder();
  wrong.append({ kind: 'insn', start: CODE, length: 2, specId: 'thumb.pop' });
  assert.throws(() => itemAt(wrong.finish(), 0, r), RomliftInvariantError);
  const b = itemTableBuilder();
  assert.throws(() => b.append({ kind: 'data', start: CODE, length: 0 }), RomliftInvariantError);
  assert.throws(() => b.append({ kind: 'data', start: -4, length: 4 }), RomliftInvariantError);
  assert.throws(() => b.append({ kind: 'pool', start: CODE, value: -1 }), RomliftInvariantError);
  assert.throws(
    () => b.append({ kind: 'table-entry', start: CODE, target: 0x0800_0301, thumbBit: false }),
    RomliftInvariantError,
  );
  assert.throws(() => itemAt(emptyItemTable(), 0, r), RomliftInvariantError);
});

test('spec indexes cover both tables and stay below NO_SPEC', () => {
  assert.equal(specIdAt(specIndex('thumb.bl')), 'thumb.bl');
  assert.equal(specIdAt(specIndex('arm.bx')), 'arm.bx');
  assert.ok(specIndex('arm.bx') > specIndex('thumb.bl'));
  assert.equal(specIdAt(NO_SPEC), undefined);
  assert.throws(() => specIndex('thumb.nope'), RomliftInvariantError);
});

test('findItem returns the item containing an address, or -1', () => {
  const b = itemTableBuilder();
  b.append({ kind: 'data', start: 0x100, length: 4 });
  b.append({ kind: 'data', start: 0x104, length: 2 });
  b.append({ kind: 'data', start: 0x108, length: 8 });
  const t = b.finish();
  assert.equal(findItem(t, 0x0ff), -1);
  assert.equal(findItem(t, 0x100), 0);
  assert.equal(findItem(t, 0x103), 0);
  assert.equal(findItem(t, 0x105), 1);
  assert.equal(findItem(t, 0x106), -1, 'a gap');
  assert.equal(findItem(t, 0x10f), 2);
  assert.equal(findItem(t, 0x110), -1);
  assert.equal(findItem(emptyItemTable(), 0), -1);
});

test('decodeItemAt: the one decode of an item, the instruction or why there is none; itemAt throws the same reason (architecture-r1-4)', () => {
  const r = rom();
  const b = itemTableBuilder(1);
  b.append({ kind: 'insn', start: CODE, length: 2, specId: 'thumb.push' });
  b.append({ kind: 'insn', start: CODE + 2, length: 4, specId: 'thumb.bl' });
  b.append({ kind: 'insn', start: CODE + 6, length: 2, specId: 'thumb.push' });
  b.append({ kind: 'data', start: CODE + 8, length: 4 });
  b.append({ kind: 'insn', start: 0x0800_0300, length: 4, specId: 'arm.bx' });
  const t = b.finish();
  const bl = decodeItemAt(r, t, 1, 0);
  assert.ok(typeof bl !== 'string');
  assert.equal(bl.specId, 'thumb.bl');
  assert.equal(bl.flow.kind === 'call' ? bl.flow.target : undefined, 0x0800_0300);
  assert.equal((decodeItemAt(r, t, 4, 0) as { readonly specId: string }).specId, 'arm.bx');
  assert.equal(
    decodeItemAt(r, t, 2, 0),
    'it records thumb.push (2 bytes) but its bytes decode as thumb.ldr_literal (2 bytes)',
  );
  assert.equal(decodeItemAt(r, t, 3, 0), 'it records no isa row');
  assert.throws(() => itemAt(t, 2, r), /the item at 0x08000206: it records thumb\.push/);
  const outside = itemTableBuilder(1);
  outside.append({ kind: 'insn', start: r.end - 2, length: 4, specId: 'thumb.bl' });
  assert.equal(decodeItemAt(r, outside.finish(), 0, 0), 'its 4 bytes are not in the ROM');
});
