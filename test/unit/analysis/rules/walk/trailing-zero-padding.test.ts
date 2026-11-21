// walk.trailing-zero-padding: zero halfwords before non-code are padding (analyzeThumb's
// `while (run.length && rom.u16(last) === 0)`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { romWith, viewWith, walkReading, words } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { WALK, cursorOf, insnAt, walkRule, without } from './support.ts';

const F = 0x0800_0200;
const T = 0x0800_0280;
const ID = 'walk.trailing-zero-padding';
const INVALID = Uint8Array.from([0x00, 0xb1]);

test('zero halfwords between a bl and its pool are dropped, and the bl then ends the path', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`ldr r0, _0800020C; bl _08000280; lsls r0, r0, #0; lsls r0, r0, #0` },
    { at: F + 0x0c, bytes: words(7) },
    { at: T, bytes: thumbAt(T)`bx lr` },
  ]);
  const r = walkReading(viewWith({ rom }), F, 'thumb', WALK);
  assert.deepEqual(
    r.insns.map((i) => i.addr - F),
    [0, 2],
    'both zero halfwords dropped',
  );
  assert.deepEqual(r.deadEnd, [F + 2]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.codeEnd, F + 6);
  assert.equal(r.end, F + 0x10, 'the pool after the padding is in the extent');
  const bare = walkReading(viewWith({ rom }), F, 'thumb', without(ID));
  assert.deepEqual(bare.deadEnd, []);
  assert.deepEqual(
    bare.errors,
    [{ reason: 'not-code', at: F + 0x0c }],
    'without the rule the zero halfword is last, so the stop is an error',
  );
});

test('padding before an undecodable halfword too; a zero run with nothing else before it is still not code', () => {
  const rom = romWith([
    { at: F, bytes: Uint8Array.from([...thumbAt(F)`swi #0; lsls r0, r0, #0`, ...INVALID]) },
    { at: F + 0x20, bytes: Uint8Array.from([...thumbAt(F + 0x20)`lsls r0, r0, #0`, ...INVALID]) },
  ]);
  const v = viewWith({ rom });
  const r = walkReading(v, F, 'thumb', WALK);
  assert.deepEqual(
    r.insns.map((i) => i.addr),
    [F],
  );
  assert.deepEqual(
    r.exits.map((e) => e.kind),
    ['swi-end'],
  );
  const zeros = walkReading(v, F + 0x20, 'thumb', WALK);
  assert.deepEqual(zeros.insns, []);
  assert.deepEqual(zeros.errors, [{ reason: 'not-code', at: F + 0x22 }]);
});

test('declines: a nonzero last instruction, the insn phase, and ARM', () => {
  const rom = romWith([{ at: F, bytes: Uint8Array.from([...thumbAt(F)`lsls r0, r0, #0; movs r0, #1`, ...INVALID]) }]);
  const v = viewWith({ rom });
  const rule = walkRule(ID);
  const zero = insnAt(rom, F, 'thumb');
  assert.deepEqual(
    rule.onInsn(zero, cursorOf(v, { entry: F, mode: 'thumb', phase: 'stop', stop: 'invalid', at: F + 4 })),
    { step: 'padding' },
  );
  assert.equal(
    rule.onInsn(
      insnAt(rom, F + 2, 'thumb'),
      cursorOf(v, { entry: F, mode: 'thumb', phase: 'stop', stop: 'invalid', at: F + 4 }),
    ),
    undefined,
  );
  assert.equal(rule.onInsn(zero, cursorOf(v, { entry: F, mode: 'thumb' })), undefined);
  assert.equal(rule.onInsn(zero, cursorOf(v, { entry: F, mode: 'arm', phase: 'stop' })), undefined);
  assert.deepEqual(walkReading(v, F, 'thumb', WALK).errors, [{ reason: 'not-code', at: F + 4 }]);
});
