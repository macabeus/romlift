// seed.ram-copy (D60 e): a copy of a ROM block to IWRAM by accepted code, and the IWRAM pointers accepted
// code jumps through, name entries of the block at their load addresses; each pair is proposed when the
// later of the two functions is accepted. The copy is recognised by what the callee does: a copy loop in
// either argument order (a byte count, an end pointer computed from it, an end compared with a copy
// pointer, or a count of units), a BIOS CpuSet or CpuFastSet stub, or an inline swi; its arguments come
// from the straight-line run before the call (argInsns), and a jump from within jumpInsns of its load.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/seed/ram-copy.ts';
import { Claim, type AnalysisView, type Reading } from '../../../../../src/core/analysis/types.ts';
import type { Rom } from '../../../../../src/foundation/rom/rom.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import { REFERENCE_WALK, romWith, viewWith, walkReading, words } from '../../../../helpers/analysis.ts';
import { withVerdicts } from '../../../../../src/core/analysis/reading.ts';
import type { RuleId } from '../../../../../src/core/provenance/rule-id.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { factOf } from './fact.ts';

const MAIN = 0x0800_0200;
const COPY = 0x0800_0240;
const VENEER = 0x0800_0260;
const BLOCK = 0x0800_0300;
const IWRAM = 0x0300_0100;

/** What main calls to copy: a loop taking (source, dest, size), memcpy's (dest, src, n), BIOS stubs, an inline swi, or a routine that copies nothing. */
type Callee = 'src-first' | 'memcpy' | 'cpuset' | 'cpufastset' | 'inline-swi' | 'not-a-copy' | 'two-stores' | 'word-count' | 'dest-end' | 'source-end';

interface Options {
  readonly callee?: Callee;
  /** The destination main passes. */
  readonly dest?: number;
  /** The IWRAM pointer the veneer loads. */
  readonly pointer?: number;
  /** What the veneer does with it (default `bx r3`). */
  readonly use?: 'bx' | 'store';
  /** The size argument: bytes for the loops, the control word for the BIOS calls. */
  readonly size?: number;
}

const CALLEES: Readonly<Record<Callee, Uint8Array>> = {
  'src-first': thumbAt(COPY)`ldrb r3, [r0]; strb r3, [r1]; adds r0, #1; adds r1, #1; subs r2, #1; bne _08000240; bx lr`,
  memcpy: thumbAt(COPY)`ldrb r3, [r1]; strb r3, [r0]; adds r0, #1; adds r1, #1; subs r2, #1; bne _08000240; bx lr`,
  cpuset: thumbAt(COPY)`swi #11; bx lr`,
  cpufastset: thumbAt(COPY)`swi #12; bx lr`,
  'inline-swi': thumbAt(COPY)`bx lr`,
  'not-a-copy': thumbAt(COPY)`bx lr`,
  // Stores through both pointer arguments: no single destination.
  'two-stores': thumbAt(COPY)`ldrb r3, [r0]; strb r3, [r1]; strb r3, [r0]; adds r0, #1; adds r1, #1; subs r2, #1; bne _08000240; bx lr`,
  // A word loop counting words: 4 bytes per unit.
  'word-count': thumbAt(COPY)`ldmia r0!, {r3}; stmia r1!, {r3}; subs r2, #1; bne _08000240; bx lr`,
  // CopyWords(src, dest, end): the destination runs up to the third argument (L = end - dest).
  'dest-end': thumbAt(COPY)`cmp r1, r2; bcs _0800024A; ldmia r0!, {r3}; stmia r1!, {r3}; b _08000240; bx lr`,
  // The same with the source compared against its end (L = end - source).
  'source-end': thumbAt(COPY)`cmp r0, r2; bcs _0800024A; ldmia r0!, {r3}; stmia r1!, {r3}; b _08000240; bx lr`,
};

