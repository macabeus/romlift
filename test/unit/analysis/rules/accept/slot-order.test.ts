// The accept slot of agbcc is the PoC's acceptable() order followed by thumbCandidate()'s veto, and the
// accept family registers exactly those six rules (accept.prologue-and-calls-accepted, D60, after the PoC's four).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACCEPT_RULES } from '../../../../../src/core/analysis/rules/accept/index.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';

const ACCEPTABLE = ['accept.tiles-after-accepted', 'accept.prologue-and-loaded', 'accept.prologue-and-end-anchored', 'accept.pointer-table-run', 'accept.prologue-and-calls-accepted', 'accept.tiny-anchored-at-start'] as const;

test('the agbcc accept slot is acceptable() in its order, then the tiny-candidate veto', () => {
  assert.deepEqual(AGBCC.pipeline.accept, ACCEPTABLE);
});

test('the accept family registers the six rules, each keyed by its id, the veto as accept-veto', () => {
  assert.deepEqual(Object.keys(ACCEPT_RULES).sort(), [...ACCEPTABLE].sort());
  for (const id of ACCEPTABLE) {
    const rule = ACCEPT_RULES[id];
    assert.equal(rule.meta.id, id);
    assert.equal(rule.kind, id === 'accept.tiny-anchored-at-start' ? 'accept-veto' : 'accept');
    assert.equal(rule.reason, 'unanchored');
  }
});
