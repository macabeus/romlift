import assert from 'node:assert/strict';
import { test } from 'node:test';

import adr from '../../../../../src/core/analysis/rules/seed/adr.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { factOf } from './fact.ts';

const F = 0x0800_0100;

/** `mov r0, #1; bx lr` at every word of [from, to): ARM code wherever an adr lands. */
function armEverywhere(from: number, to: number) {
  const parts = [];
  for (let a = from; a < to; a += 8) parts.push({ at: a, bytes: armAt(a)`mov r0, #1; bx lr` });
  return parts;
}

test('adr targets of an ARM function in the ROM, word-aligned and above the entry, ascending, as ARM', () => {
  const rom = romWith([...armEverywhere(F, 0x0800_0400 - 8), { at: 0x0800_03fc, bytes: armAt(0x0800_03fc)`bx lr` }], {
    size: 0x400,
  });
  const adrs = [0x0800_0300, F - 4, F, F + 8, 0x0800_0202, rom.end - 4, rom.end];
  const f = factOf(readingOf(rom, { entry: F, mode: 'arm' }), { adrs });
  assert.deepEqual(adr.queue(f, viewWith({ rom })), [
    { entry: F + 8, mode: 'arm', cites: [F] },
    { entry: 0x0800_0300, mode: 'arm', cites: [F] },
    { entry: rom.end - 4, mode: 'arm', cites: [F] },
  ]);
});

test("a Thumb function's add rd, pc targets are not proposed", () => {
  const rom = romWith([]);
  const f = factOf(readingOf(rom, { entry: F }), { adrs: [F + 0x40] });
  assert.deepEqual(adr.queue(f, viewWith({ rom })), []);
  assert.equal(adr.meta.origin, 'adr');
});

test('declined (D60 g): a claimed word (a label inside the own extent is code it claims), words that do not read as ARM code', () => {
  const rom = romWith([...armEverywhere(F, F + 0x40), { at: F + 0x40, bytes: new Uint8Array(8).fill(0xff) }]);
  const fact = (adrs: number[], end = F + 0x10) =>
    factOf(readingOf(rom, { entry: F, mode: 'arm' }), { adrs, extent: { start: F, end } });
  // The accepted function's extent is claimed as code when its queue rules run: a return label inside it is a claimed word.
  const own = viewWith({ rom, claims: [{ span: { start: F, end: F + 0x10 }, kind: Claim.code }] });
  assert.deepEqual(adr.queue(fact([F + 8]), own), [], 'inside [entry, extent end): a return label, claimed as code');
  assert.deepEqual(
    adr.queue(fact([F + 0x10]), own)?.map((p) => p.entry),
    [F + 0x10],
    'the extent end itself opens the next function',
  );
  assert.deepEqual(
    adr.queue(
      fact([F + 0x18]),
      viewWith({ rom, claims: [{ span: { start: F + 0x18, end: F + 0x1c }, kind: Claim.pool }] }),
    ),
    [],
    'a claimed word',
  );
  assert.deepEqual(adr.queue(fact([F + 0x40]), viewWith({ rom })), [], 'undefined ARM words');
});
