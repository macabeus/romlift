// Instruction items (architecture §5, D14, D15): a mnemonic through format with the module's resolver, a
// PC-relative load naming its word, raw items as `.inst.n`/`.inst.w`/`.inst` with the decoding and the
// reason, an item the model kept no row for, and the branch and pool-load flags the statistics count.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { printInsn, printRawInsn, printUndecodedInsn } from '../../../../src/core/emit/print/insn.ts';
import type { InsnContext } from '../../../../src/core/emit/print/insn.ts';
import type { SymbolResolver } from '../../../../src/foundation/isa/types.ts';
import { armAt } from '../../../helpers/arm.ts';
import { insnAt, romWith, words } from '../../../helpers/model.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const T = 0x0800_0200;
const P = 0x0800_0240;
const rom = romWith([
  { at: T, bytes: thumbAt(T)`ldr r0, _08000208; b _08000200; bl _08000200; movs r0, #1` },
  { at: T + 0x10, bytes: armAt(T + 0x10)`ldr r1, _08000240; bl _08000200` },
  { at: P, bytes: words(0x0300_1234) },
]);
const names = new Map([
  [T, 'Loop'],
  [T + 8, '_08000208'],
  [P, '_08000240'],
]);
const resolver: SymbolResolver = {
  labelFor: (addr) => names.get(addr),
  addressOf: (name) => [...names.entries()].find(([, n]) => n === name)?.[0],
};
const cx: InsnContext = {
  resolver,
  adrResolver: resolver,
  poolOperand: (addr) => (addr === T + 8 ? 'gWord' : addr === P ? '0x03001234' : undefined),
};
const none: InsnContext = {
  resolver: { labelFor: () => undefined, addressOf: () => undefined },
  adrResolver: { labelFor: () => undefined, addressOf: () => undefined },
  poolOperand: () => undefined,
};

test('a PC-relative load prints its pool label and names the word in a comment', () => {
  assert.deepEqual(printInsn(insnAt(rom, T, 'thumb'), cx), {
    line: '\tldr r0, _08000208 @ =gWord',
    mode: 'thumb',
    branch: false,
    poolLoad: true,
  });
  assert.deepEqual(printInsn(insnAt(rom, T + 0x10, 'arm'), cx), {
    line: '\tldr r1, _08000240 @ =0x03001234',
    mode: 'arm',
    branch: false,
    poolLoad: true,
  });
});

test('b and bl print to their labels and count as branches', () => {
  assert.deepEqual(printInsn(insnAt(rom, T + 2, 'thumb'), cx), {
    line: '\tb Loop',
    mode: 'thumb',
    branch: true,
    poolLoad: false,
  });
  assert.deepEqual(printInsn(insnAt(rom, T + 4, 'thumb'), cx), {
    line: '\tbl Loop',
    mode: 'thumb',
    branch: true,
    poolLoad: false,
  });
  assert.equal(printInsn(insnAt(rom, T + 0x14, 'arm'), cx).line, '\tbl Loop');
  assert.deepEqual(printInsn(insnAt(rom, T + 8, 'thumb'), cx), {
    line: '\tmovs r0, #1',
    mode: 'thumb',
    branch: false,
    poolLoad: false,
  });
});

test('an instruction whose label is missing falls back to raw no-roundtrip with its numeric decoding', () => {
  const printed = printInsn(insnAt(rom, T + 2, 'thumb'), none);
  assert.equal(printed.rawReason, 'no-roundtrip');
  assert.match(printed.line, /^\t\.inst\.n 0x[0-9A-F]{4} @ b 0x08000200 \(no-roundtrip\)$/);
  assert.equal(printed.branch, true);
});

test('a raw item prints .inst.n, .inst.w (first halfword first) or .inst with its decoding and reason', () => {
  const short = printRawInsn(insnAt(rom, T + 2, 'thumb'), 'cross-module-short-branch');
  assert.match(short.line, /^\t\.inst\.n 0x[0-9A-F]{4} @ b 0x08000200 \(cross-module-short-branch\)$/);
  const pair = printRawInsn(insnAt(rom, T + 4, 'thumb'), 'no-roundtrip');
  const first = rom.bytes[T + 4 - rom.base]! | (rom.bytes[T + 5 - rom.base]! << 8);
  assert.ok(pair.line.startsWith(`\t.inst.w 0x${first.toString(16).toUpperCase().padStart(4, '0')}`), pair.line);
  assert.match(
    printRawInsn(insnAt(rom, T + 0x14, 'arm'), 'no-roundtrip').line,
    /^\t\.inst 0x[0-9A-F]{8} @ bl 0x08000200 \(no-roundtrip\)$/,
  );
});

test('an item the model kept no row for prints its bytes by state and length', () => {
  assert.deepEqual(printUndecodedInsn(rom, { start: T + 8, end: T + 10 }, 'thumb', 'undefined'), {
    line: '\t.inst.n 0x2001 @ (undefined)',
    mode: 'thumb',
    rawReason: 'undefined',
    branch: false,
    poolLoad: false,
  });
  assert.match(
    printUndecodedInsn(rom, { start: T + 4, end: T + 8 }, 'thumb', 'undefined').line,
    /^\t\.inst\.w 0x[0-9A-F]{8} @ \(undefined\)$/,
  );
  assert.match(
    printUndecodedInsn(rom, { start: T + 0x10, end: T + 0x14 }, 'arm', 'undefined').line,
    /^\t\.inst 0x[0-9A-F]{8} @ \(undefined\)$/,
  );
});

test('an adr names its target through the adr resolver, which never names a Thumb function (D72 c); a branch keeps the function', () => {
  const at = 0x0800_0300;
  const r = romWith([{ at, bytes: thumbAt(at)`adr r6, _08000308; bl _08000308` }]);
  const func: SymbolResolver = {
    labelFor: (a) => (a === at + 8 ? 'Func' : undefined),
    addressOf: (n) => (n === 'Func' ? at + 8 : undefined),
  };
  const local: SymbolResolver = {
    labelFor: (a) => (a === at + 8 ? '_08000308' : undefined),
    addressOf: (n) => (n === '_08000308' ? at + 8 : undefined),
  };
  const adr = { resolver: func, adrResolver: local, poolOperand: () => undefined };
  assert.deepEqual(printInsn(insnAt(r, at, 'thumb'), adr), {
    line: '\tadr r6, _08000308',
    mode: 'thumb',
    branch: false,
    poolLoad: false,
  });
  assert.equal(printInsn(insnAt(r, at + 2, 'thumb'), adr).line, '\tbl Func');
  assert.deepEqual(
    printInsn(insnAt(r, at, 'thumb'), { ...adr, adrResolver: none.adrResolver }).rawReason,
    'no-roundtrip',
    'no label for the adr: raw',
  );
});