/** main copies BLOCK (three ARM routines A, B, C at +0, +8, +0x14) to `dest` through the callee; the veneer jumps through `pointer`. */
function romFor(o: Options = {}): Rom {
  const callee = o.callee ?? 'src-first';
  const dest = o.dest ?? IWRAM;
  const size = o.size ?? (callee === 'cpuset' || callee === 'inline-swi' ? 0x0400_0008 : callee === 'cpufastset' ? 8 : callee === 'word-count' ? 8 : 0x20);
  // memcpy takes (dest, src, n): main loads the words in that order; the end-pointer loops take an end.
  const args =
    callee === 'memcpy' ? words(dest, BLOCK, size) : callee === 'dest-end' ? words(BLOCK, dest, dest + size) : callee === 'source-end' ? words(BLOCK, dest, BLOCK + size) : words(BLOCK, dest, size);
  const main =
    callee === 'inline-swi'
      ? thumbAt(MAIN)`push {lr}; ldr r0, _08000210; ldr r1, _08000214; ldr r2, _08000218; swi #11; pop {pc}`
      : thumbAt(MAIN)`push {lr}; ldr r0, _08000210; ldr r1, _08000214; ldr r2, _08000218; bl _08000240; pop {pc}`;
  return romWith([
    { at: MAIN, bytes: main },
    { at: MAIN + 0x10, bytes: args },
    { at: COPY, bytes: CALLEES[callee] },
    { at: VENEER, bytes: o.use === 'store' ? thumbAt(VENEER)`ldr r3, _08000268; str r3, [r0]; bx lr` : thumbAt(VENEER)`ldr r3, _08000268; bx r3` },
    { at: VENEER + 8, bytes: words(o.pointer ?? IWRAM + 8) },
    // BLOCK: A = mov; bx lr. B = add; add; bx lr. C = mov; bx lr.
    { at: BLOCK, bytes: armAt(BLOCK)`mov r0, #0; bx lr; add r0, r0, #1; add r0, r0, #2; bx lr; mov r0, #3; bx lr` },
  ]);
}

/** A view in which `accepted` are functions with their own readings. */
function viewOf(rom: Rom, accepted: readonly number[]): AnalysisView {
  const plain = viewWith({ rom });
  const readings: Reading[] = accepted.map((e) => plain.read(e, 'thumb'));
  return viewWith({ rom, functions: [...accepted], readings });
}

const queue = (rom: Rom, entry: number, accepted: readonly number[]) => {
  const v = viewOf(rom, accepted);
  return rule.queue(factOf(v.read(entry, 'thumb')), v);
};

const B = [{ entry: BLOCK + 8, mode: 'arm', cites: [VENEER, MAIN] }];

test('the copy and the jump name the ARM entry at its load address, whichever is accepted later', () => {
  const rom = romFor();
  assert.deepEqual(queue(rom, VENEER, [MAIN, VENEER]), B, 'the veneer after main');
  assert.deepEqual(queue(rom, MAIN, [VENEER, MAIN]), B, 'main after the veneer');
  assert.deepEqual(queue(rom, MAIN, [MAIN]), [], 'no jump yet');
  assert.deepEqual(queue(rom, VENEER, [VENEER]), [], 'no copy yet');
  assert.equal(rule.meta.origin, 'ram-copy');
});

test('the copy is recognised by what the callee does, in either argument order, and by the BIOS copy calls', () => {
  for (const callee of ['src-first', 'memcpy', 'cpuset', 'cpufastset', 'inline-swi', 'word-count', 'dest-end', 'source-end'] as const) {
    assert.deepEqual(queue(romFor({ callee }), VENEER, [MAIN, VENEER]), B, callee);
  }
  assert.deepEqual(queue(romFor({ callee: 'not-a-copy' }), VENEER, [MAIN, VENEER]), [], 'a callee that copies nothing');
  assert.deepEqual(queue(romFor({ callee: 'two-stores' }), VENEER, [MAIN, VENEER]), [], 'no single destination');
  assert.deepEqual(queue(romFor({ callee: 'cpuset', size: 0x0500_0008 }), VENEER, [MAIN, VENEER]), [], 'a CpuSet fill copies nothing');
  // CpuSet in halfwords: 8 units are 16 bytes, so the pointer at +8 is inside and the one at +0x14 is not.
  assert.deepEqual(queue(romFor({ callee: 'cpuset', size: 8 }), VENEER, [MAIN, VENEER]), B);
  assert.deepEqual(queue(romFor({ callee: 'cpuset', size: 8, pointer: IWRAM + 0x14 }), VENEER, [MAIN, VENEER]), []);
});

