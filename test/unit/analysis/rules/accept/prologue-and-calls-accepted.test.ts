// accept.prologue-and-calls-accepted (D60 h): a data-pointer candidate with a word-aligned prologue, a
// return and at least one call, every call on an accepted function.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/accept/prologue-and-calls-accepted.ts';
import type { Candidate, CallSite } from '../../../../../src/core/analysis/types.ts';
import type { RuleId } from '../../../../../src/core/provenance/rule-id.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';

const E = 0x0800_0200;
const G = 0x0800_0300;
const H = 0x0800_0340;

interface Case {
  readonly at?: number;
  readonly text?: string;
  readonly proposedBy?: RuleId;
  readonly calls?: readonly number[];
  readonly returns?: number;
  readonly functions?: readonly number[];
}

function holds(o: Case = {}) {
  const at = o.at ?? E;
  const rom = romWith([{ at, bytes: thumbAt(at)`${o.text ?? 'push {lr}; movs r0, #0; pop {pc}'}` }]);
  const c: Candidate = { entry: at, mode: 'thumb', proposedBy: o.proposedBy ?? 'seed.data-pointer', cites: [at] };
  const calls: CallSite[] = (o.calls ?? [G]).map((target, k) => ({ site: at + 2 + 4 * k, target, mode: 'thumb' }));
  return rule.holds(c, readingOf(rom, { entry: at, calls, returns: o.returns ?? 1 }), viewWith({ rom, functions: [...(o.functions ?? [G, H])] }));
}

test('a data pointer with a prologue, a return and calls on accepted functions holds', () => {
  assert.deepEqual(holds(), { cites: [E, E, G], note: 'prologue, a return, every call on an accepted function, named by data' });
  assert.equal(holds({ calls: [G, H] })?.cites.length, 4);
  assert.equal(rule.reason, 'unanchored');
});

test('does not hold: another origin, no prologue or off a word, no return, no call, a call off the function set', () => {
  assert.equal(holds({ proposedBy: 'seed.pool-pointer' }), undefined);
  assert.equal(holds({ text: 'movs r0, #0; bx lr' }), undefined);
  assert.equal(holds({ at: E + 2 }), undefined);
  assert.equal(holds({ returns: 0 }), undefined);
  assert.equal(holds({ calls: [] }), undefined);
  assert.equal(holds({ calls: [G, 0x0800_0380] }), undefined);
  assert.equal(holds({ functions: [] }), undefined);
});
