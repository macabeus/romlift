// region.data-after-code: the free bytes after the greatest extent end are data.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/region/data-after-code.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import { BASE, readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { fact, ownerOver } from './facts.ts';

const rom = romWith([], { size: 0x1000 });

test('the free bytes from the greatest extent end to the ROM end are data', () => {
  const facts = [fact(BASE + 0x200, BASE + 0x280, 'call'), fact(BASE + 0x100, BASE + 0x180, 'call')];
  const v = viewWith({ rom, functions: [BASE + 0x100, BASE + 0x200], owner: ownerOver(facts) });
  assert.deepEqual(rule.classify(v), [{ span: { start: BASE + 0x280, end: rom.end }, kind: Claim.data, when: 'free-bytes' }]);
});

test('a function with an empty extent counts its accepted reading\'s end', () => {
  const r = readingOf(rom, { entry: BASE + 0x300 });
  const v = viewWith({ rom, functions: [BASE + 0x300], readings: [r], owner: () => undefined });
  assert.deepEqual(rule.classify(v)[0]?.span, { start: BASE + 0x300, end: rom.end });
});

test('no function: every free byte is data; code to the ROM end: nothing', () => {
  assert.deepEqual(rule.classify(viewWith({ rom }))[0]?.span, { start: BASE, end: rom.end });
  const v = viewWith({ rom, functions: [BASE], owner: ownerOver([fact(BASE, rom.end, 'rom-entry')]) });
  assert.deepEqual(rule.classify(v), []);
});