test('a Thumb pointer names a Thumb entry; a pointer outside the copy names none', () => {
  const thumbBlock = romWith([
    { at: MAIN, bytes: thumbAt(MAIN)`push {lr}; ldr r0, _08000210; ldr r1, _08000214; ldr r2, _08000218; bl _08000240; pop {pc}` },
    { at: MAIN + 0x10, bytes: words(BLOCK, IWRAM, 0x20) },
    { at: COPY, bytes: CALLEES['src-first'] },
    { at: VENEER, bytes: thumbAt(VENEER)`ldr r3, _08000268; bx r3` },
    { at: VENEER + 8, bytes: words(IWRAM + 4 + 1) },
    { at: BLOCK, bytes: thumbAt(BLOCK)`movs r0, #0; bx lr; movs r0, #1; bx lr` },
  ]);
  assert.deepEqual(queue(thumbBlock, VENEER, [MAIN, VENEER]), [{ entry: BLOCK + 4, mode: 'thumb', cites: [VENEER, MAIN] }]);
  assert.deepEqual(queue(romFor({ pointer: IWRAM + 0x40 }), VENEER, [MAIN, VENEER]), [], 'past the copied bytes');
});

test('declined: the block start, a fall-through entry, a store, an EWRAM copy, a copy past IWRAM', () => {
  assert.deepEqual(queue(romFor({ pointer: IWRAM }), VENEER, [MAIN, VENEER]), [], 'a pointer equal to the destination');
  assert.deepEqual(queue(romFor({ pointer: IWRAM + 0x0c }), VENEER, [MAIN, VENEER]), [], 'the second add of B: the code before it falls into it');
  assert.deepEqual(queue(romFor({ pointer: IWRAM + 0x14 }), VENEER, [MAIN, VENEER]), [{ entry: BLOCK + 0x14, mode: 'arm', cites: [VENEER, MAIN] }], 'C opens after `bx lr`');
  assert.deepEqual(queue(romFor({ use: 'store' }), VENEER, [MAIN, VENEER]), [], 'the pointer is stored, not jumped through');
  assert.deepEqual(queue(romFor({ dest: 0x0200_0100, pointer: 0x0200_0108 }), VENEER, [MAIN, VENEER]), [], 'EWRAM');
  assert.deepEqual(queue(romFor({ dest: 0x0300_7ff0, pointer: 0x0300_7ff8 }), VENEER, [MAIN, VENEER]), [], 'the copy runs past the end of IWRAM');
});

test('an end-pointer loop copies end - start: a pointer past the end names nothing', () => {
  assert.deepEqual(queue(romFor({ callee: 'dest-end', size: 0x10 }), VENEER, [MAIN, VENEER]), B, '+8 is inside 16 bytes');
  assert.deepEqual(queue(romFor({ callee: 'dest-end', size: 0x10, pointer: IWRAM + 0x14 }), VENEER, [MAIN, VENEER]), [], '+0x14 is past them');
  assert.deepEqual(queue(romFor({ callee: 'source-end', size: 0x10, pointer: IWRAM + 0x14 }), VENEER, [MAIN, VENEER]), []);
});

test('CpuFastSet rounds its word count up to a multiple of 8: 2 words move as 8', () => {
  // 2 words are 8 bytes, but the BIOS moves 32: C at +0x14 is copied too.
  assert.deepEqual(queue(romFor({ callee: 'cpufastset', size: 2, pointer: IWRAM + 0x14 }), VENEER, [MAIN, VENEER]), [{ entry: BLOCK + 0x14, mode: 'arm', cites: [VENEER, MAIN] }]);
  assert.deepEqual(queue(romFor({ callee: 'cpufastset', size: 2, pointer: IWRAM + 0x24 }), VENEER, [MAIN, VENEER]), [], 'past the 32 bytes moved');
});

const VIA = 0x0800_0280;

