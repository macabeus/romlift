// printRawRange, the port of the PoC's rawLines (architecture §5 "Raw printer"): runs of at most 8
// halfwords, a label flushing the run and printing `name: @ ADDR[, note]`, a pool or table word printed
// `.4byte` only when word-aligned, inside the range and not cut by a label, an odd tail byte, upper-case hex.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { printRawRange } from '../../../../src/core/emit/print/raw.ts';
import { romWith } from '../../../helpers/model.ts';

const AT = 0x0800_0200;
const bytes = Uint8Array.from({ length: 0x40 }, (_, i) => (i * 0x11 + 0x0a) & 0xff);
const rom = romWith([{ at: AT, bytes }]);
const none = (): boolean => false;
const half = (a: number): string => `0x${(bytes[a - AT + 1] ?? 0).toString(16).toUpperCase().padStart(2, '0')}${(bytes[a - AT] ?? 0).toString(16).toUpperCase().padStart(2, '0')}`;
const halves = (from: number, n: number): string => Array.from({ length: n }, (_, i) => half(from + 2 * i)).join(', ');

test('halfwords print in runs of at most 8 per .2byte line', () => {
  assert.deepEqual(printRawRange(rom, none, AT, AT + 20, []), [`\t.2byte ${halves(AT, 8)}`, `\t.2byte ${halves(AT + 16, 2)}`]);
});

test('a label flushes the run, prints `name: @ ADDR, note`, and a run before it closes at the label', () => {
  const lines = printRawRange(rom, none, AT, AT + 12, [{ addr: AT + 6, name: 'loc_08000206', note: 'thumb entry' }, { addr: AT + 8, name: 'plain' }]);
  assert.deepEqual(lines, [`\t.2byte ${halves(AT, 3)}`, 'loc_08000206: @ 08000206, thumb entry', `\t.2byte ${half(AT + 6)}`, 'plain: @ 08000208', `\t.2byte ${halves(AT + 8, 2)}`]);
});

test('labels at the start or outside the range are not printed; the later of two at one address wins', () => {
  const lines = printRawRange(rom, none, AT, AT + 4, [{ addr: AT, name: 'Self' }, { addr: AT + 4, name: 'Next' }, { addr: AT + 2, name: 'first' }, { addr: AT + 2, name: 'second' }]);
  assert.deepEqual(lines, [`\t.2byte ${half(AT)}`, 'second: @ 08000202', `\t.2byte ${half(AT + 2)}`]);
});

test('a pool or table word prints .4byte only word-aligned, inside the range and not cut by a label', () => {
  const words = (a: number): boolean => a >= AT + 4 && a < AT + 0x10;
  const word = (a: number): string => `\t.4byte 0x${[3, 2, 1, 0].map((i) => (bytes[a - AT + i] ?? 0).toString(16).toUpperCase().padStart(2, '0')).join('')}`;
  assert.deepEqual(printRawRange(rom, words, AT + 2, AT + 0x10, []), [`\t.2byte ${half(AT + 2)}`, word(AT + 4), word(AT + 8), word(AT + 12)]);
  // the range ends inside the word: it prints as halfwords
  assert.deepEqual(printRawRange(rom, words, AT + 4, AT + 6, []), [`\t.2byte ${half(AT + 4)}`]);
  // a label at a + 2 cuts the word into two halfwords around the label
  assert.deepEqual(printRawRange(rom, words, AT + 4, AT + 8, [{ addr: AT + 6, name: 'mid' }]), [`\t.2byte ${half(AT + 4)}`, 'mid: @ 08000206', `\t.2byte ${half(AT + 6)}`]);
  // a word at 2 mod 4 is never a .4byte
  assert.deepEqual(printRawRange(rom, () => true, AT + 2, AT + 6, []), [`\t.2byte ${halves(AT + 2, 2)}`]);
});

test('an odd tail byte prints .byte after flushing the run; an odd start reads halfwords from it, as the PoC', () => {
  const byte = (a: number): string => `\t.byte 0x${(bytes[a - AT] ?? 0).toString(16).toUpperCase().padStart(2, '0')}`;
  assert.deepEqual(printRawRange(rom, none, AT, AT + 5, []), [`\t.2byte ${halves(AT, 2)}`, byte(AT + 4)]);
  assert.deepEqual(printRawRange(rom, none, AT + 1, AT + 4, []), [`\t.2byte ${half(AT + 1)}`, byte(AT + 3)]);
  assert.deepEqual(printRawRange(rom, none, AT, AT, []), []);
});
