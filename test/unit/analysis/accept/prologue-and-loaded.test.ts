import assert from 'node:assert/strict';
import { test } from 'node:test';

import prologueAndLoaded from '../../../../src/core/analysis/rules/accept/prologue-and-loaded.ts';
import type { Candidate } from '../../../../src/core/analysis/types.ts';
import type { RuleId } from '../../../../src/core/provenance/rule-id.ts';
import { readingOf, romWith, viewWith } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const E = 0x0800_0200;

function holds(at: number, text: string, proposedBy: RuleId) {
  const rom = romWith([{ at, bytes: thumbAt(at)`${text}` }]);
  const c: Candidate = { entry: at, mode: 'thumb', proposedBy, cites: [at] };
  return prologueAndLoaded.holds(c, readingOf(rom, { entry: at }), viewWith({ rom }));
}

test('a word-aligned push {.., lr} proposed by seed.pool-pointer holds', () => {
  assert.deepEqual(holds(E, 'push {r4, lr}; pop {r4, pc}', 'seed.pool-pointer'), { rule: 'accept.prologue-and-loaded', round: 0, cites: [E], note: 'prologue, loaded from a pool' });
});

test('a data pointer, a push off a word boundary or a push without lr does not hold', () => {
  assert.equal(holds(E, 'push {r4, lr}; pop {r4, pc}', 'seed.data-pointer'), undefined);
  assert.equal(holds(E + 2, 'push {r4, lr}; pop {r4, pc}', 'seed.pool-pointer'), undefined);
  assert.equal(holds(E, 'push {r4}; pop {r4}; bx lr', 'seed.pool-pointer'), undefined);
  assert.equal(prologueAndLoaded.reason, 'unanchored');
});