test('a jump through `bl` to a `bx rN` stub of the loaded register (_call_via_rN) names the entry', () => {
  const rom = romWith([
    { at: MAIN, bytes: thumbAt(MAIN)`push {lr}; ldr r0, _08000210; ldr r1, _08000214; ldr r2, _08000218; bl _08000240; pop {pc}` },
    { at: MAIN + 0x10, bytes: words(BLOCK, IWRAM, 0x20) },
    { at: COPY, bytes: CALLEES['src-first'] },
    // push {lr}; ldr r3, =IWRAM + 8; bl _call_via_r3; pop {pc}, the stub `bx r3` at VIA + 0x10.
    { at: VIA, bytes: thumbAt(VIA)`push {lr}; ldr r3, _0800028C; bl _08000290; pop {pc}` },
    { at: VIA + 0x0c, bytes: words(IWRAM + 8) },
    { at: VIA + 0x10, bytes: thumbAt(VIA + 0x10)`bx r3` },
    { at: BLOCK, bytes: armAt(BLOCK)`mov r0, #0; bx lr; add r0, r0, #1; add r0, r0, #2; bx lr; mov r0, #3; bx lr` },
  ]);
  assert.deepEqual(queue(rom, VIA, [MAIN, VIA]), [{ entry: BLOCK + 8, mode: 'arm', cites: [VIA, MAIN] }]);
  // A stub of another register does not jump through r3.
  const other = romWith([
    { at: MAIN, bytes: thumbAt(MAIN)`push {lr}; ldr r0, _08000210; ldr r1, _08000214; ldr r2, _08000218; bl _08000240; pop {pc}` },
    { at: MAIN + 0x10, bytes: words(BLOCK, IWRAM, 0x20) },
    { at: COPY, bytes: CALLEES['src-first'] },
    { at: VIA, bytes: thumbAt(VIA)`push {lr}; ldr r3, _0800028C; bl _08000290; pop {pc}` },
    { at: VIA + 0x0c, bytes: words(IWRAM + 8) },
    { at: VIA + 0x10, bytes: thumbAt(VIA + 0x10)`bx r4` },
    { at: BLOCK, bytes: armAt(BLOCK)`mov r0, #0; bx lr; add r0, r0, #1; add r0, r0, #2; bx lr; mov r0, #3; bx lr` },
  ]);
  assert.deepEqual(queue(other, VIA, [MAIN, VIA]), []);
});

const VENEER2 = 0x0800_0270;

/** main copies BLOCK = `block` (ARM) to IWRAM; VENEER and VENEER2 jump through IWRAM + first and IWRAM + second. */
function twoJumps(block: Uint8Array, first: number, second: number): Rom {
  return romWith([
    { at: MAIN, bytes: thumbAt(MAIN)`push {lr}; ldr r0, _08000210; ldr r1, _08000214; ldr r2, _08000218; bl _08000240; pop {pc}` },
    { at: MAIN + 0x10, bytes: words(BLOCK, IWRAM, 0x20) },
    { at: COPY, bytes: CALLEES['src-first'] },
    { at: VENEER, bytes: thumbAt(VENEER)`ldr r3, _08000268; bx r3` },
    { at: VENEER + 8, bytes: words(IWRAM + first) },
    { at: VENEER2, bytes: thumbAt(VENEER2)`ldr r3, _08000278; bx r3` },
    { at: VENEER2 + 8, bytes: words(IWRAM + second) },
    { at: BLOCK, bytes: block },
  ]);
}

// A = mov; bx lr. P = ldr r0, [pc, #0]; bx lr; its pool word 0x03001234 (an ARM `andeq`, not an exit). C = mov; bx lr.
const POOLED = new Uint8Array([...armAt(BLOCK)`mov r0, #0; bx lr; ldr r0, [pc, #0]; bx lr`, ...words(0x0300_1234), ...armAt(BLOCK + 0x14)`mov r0, #3; bx lr`]);

