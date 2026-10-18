// Data and padding in code (architecture §5, D16): `.align 2, 0` for zeros up to a word boundary, anything
// else as naturally aligned .byte/.2byte/.4byte lines carrying the item's note.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ALIGN_LINE, dataLines, isAlignPadding, noteLines, paddingLines } from '../../../../src/core/emit/print/data.ts';
import { romWith, words } from '../../../helpers/model.ts';

const AT = 0x0800_0300;
const rom = romWith([{ at: AT, bytes: words(0x44332211, 0x88776655, 0xccbbaa99, 0x00ffeedd, 0x01020304, 0x05060708) }]);

test('data splits into a leading byte, a halfword to the word, words four to a line, then a halfword and a byte', () => {
  assert.deepEqual(dataLines(rom, { start: AT + 1, end: AT + 0x17 }), [
    '\t.byte 0x22',
    '\t.2byte 0x4433',
    '\t.4byte 0x88776655, 0xCCBBAA99, 0x00FFEEDD, 0x01020304',
    '\t.2byte 0x0708',
    '\t.byte 0x06',
  ]);
  assert.deepEqual(dataLines(rom, { start: AT, end: AT + 4 }), ['\t.4byte 0x44332211']);
  assert.deepEqual(dataLines(rom, { start: AT, end: AT }), []);
});

test('each line of a noted data item carries its note', () => {
  assert.deepEqual(noteLines(rom, { start: AT + 2, end: AT + 8 }, 'dead'), ['\t.2byte 0x4433 @ dead', '\t.4byte 0x88776655 @ dead']);
  assert.deepEqual(noteLines(rom, { start: AT, end: AT + 1 }, 'mixer-hole'), ['\t.byte 0x11 @ mixer hole']);
  assert.deepEqual(noteLines(rom, { start: AT, end: AT + 2 }, 'unreached'), ['\t.2byte 0x2211 @ unreached']);
  assert.deepEqual(noteLines(rom, { start: AT, end: AT + 2 }, undefined), ['\t.2byte 0x2211']);
});

test('padding is .align 2, 0 only for zeros that end on a word boundary; anything else stays bytes', () => {
  const zeros = AT + 0x20;
  assert.equal(isAlignPadding(rom, { start: zeros + 2, end: zeros + 4 }), true);
  assert.equal(isAlignPadding(rom, { start: zeros + 1, end: zeros + 4 }), true);
  assert.deepEqual(paddingLines(rom, { start: zeros + 2, end: zeros + 4 }), [ALIGN_LINE]);
  assert.equal(ALIGN_LINE, '\t.align 2, 0');
  assert.equal(isAlignPadding(rom, { start: zeros, end: zeros + 2 }), false, 'does not end on a word boundary');
  assert.equal(isAlignPadding(rom, { start: zeros, end: zeros + 4 }), false, '.align 2 pads nothing at a word boundary');
  assert.deepEqual(paddingLines(rom, { start: AT + 0xe, end: AT + 0x10 }), ['\t.2byte 0x00FF @ padding'], 'nonzero bytes print as data');
});
