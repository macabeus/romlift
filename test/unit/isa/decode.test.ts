// The decode helpers the analysis reads instead of decoding by hand: isConditional (from a row's 'cond'
// field) and thumbWordAt (a halfword with the next one above it, for a bl pair).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decode,
  isConditional,
  isThumbBlPrefix,
  isThumbBlSuffix,
  thumbMayBranchShort,
  thumbMayName,
  thumbMayReachPcRelative,
  thumbWordAt,
} from '../../../src/foundation/isa/decode.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';

const A = 0x0800_0200;

test("isConditional reads the row's condition field: ARM al is unconditional, any other condition and the NV space are not; Thumb only for bcc", () => {
  assert.equal(isConditional(decode('arm', 0xe3a00001, A)), false, 'mov r0, #1');
  assert.equal(isConditional(decode('arm', 0x03a00001, A)), true, 'moveq r0, #1');
  assert.equal(isConditional(decode('arm', 0x112fff10, A)), true, 'bxne r0');
  assert.equal(isConditional(decode('arm', 0xf3a00001, A)), true, 'the NV space');
  assert.equal(isConditional(decode('thumb', 0x2001, A)), false, 'movs r0, #1');
  assert.equal(isConditional(decode('thumb', 0xd000, A)), true, 'beq');
  assert.equal(isConditional(decode('thumb', 0xe000, A)), false, 'b');
});

test('thumbWordAt pairs a halfword with the next one, and reads zero past the end of the ROM', () => {
  const bytes = new Uint8Array(0x200);
  bytes.set([0x01, 0xf0, 0x02, 0xf8], 0x100);
  bytes.set([0xc0, 0x46], 0x1fe);
  const rom = romFromBytes(bytes, 'test');
  assert.equal(thumbWordAt(rom, 0x0800_0100), 0xf802_f001);
  assert.equal(decode('thumb', thumbWordAt(rom, 0x0800_0100), 0x0800_0100).flow.kind, 'bl');
  assert.equal(thumbWordAt(rom, 0x0800_01fe), 0x46c0, 'the last halfword has nothing above it');
});

test('the Thumb prefilters admit every halfword whose decode names an address alone, and the bl halves', () => {
  for (let hw = 0; hw < 0x10000; hw++) {
    const kind = decode('thumb', hw, 0x0800_0000).flow.kind;
    if (kind === 'branch' || kind === 'pool-load' || kind === 'adr') assert.ok(thumbMayName(hw), hw.toString(16));
    if (kind === 'branch') assert.ok(thumbMayBranchShort(hw), hw.toString(16));
    if (kind === 'pool-load' || kind === 'adr') assert.ok(thumbMayReachPcRelative(hw), hw.toString(16));
    if (thumbMayName(hw)) assert.ok(!isThumbBlPrefix(hw) && !isThumbBlSuffix(hw), hw.toString(16));
  }
  assert.equal(decode('thumb', (0xf800 << 16) | 0xf000, 0x0800_0000).flow.kind, 'bl');
  assert.ok(isThumbBlPrefix(0xf123) && isThumbBlSuffix(0xf923) && !isThumbBlPrefix(0xf923));
});