test('an entry right after a literal pool opens a function: a claimed pool, or a pool of another named entry', () => {
  const rom = twoJumps(POOLED, 0x14, 0x14);
  assert.deepEqual(queue(rom, VENEER, [MAIN, VENEER]), [], 'nothing says the word before C is data: it decodes as a conditional instruction');
  const v = viewWith({ rom, functions: [MAIN, VENEER], readings: [MAIN, VENEER].map((e) => viewWith({ rom }).read(e, 'thumb')), claims: [{ span: { start: BLOCK + 0x10, end: BLOCK + 0x14 }, kind: Claim.pool }] });
  assert.deepEqual(rule.queue(factOf(v.read(VENEER, 'thumb')), v), [{ entry: BLOCK + 0x14, mode: 'arm', cites: [VENEER, MAIN] }], 'a claimed pool word');
  // main accepted after both veneers: its copy pairs with both jumps in one call.
  const both = twoJumps(POOLED, 0x08, 0x14);
  assert.deepEqual(queue(both, MAIN, [VENEER, VENEER2, MAIN]), [
    { entry: BLOCK + 0x08, mode: 'arm', cites: [VENEER, MAIN] },
    { entry: BLOCK + 0x14, mode: 'arm', cites: [VENEER2, MAIN] },
  ], 'the pool of P, proposed with it');
  assert.deepEqual(queue(both, VENEER2, [MAIN, VENEER, VENEER2]), [{ entry: BLOCK + 0x14, mode: 'arm', cites: [VENEER2, MAIN] }], 'the pool of P, named by an earlier jump and not yet accepted');
});

test('an entry inside the code of a lower entry proposed with it is not proposed', () => {
  // X = mov; bx lr. A = cmp; beq L; bx lr; L: mov; bx lr. L follows an exit, but A's reading reaches it.
  const block = armAt(BLOCK)`mov r0, #0; bx lr; cmp r0, #0; beq _08000314; bx lr; mov r0, #1; bx lr`;
  assert.deepEqual(queue(twoJumps(block, 0x08, 0x14), MAIN, [VENEER, VENEER2, MAIN]), [{ entry: BLOCK + 0x08, mode: 'arm', cites: [VENEER, MAIN] }]);
  assert.deepEqual(queue(twoJumps(block, 0x14, 0x14), MAIN, [VENEER, VENEER2, MAIN]), [{ entry: BLOCK + 0x14, mode: 'arm', cites: [VENEER, MAIN] }], 'alone, L opens after `bx lr`');
});

/** main is `text` (its literal pool at MAIN + 0x18: BLOCK, IWRAM, 0x20), with the copy loop, the veneer and BLOCK of romFor. */
function setupRom(main: Uint8Array): Rom {
  return romWith([
    { at: MAIN, bytes: main },
    { at: MAIN + 0x18, bytes: words(BLOCK, IWRAM, 0x20) },
    { at: COPY, bytes: CALLEES['src-first'] },
    { at: VENEER, bytes: thumbAt(VENEER)`ldr r3, _08000268; bx r3` },
    { at: VENEER + 8, bytes: words(IWRAM + 8) },
    { at: VIA, bytes: thumbAt(VIA)`bx lr` },
    { at: BLOCK, bytes: armAt(BLOCK)`mov r0, #0; bx lr; add r0, r0, #1; add r0, r0, #2; bx lr; mov r0, #3; bx lr` },
  ]);
}

