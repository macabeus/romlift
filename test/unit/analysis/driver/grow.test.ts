// grow(): its own until-stable loop, one harvest snapshot per round, each round an epoch.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDriver } from '../../../../src/core/analysis/driver/run.ts';
import { grow } from '../../../../src/core/analysis/driver/grow.ts';
import { accept } from '../../../../src/core/analysis/driver/accept.ts';
import type { Addr } from '../../../../src/foundation/rom/span.ts';
import { fakeRule, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { decodes, extent, inRom, tiles, walk } from './fakes.ts';
import { recorder } from './recorder.ts';

const F = 0x0800_0200;
const G = 0x0800_0204;

function setup(accepting: boolean) {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`bx lr; bx lr; bx lr` }]);
  const snapshots: (readonly Addr[])[] = [];
  const harvest = fakeRule(
    'seed.pool-pointer',
    {
      kind: 'harvest',
      harvest: (v) => {
        const list = [F, G].filter((a) => !v.isFunction(a));
        snapshots.push(list);
        return list;
      },
    },
    'pool-pointer',
  );
  const always = fakeRule('accept.prologue-and-loaded', { kind: 'accept', reason: 'unanchored', holds: (c, _r, v) => (accepting ? { rule: 'accept.prologue-and-loaded', round: v.round, cites: [c.entry] } : undefined) });
  const profile = testProfile({ harvest: ['seed.pool-pointer'], validity: ['valid.in-rom-unclaimed', 'valid.decodes'], accept: ['accept.prologue-and-loaded'], claim: ['claim.adjacent-pools'], walk: walk.map((w) => w.meta.id) });
  const reg = registry(harvest, always, inRom, decodes, extent, tiles, ...walk);
  const oracle = recorder();
  const s = createDriver(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, tuningFor(profile, reg, { oracle }), reg);
  return { s, snapshots, oracle };
}

test('grow takes one snapshot per round and stops at the first round that adds nothing', () => {
  const { s, snapshots, oracle } = setup(true);
  assert.equal(grow(s), 2);
  assert.deepEqual(snapshots, [[F, G], []], 'round 1 proposes both; G is accepted in the same round from the same snapshot');
  assert.deepEqual(oracle.log, [
    '#forgetCandidates',
    'pointerCandidates',
    'valid',
    'whyInvalid',
    'settle',
    'settle',
    'acceptable',
    'settle',
    '#claim',
    'valid',
    'whyInvalid',
    'settle',
    'settle',
    'acceptable',
    'settle',
    '#claim',
    '#forgetCandidates',
    'pointerCandidates',
  ]);
  assert.deepEqual(s.order, [F, G]);
  assert.equal(s.funcs.get(F)?.accepted.note, 'accepted by accept.prologue-and-loaded');
  assert.equal(s.epoch, 2);
});

test('a valid candidate no accept rule takes is rejected as unanchored', () => {
  const { s } = setup(false);
  assert.equal(grow(s), 0);
  const r = [...s.rejections.values()].find((x) => x.at === F);
  assert.equal(r?.reason, 'unanchored');
  assert.equal(r?.rule, 'accept.prologue-and-loaded');
  assert.equal(r?.intrinsic, false);
});

test('a candidate already accepted or claimed is skipped without asking validity', () => {
  const { s, oracle } = setup(true);
  accept(s, { entry: F, mode: 'thumb', proposedBy: 'seed.call', cites: [] });
  oracle.log.length = 0;
  grow(s);
  assert.equal(oracle.log.filter((q) => q === 'valid').length, 1, 'only G');
});
