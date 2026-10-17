import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decode } from '../../../../src/foundation/isa/decode.ts';
import { walkFlow } from '../../../../src/core/analysis/walk/arm.ts';
import { romWith, viewWith, walkReading, words } from '../../../helpers/analysis.ts';
import { armAt } from '../../../helpers/arm.ts';

const F = 0x0800_0200;

test('mov lr, pc; bx rN is a call; a conditional return counts and the path goes on', () => {
  const rom = romWith([{ at: F, bytes: armAt(F)`mov lr, pc; bx r1; bxeq lr; bx lr` }]);
  const r = walkReading(viewWith({ rom }), F, 'arm');
  assert.equal(r.insns.length, 4);
  assert.equal(r.returns, 2);
  assert.deepEqual(r.balance, [], 'the ARM walk tracks no stack');
  assert.deepEqual(r.errors, []);
});

test('ARM pools, bl calls, adr targets, and a branch below the entry is a tail', () => {
  const rom = romWith([{ at: F, bytes: armAt(F)`ldr r0, _08000220; adr r1, _08000240; bl _08000300; b _08000100` }, { at: F + 0x20, bytes: words(7) }]);
  const v = viewWith({ rom });
  const r = walkReading(v, F, 'arm');
  assert.deepEqual(r.pools, [{ addr: F + 0x20, value: 7 }]);
  assert.deepEqual(r.adrs, [F + 0x40]);
  assert.deepEqual(r.calls, [{ site: F + 8, target: 0x0800_0300, mode: 'arm' }]);
  assert.deepEqual(r.exits.map((e) => e.kind), ['tail']);
  assert.deepEqual(r.tails, [], 'the ARM walk records no tail targets');
});

test("the walk uses the PoC's classes where the decoder differs on purpose", () => {
  const addPc = decode('arm', 0xe28ff004, F);
  assert.notEqual(addPc.flow.kind, 'adr');
  assert.deepEqual(walkFlow(addPc), { kind: 'adr', target: F + 12 });
  const subPc = decode('arm', 0xe24ff004, F);
  assert.deepEqual(walkFlow(subPc), { kind: 'adr', target: F + 4 });
  const ldrd = decode('arm', 0xe1c000d0, F);
  assert.equal(ldrd.specId, 'arm.ldrd_strd');
  assert.equal(ldrd.flow.kind, 'invalid');
  assert.deepEqual(walkFlow(ldrd), { kind: 'next' });
  const ordinary = decode('arm', 0xe12fff1e, F);
  assert.equal(walkFlow(ordinary), ordinary.flow);
  const rom = romWith([{ at: F, bytes: Uint8Array.from([...words(0xe28ff004, 0xe1c000d0), ...armAt(F + 8)`bx lr`]) }]);
  const r = walkReading(viewWith({ rom }), F, 'arm');
  assert.equal(r.insns.length, 3, 'add pc, pc is not a jump to the PoC, and ldrd walks on');
  assert.deepEqual(r.adrs, [F + 12]);
});
