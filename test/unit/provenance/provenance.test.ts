import assert from 'node:assert/strict';
import { test } from 'node:test';

import { capCites, compareRejections, MAX_CITES, provenance } from '../../../src/core/provenance/provenance.ts';
import type { Rejection } from '../../../src/core/provenance/provenance.ts';
import { FAMILIES, familyOf, isRuleId } from '../../../src/core/provenance/rule-id.ts';
import { trailKeeps } from '../../../src/core/provenance/trail.ts';
import type { TrailEvent } from '../../../src/core/provenance/trail.ts';

test('cites keep the first four distinct addresses', () => {
  assert.equal(MAX_CITES, 4);
  assert.deepEqual(capCites([5, 1, 5, 2, 3, 4, 6]), [5, 1, 2, 3]);
  const p = provenance('seed.call', 3, [1, 2, 3, 4, 5], 'why');
  assert.deepEqual(p, { rule: 'seed.call', round: 3, cites: [1, 2, 3, 4], note: 'why' });
  assert.equal('note' in provenance('seed.call', 0, []), false);
});

test('rule ids name a known family before the dot', () => {
  assert.equal(familyOf('valid.dense'), 'valid');
  assert.equal(familyOf('gap.end-anchor'), 'gap');
  assert.equal(isRuleId('valid.dense'), true);
  assert.equal(isRuleId('sig.unique-fit'), true);
  assert.equal(isRuleId('engine.x'), false);
  assert.equal(isRuleId('valid.'), false);
  assert.equal(isRuleId('valid'), false);
  assert.deepEqual(FAMILIES, ['seed', 'walk', 'bl', 'valid', 'accept', 'gap', 'claim', 'region', 'sig']);
});

test('rejections order by address, then Thumb before ARM', () => {
  const r = (at: number, mode: 'thumb' | 'arm'): Rejection => ({ at, mode, rule: 'valid.dense', reason: 'not-dense', intrinsic: true, round: 0, detail: '', count: 1 });
  const sorted = [r(8, 'arm'), r(8, 'thumb'), r(4, 'arm')].sort(compareRejections);
  assert.deepEqual(sorted.map((x) => `${x.at}${x.mode}`), ['4arm', '8thumb', '8arm']);
});

test('the trail keeps decisions at "decisions", everything at "full", nothing at "off", inside the filter only', () => {
  const e = (kind: TrailEvent['kind'], at: number, cites: number[] = []): TrailEvent => ({ kind, at, rule: 'seed.call', round: 0, cites });
  assert.equal(trailKeeps('off', undefined, e('accept', 0)), false);
  assert.equal(trailKeeps('decisions', undefined, e('accept', 0)), true);
  assert.equal(trailKeeps('decisions', undefined, e('propose', 0)), false);
  assert.equal(trailKeeps('decisions', undefined, e('wait', 0)), false);
  assert.equal(trailKeeps('full', undefined, e('propose', 0)), true);
  const filter = { start: 0x100, end: 0x200 };
  assert.equal(trailKeeps('full', filter, e('accept', 0x150)), true);
  assert.equal(trailKeeps('full', filter, e('accept', 0x250)), false);
  assert.equal(trailKeeps('full', filter, e('accept', 0x250, [0x1ff])), true, 'a cite inside the filter keeps it');
});