test('the argument scan stops before a branch target: the call reached from a `beq` after a return, or from a `bne` (overfitting-r2-1)', () => {
  // The arguments are loaded on a path that returns (`pop {pc}`); the call is reached only from the `beq`.
  // The call is the `beq` target, so the branch-target join stops the scan before it reaches the return.
  const exit = thumbAt(MAIN)`push {lr}; cmp r0, #0; beq _0800020E; ldr r0, _08000218; ldr r1, _0800021C; ldr r2, _08000220; pop {pc}; bl _08000240; pop {pc}`;
  assert.deepEqual(queue(setupRom(exit), VENEER, [MAIN, VENEER]), [], 'the loads before the return never flow into the call');
  // The loads fall into the call, but the `bne` reaches it too, with other values: a join point.
  const join = thumbAt(MAIN)`push {lr}; cmp r0, #0; bne _0800020C; ldr r0, _08000218; ldr r1, _0800021C; ldr r2, _08000220; bl _08000240; pop {pc}`;
  assert.deepEqual(queue(setupRom(join), VENEER, [MAIN, VENEER]), [], 'the call is a branch target');
  // A join point before the whole setup does not matter: the run from it to the call holds all three.
  const before = thumbAt(MAIN)`push {lr}; cmp r0, #0; beq _08000208; movs r3, #0; ldr r0, _08000218; ldr r1, _0800021C; ldr r2, _08000220; bl _08000240; pop {pc}`;
  assert.deepEqual(queue(setupRom(before), VENEER, [MAIN, VENEER]), B, 'the setup starts at the join point');
  // A call between the setup and the copy clobbers r0..r3.
  const call = thumbAt(MAIN)`push {lr}; ldr r0, _08000218; ldr r1, _0800021C; ldr r2, _08000220; bl _08000280; bl _08000240; pop {pc}`;
  assert.deepEqual(queue(setupRom(call), VENEER, [MAIN, VENEER]), [], 'the call in between forgets the arguments');
  const plain = thumbAt(MAIN)`push {lr}; ldr r0, _08000218; ldr r1, _0800021C; ldr r2, _08000220; bl _08000240; pop {pc}`;
  assert.deepEqual(queue(setupRom(plain), VENEER, [MAIN, VENEER]), B, 'the same setup, straight-line');
});

/** main's reading under `far` and `noret`, with the copy loop, the veneer and BLOCK of romFor, and main's literal pool at MAIN + `pool`. */
function scanRom(main: Uint8Array, pool: number): Rom {
  return romWith([
    { at: MAIN, bytes: main },
    { at: MAIN + pool, bytes: words(BLOCK, IWRAM, 0x20) },
    { at: COPY, bytes: CALLEES['src-first'] },
    { at: VENEER, bytes: thumbAt(VENEER)`ldr r3, _08000268; bx r3` },
    { at: VENEER + 8, bytes: words(IWRAM + 8) },
    { at: BLOCK, bytes: armAt(BLOCK)`mov r0, #0; bx lr; add r0, r0, #1; add r0, r0, #2; bx lr; mov r0, #3; bx lr` },
  ]);
}

/** The rule's proposals when the veneer is accepted after `entry`, whose reading has these far and noret `bl` sites (as settle decides them). */
function scanned(rom: Rom, entry: number, far: readonly number[] = [], noret: readonly number[] = []): unknown {
  const plain = viewWith({ rom });
  const walked = walkReading(plain, entry, 'thumb', REFERENCE_WALK, new Set(far), new Map(noret.map((a) => [a, 'walk.noreturn-call-before-noncode' as RuleId])));
  // The verdicts as the settle loop records them on the reading (reading.far, reading.noret).
  const main = withVerdicts(walked, { far, noret, blVerdicts: [], steps: [] });
  const v = viewWith({ rom, functions: [entry, VENEER], readings: [main, plain.read(VENEER, 'thumb')] });
  return rule.queue(factOf(v.read(VENEER, 'thumb')), v);
}

// One case per join point of the argument scan (straightLineBefore), each the only clause that decides it:
// without that join the scan reads the three loads before the call and proposes BLOCK + 8
// (overfitting-correctness-r0-1, r1-1). The exit and far/noret stops can lie right before an instruction
// only when that instruction is a join, so they never decide alone (the entry cases below).

test('the argument scan stops before a jump-table target: a case label that falls into the copy call', () => {
  // switch (r0): case 0 loads the arguments and falls into case 1, the call; the table names both.
  const head = thumbAt(MAIN)`push {lr}; ldr r1, _08000208; ldr r0, [r1, r0]; mov pc, r0`;
  const cases = thumbAt(MAIN + 0x14)`ldr r0, _08000220; ldr r1, _08000224; ldr r2, _08000228; bl _08000240; pop {pc}`;
  const main = (second: number): Uint8Array => new Uint8Array([...head, ...words(MAIN + 0x0c, MAIN + 0x14, second), ...cases]);
  const rom = scanRom(main(MAIN + 0x1a), 0x20);
  const read = walkReading(viewWith({ rom }), MAIN, 'thumb');
  assert.deepEqual(read.tables.map((t) => [...t.targets]), [[MAIN + 0x14, MAIN + 0x1a]], 'the table and its two case labels');
  assert.equal(read.branchTargets.includes(MAIN + 0x1a), false, 'the call is no branch target');
  assert.deepEqual(scanned(rom, MAIN), [], 'the call is a case label: the registers there come from the switch too');
  assert.deepEqual(scanned(scanRom(main(MAIN + 0x14), 0x20), MAIN), B, 'both labels at the loads: the run from them to the call holds all three');
});

