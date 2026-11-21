// Run-space walks (architecture §3.3, §6.7, D46): code loaded at L and run at R through a runs_at range is decoded at
// its run addresses, and every branch, bl, adr, pool load and jump-table target it computes in run space is mapped back
// to the load address that holds it; a target in RAM outside every range is an external reference (no error, no call,
// no walk target). The same bytes on the identity map read wrong, which is what the map is for. Synthetic bytes under
// agbcc's walk slot.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addressMap } from '../../../../src/core/analysis/address-map.ts';
import type { AnalysisView, Reading } from '../../../../src/core/analysis/types.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import type { Addr, Mode } from '../../../../src/foundation/rom/span.ts';
import { romWith, viewWith, walkReading, words } from '../../../helpers/analysis.ts';
import type { Placed } from '../../../helpers/analysis.ts';
import { armAt } from '../../../helpers/arm.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { WALK } from '../rules/walk/support.ts';

/** The load address of the range, its run address and its length. */
const L = 0x0800_0400;
const R = 0x0300_0000;
const SIZE = 0x100;

/** A view of `parts` with the range [L, L + SIZE) running at R (or on the identity map). */
function viewOf(parts: readonly Placed[], mapped = true): AnalysisView {
  const rom: Rom = romWith(parts, { size: 0x800 });
  const base = viewWith({ rom });
  return mapped
    ? { ...base, addresses: addressMap([{ span: { start: L, end: L + SIZE }, kind: 'code', runsAt: R }]) }
    : base;
}

function walk(view: AnalysisView, entry: Addr, mode: Mode): Reading {
  return walkReading(view, entry, mode, WALK);
}

test('Thumb: b, bcc, bl, adr and a pool load compute their targets at run addresses and land at load addresses', () => {
  const code = thumbAt(
    R,
  )`push {lr}; cmp r0, #0; beq _03000010; ldr r1, _0300001C; adr r2, _03000020; bl _03000040; b _03000010`;
  const tail = thumbAt(R + 0x10)`pop {pc}`;
  const callee = thumbAt(R + 0x40)`bx lr`;
  const view = viewOf([
    { at: L, bytes: code },
    { at: L + 0x10, bytes: tail },
    { at: L + 0x1c, bytes: words(0x1234_5678) },
    { at: L + 0x40, bytes: callee },
  ]);
  const r = walk(view, L, 'thumb');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.branchTargets, [L + 0x10]);
  assert.deepEqual(r.pools, [{ addr: L + 0x1c, value: 0x1234_5678 }]);
  assert.deepEqual(r.adrs, [L + 0x20]);
  assert.deepEqual(r.calls, [{ site: L + 0x0a, target: L + 0x40, mode: 'thumb' }]);
  assert.ok(r.insnAt.has(L + 0x10), 'the branch target is walked at its load address');
  assert.equal(r.returns, 1);
});

test('ARM: b, bl, adr and a pc-relative ldr compute their targets at run addresses and land at load addresses', () => {
  const code = armAt(
    R,
  )`stmdb sp!, {lr}; ldr r0, _03000020; adr r1, _03000024; bl _03000040; cmp r0, #0; bne _03000018; ldmia sp!, {pc}`;
  const view = viewOf([
    { at: L, bytes: code },
    { at: L + 0x20, bytes: words(0xcafe_f00d) },
    { at: L + 0x40, bytes: armAt(R + 0x40)`bx lr` },
  ]);
  const r = walk(view, L, 'arm');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.pools, [{ addr: L + 0x20, value: 0xcafe_f00d }]);
  assert.deepEqual(r.adrs, [L + 0x24]);
  assert.deepEqual(r.calls, [{ site: L + 0x0c, target: L + 0x40, mode: 'arm' }]);
  assert.deepEqual(r.branchTargets, [L + 0x18]);
});

test('a target in RAM outside every range is an external reference: a call goes on, a branch leaves, nothing errs', () => {
  const thumbCode = thumbAt(R)`push {lr}; bl _03004000; cmp r0, #0; beq _03000104; pop {pc}`;
  const t = walk(viewOf([{ at: L, bytes: thumbCode }]), L, 'thumb');
  assert.deepEqual(t.errors, []);
  assert.deepEqual([t.calls, t.blSites, t.branchTargets, t.tails], [[], [], [], []]);
  assert.deepEqual(
    t.exits.map((e) => [e.at, e.kind]),
    [
      [L + 8, 'tail'],
      [L + 0x0a, 'return'],
    ],
  );
  const armCode = armAt(R)`stmdb sp!, {lr}; bl _03004000; cmp r0, #0; bne _03002000; ldmia sp!, {pc}`;
  const a = walk(viewOf([{ at: L, bytes: armCode }]), L, 'arm');
  assert.deepEqual(a.errors, []);
  assert.deepEqual([a.calls, a.branchTargets], [[], []]);
  assert.deepEqual(
    a.exits.map((e) => [e.at, e.kind]),
    [
      [L + 0x0c, 'tail'],
      [L + 0x10, 'return'],
    ],
  );
  // On the identity map the same relative offsets name cartridge addresses past this ROM's end: errors, as before.
  assert.deepEqual(
    walk(viewOf([{ at: L, bytes: thumbCode }], false), L, 'thumb').errors.map((e) => e.reason),
    ['bl-out-of-rom'],
  );
  assert.ok(
    walk(viewOf([{ at: L, bytes: armCode }], false), L, 'arm').calls.length === 1,
    'the identity map takes the bl for a call into the cartridge',
  );
});

test('a jump table inside a range: its base and targets are run addresses, found at their load addresses', () => {
  const code = thumbAt(R)`ldr r1, _0300000C; ldr r0, [r1, r0]; mov pc, r0`;
  const ret = thumbAt(0)`bx lr`;
  const parts: Placed[] = [
    { at: L, bytes: code },
    { at: L + 0x0c, bytes: words(R + 0x10) },
    { at: L + 0x10, bytes: words(R + 0x20, R + 0x24, 0) },
    { at: L + 0x20, bytes: ret },
    { at: L + 0x24, bytes: ret },
  ];
  const r = walk(viewOf(parts), L, 'thumb');
  assert.deepEqual(r.tables, [{ base: L + 0x10, targets: [L + 0x20, L + 0x24], thumbBit: false }]);
  assert.equal(r.returns, 2);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(walk(viewOf(parts, false), L, 'thumb').tables, [], 'on the identity map the base is no ROM address');
});
