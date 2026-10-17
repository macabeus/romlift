// region.startup: rom-entry, adr and veneer functions tiling the ROM from its start, the end rounded up to 4.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../src/core/analysis/rules/region/startup.ts';
import type { FunctionFact } from '../../../../src/core/analysis/types.ts';
import type { CompilerProfile } from '../../../../src/core/profile/types.ts';
import { BASE, romWith, viewWith } from '../../../helpers/analysis.ts';
import { DUMMY_PROFILE } from '../../../helpers/dummy-profile.ts';
import { fact, ownerOver } from './facts.ts';

const rom = romWith([]);
const startup = (facts: readonly FunctionFact[], profile?: CompilerProfile) =>
  rule.startup?.(viewWith({ rom, functions: facts.map((f) => f.entry).reverse(), owner: ownerOver(facts), ...(profile === undefined ? {} : { profile }) }));

test('the entry, the code it reaches and what it names with adr or a veneer, while they tile from the ROM start', () => {
  const facts = [fact(BASE, BASE + 0xe0, 'rom-entry'), fact(BASE + 0xc0, BASE + 0xe0, 'rom-entry'), fact(BASE + 0xe0, BASE + 0x100, 'adr'), fact(BASE + 0x102, BASE + 0x10a, 'veneer'), fact(BASE + 0x10c, BASE + 0x120, 'call')];
  assert.deepEqual(startup(facts), { span: { start: BASE, end: BASE + 0x10c }, entries: [BASE, BASE + 0xc0, BASE + 0xe0, BASE + 0x102] });
  assert.equal(rule.classify(viewWith({ rom })).length, 0, 'it claims nothing');
});

test('it stops at a function of another origin, and at a gap wider than anchorSlack (profile boundary)', () => {
  assert.deepEqual(startup([fact(BASE, BASE + 0x10, 'rom-entry'), fact(BASE + 0x10, BASE + 0x20, 'call'), fact(BASE + 0x20, BASE + 0x30, 'adr')])?.entries, [BASE]);
  const spaced = [fact(BASE, BASE + 0x10, 'rom-entry'), fact(BASE + 0x13, BASE + 0x20, 'adr')];
  assert.deepEqual(startup(spaced)?.entries, [BASE, BASE + 0x13], 'agbcc: 3 bytes');
  assert.deepEqual(startup(spaced, DUMMY_PROFILE), { span: { start: BASE, end: BASE + 0x10 }, entries: [BASE] }, 'dummy: 1 byte');
  assert.deepEqual(startup([fact(BASE, BASE + 0x10, 'rom-entry'), fact(BASE + 0x14, BASE + 0x20, 'adr')])?.entries, [BASE]);
});

test('no function: an empty region at the ROM start; a first function that is not startup code: empty too', () => {
  assert.deepEqual(startup([]), { span: { start: BASE, end: BASE }, entries: [] });
  assert.deepEqual(startup([fact(BASE, BASE + 0x10, 'gap-scan')]), { span: { start: BASE, end: BASE }, entries: [] });
});

test('the end is rounded up to a word', () => {
  assert.deepEqual(startup([fact(BASE, BASE + 0x0a, 'rom-entry')])?.span, { start: BASE, end: BASE + 0x0c });
});