test('the argument scan stops before the target of a far `bl`: code the reading reaches by a `bl` walked as a jump', () => {
  // A far `bl` at +6 jumps to the call at +0x10; the loads before the call fall into it from the `beq` path.
  const main = thumbAt(MAIN)`push {lr}; cmp r0, #0; beq _0800020A; bl _08000210; ldr r0, _08000218; ldr r1, _0800021C; ldr r2, _08000220; bl _08000240; pop {pc}`;
  const rom = scanRom(main, 0x18);
  assert.equal(walkReading(viewWith({ rom }), MAIN, 'thumb', REFERENCE_WALK, new Set([MAIN + 6])).branchTargets.includes(MAIN + 0x10), false, 'the call is no branch target');
  assert.deepEqual(scanned(rom, MAIN, [MAIN + 6]), [], 'the call is the far `bl` target: other values reach it');
  // Walked as a call that returns, the `bl` still enters the copy call with the caller's r0..r2: a join too.
  assert.deepEqual(scanned(rom, MAIN), [], 'the call is the target of a returning `bl`');
});

test('the argument scan stops before the target of a `bl` that never returns: the copy call the reading also falls into', () => {
  // The `bl` at +6 never returns; the call at +0x10, its target, is reached by fall-through from the loads
  // on the `beq` path. The `bl` enters it with other values (code-quality-r1-3).
  const main = thumbAt(MAIN)`push {lr}; cmp r0, #0; beq _0800020A; bl _08000210; ldr r0, _08000218; ldr r1, _0800021C; ldr r2, _08000220; bl _08000240; pop {pc}`;
  const rom = scanRom(main, 0x18);
  const read = walkReading(viewWith({ rom }), MAIN, 'thumb', REFERENCE_WALK, new Set(), new Map([[MAIN + 6, 'walk.noreturn-call-before-noncode' as RuleId]]));
  assert.ok(read.blSites.some((b) => b.site === MAIN + 6 && b.target === MAIN + 0x10) && !read.branchTargets.includes(MAIN + 0x10), 'a call site the reading records; the call is no branch target');
  assert.deepEqual(scanned(rom, MAIN, [], [MAIN + 6]), [], 'the call is the noreturn `bl` target');
  // The same loads with the `bl` aimed past the copy call: no join between them and the call.
  const past = thumbAt(MAIN)`push {lr}; cmp r0, #0; beq _0800020A; bl _08000214; ldr r0, _08000218; ldr r1, _0800021C; ldr r2, _08000220; bl _08000240; pop {pc}`;
  assert.deepEqual(scanned(scanRom(past, 0x18), MAIN, [], [MAIN + 6]), B, 'the `bl` enters after the call: the loads reach it');
});

test('the argument scan stops at the reading\'s entry: code laid out before it, reached by a backward branch, ending in an exit', () => {
  // The entry is the call itself (+8); the loads before it, reached only by the `beq` back to +0, end in
  // `bx lr`, so they never flow into the entry. Nothing branches to the entry, but it is a join: control
  // enters there from the caller (overfitting-correctness-r1-1); the exit stop agrees and does not decide.
  const main = thumbAt(MAIN)`ldr r0, _08000214; ldr r1, _08000218; ldr r2, _0800021C; bx lr; bl _08000240; cmp r0, #0; beq _08000200; bx lr`;
  const rom = scanRom(main, 0x14);
  const read = walkReading(viewWith({ rom }), MAIN + 8, 'thumb');
  assert.ok(read.insnAt.has(MAIN + 6) && !read.branchTargets.includes(MAIN + 8), 'the `bx lr` before the entry is in the reading; the entry is no branch target');
  assert.deepEqual(scanned(rom, MAIN + 8), [], 'the loads before the return never flow into the call');
});

