// registerEffect (foundation/isa.ts): the package's register effects with romlift's readings (D121 i, j).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decode, registerEffect } from '../../../src/foundation/isa.ts';

const A = 0x0800_0100;

test('an ARM instruction has its own register effect', () => {
  // mov r0, r1
  assert.deepEqual(registerEffect(decode('arm', 0xe1a0_0001, A)), { writes: 1 << 0, from: [1] });
  // cmp r0, r1 writes no register
  assert.equal(registerEffect(decode('arm', 0xe150_0001, A)).writes, 0);
});

test('a call adds what the callee may change, in both modes', () => {
  const callee = (1 << 14) | (1 << 12) | 0b1111;
  assert.equal(registerEffect(decode('arm', 0xeb00_0000, A)).writes, callee, 'ARM bl');
  assert.equal(registerEffect(decode('thumb', 0xf802_f001, A)).writes, callee, 'Thumb bl');
  assert.equal(registerEffect(decode('thumb', 0xdf0b, A)).writes, 0b1111, 'swi');
});

test('half a bl and a Thumb write to pc have no register effect', () => {
  assert.equal(registerEffect(decode('thumb', 0xf001, A)).writes, 0, 'bl prefix');
  assert.equal(registerEffect(decode('thumb', 0xf802, A)).writes, 0, 'bl suffix');
  assert.equal(registerEffect(decode('thumb', 0x4687, A)).writes, 0, 'mov pc, r0');
});