test('the argument scan stops at the reading\'s entry, whatever the `bl` laid out before it does', () => {
  // r4..r6 are loaded before a `bl` to +0x1A; the entry at +0x0A copies them into r0..r2 for the copy call.
  // The scan reads the three copies and stops at the entry: r4..r6 there are the caller's, unknown, so
  // nothing is proposed, whether the `bl` before it never returns, jumps, or returns (overfitting-correctness-r1-1).
  const main = thumbAt(MAIN)`ldr r4, _0800021C; ldr r5, _08000220; ldr r6, _08000224; bl _0800021A; adds r0, r4, #0; adds r1, r5, #0; adds r2, r6, #0; bl _08000240; cmp r0, #0; beq _08000200; bx lr; bx lr`;
  const rom = scanRom(main, 0x1c);
  const entry = MAIN + 0x0a;
  assert.equal(walkReading(viewWith({ rom }), entry, 'thumb', REFERENCE_WALK, new Set(), new Map([[MAIN + 6, 'walk.noreturn-call-before-noncode' as RuleId]])).branchTargets.includes(entry), false, 'the entry is no branch target');
  assert.deepEqual(scanned(rom, entry, [], [MAIN + 6]), [], 'a call that never returns');
  assert.deepEqual(scanned(rom, entry, [MAIN + 6]), [], 'a `bl` walked as a jump');
  assert.deepEqual(scanned(rom, entry), [], 'a call that returns falls into the entry, but the entry is a join');
  // Read from +0, the same code proposes BLOCK + 8: the loads of r4..r6 flow through the returning call and
  // the copies into the copy call, with no join between them (the `bl`'s target +0x1A lies past the call).
  assert.deepEqual(scanned(rom, MAIN), [{ entry: BLOCK + 8, mode: 'arm', cites: [VENEER, MAIN] }], 'from +0 the run holds the loads');
});

test('the jump window is the profile\'s ramCopy.jumpInsns: a jump that many instructions after the load is found, one window shorter it is not (code-quality-r2-1)', () => {
  const n = AGBCC.ramCopy.jumpInsns;
  assert.equal(n, 8, 'the profile value this test pins');
  // The veneer loads IWRAM + 8 into r3, runs n - 1 instructions that leave r3 alone, then `bx r3`: the jump is
  // the n-th instruction after the load. Its pool word follows at VENEER + 0x14.
  const fillers = Array.from({ length: n - 1 }, () => 'movs r0, #1').join('; ');
  const veneer = thumbAt(VENEER)`ldr r3, _08000274; ${fillers}; bx r3`;
  assert.equal(veneer.length, 2 * (n + 1));
  const rom = romWith([
    { at: MAIN, bytes: thumbAt(MAIN)`push {lr}; ldr r0, _08000210; ldr r1, _08000214; ldr r2, _08000218; bl _08000240; pop {pc}` },
    { at: MAIN + 0x10, bytes: words(BLOCK, IWRAM, 0x20) },
    { at: COPY, bytes: CALLEES['src-first'] },
    { at: VENEER, bytes: veneer },
    { at: VENEER + 0x14, bytes: words(IWRAM + 8) },
    { at: BLOCK, bytes: armAt(BLOCK)`mov r0, #0; bx lr; add r0, r0, #1; add r0, r0, #2; bx lr; mov r0, #3; bx lr` },
  ]);
  const run = (jumpInsns: number) => {
    const profile = { ...AGBCC, ramCopy: { ...AGBCC.ramCopy, jumpInsns } };
    const plain = viewWith({ rom, profile });
    const v = viewWith({ rom, profile, functions: [MAIN, VENEER], readings: [MAIN, VENEER].map((e) => plain.read(e, 'thumb')) });
    return rule.queue(factOf(v.read(VENEER, 'thumb')), v);
  };
  assert.deepEqual(run(n), B, 'an adequate window: the profile\'s');
  assert.deepEqual(run(n - 1), [], 'a window one shorter misses the jump');
});
