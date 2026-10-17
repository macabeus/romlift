// grow(): its own until-stable loop, one harvest snapshot per round (one list per harvest rule of the
// slot, whatever its length), each round an epoch; an unanchored candidate is rejected under the rule
// that proposed it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDriver } from '../../../../src/core/analysis/driver/state.ts';
import { grow, pointerCandidates } from '../../../../src/core/analysis/driver/grow.ts';
import { accept } from '../../../../src/core/analysis/driver/accept.ts';
import { runAnalysis } from '../../../../src/core/analysis/driver/run.ts';
import type { RuleId } from '../../../../src/core/provenance/rule-id.ts';
import type { TrailEvent } from '../../../../src/core/provenance/trail.ts';
import type { Addr } from '../../../../src/foundation/rom/span.ts';
import { fakeRule, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { decodes, extent, inRom, tiles, walk } from './fakes.ts';

const F = 0x0800_0200;
const G = 0x0800_0204;

function setup(accepting: boolean) {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`bx lr; bx lr; bx lr` }]);
  const snapshots: (readonly Addr[])[] = [];
  let validityChecks = 0;
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
  const counted = fakeRule('valid.decodes', {
    kind: 'valid',
    reason: 'decode-error',
    intrinsic: true,
    check: (r) => {
      validityChecks += 1;
      return r.insns.length === 0 || r.errors.length > 0 ? 'decode error' : undefined;
    },
  });
  const always = fakeRule('accept.prologue-and-loaded', { kind: 'accept', reason: 'unanchored', holds: (c) => (accepting ? { cites: [c.entry], note: 'always' } : undefined) });
  const profile = testProfile({ harvest: ['seed.pool-pointer'], validity: ['valid.in-rom-unclaimed', 'valid.decodes'], accept: ['accept.prologue-and-loaded'], claim: ['claim.adjacent-pools'], walk: walk.map((w) => w.meta.id) });
  const reg = registry(harvest, always, inRom, counted, extent, tiles, ...walk);
  const events: TrailEvent[] = [];
  const s = createDriver(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'full' }, tuningFor(profile, reg), reg, { event: (e) => events.push(e) });
  return { s, snapshots, events, checks: () => validityChecks };
}

test('grow takes one snapshot per round and stops at the first round that adds nothing', () => {
  const { s, snapshots, events } = setup(true);
  assert.equal(grow(s), 2);
  assert.deepEqual(snapshots, [[F, G], []], 'round 1 proposes both; G is accepted in the same round from the same snapshot');
  assert.deepEqual(
    events.filter((e) => e.kind === 'accept').map((e) => [e.at, e.rule, e.round]),
    [
      [F, 'seed.pool-pointer', 1],
      [F, 'accept.prologue-and-loaded', 1],
      [G, 'seed.pool-pointer', 1],
      [G, 'accept.prologue-and-loaded', 1],
    ],
    'the proposer and the acceptance rule are both cited',
  );
  assert.deepEqual(s.order, [F, G]);
  assert.equal(s.funcs.get(F)?.accepted.note, 'accepted by accept.prologue-and-loaded');
  assert.equal(s.epoch, 2);
});

test('a valid candidate no accept rule takes is rejected as unanchored, under the rule that proposed it', () => {
  const { s } = setup(false);
  assert.equal(grow(s), 0);
  const r = [...s.rejections.values()].find((x) => x.at === F);
  assert.equal(r?.reason, 'unanchored');
  assert.equal(r?.rule, 'seed.pool-pointer');
  assert.equal(r?.intrinsic, false);
});

test('a candidate already accepted or claimed is skipped without asking validity', () => {
  const { s, checks } = setup(true);
  accept(s, { entry: F, mode: 'thumb', proposedBy: 'seed.call', cites: [] });
  const before = checks();
  grow(s);
  assert.equal(checks() - before, 1, 'only G');
});

test('pointerCandidates gives one list per harvest rule of the slot, in slot order; a profile with three harvest rules and no seed.call loses none', () => {
  const [A, B, C] = [0x0800_0200, 0x0800_0220, 0x0800_0240];
  const rom = romWith([
    { at: A, bytes: thumbAt(A)`push {lr}; bl _08000300; pop {pc}` },
    { at: B, bytes: thumbAt(B)`bx lr; bx lr` },
    { at: C, bytes: thumbAt(C)`bx lr; bx lr` },
    { at: 0x0800_0300, bytes: thumbAt(0x0800_0300)`bx lr` },
  ]);
  const harvesting = (id: RuleId, target: Addr) => fakeRule(id, { kind: 'harvest', harvest: (v, earlier) => (v.isFunction(target) || earlier.has(target) ? [] : [target]) }, 'pool-pointer');
  const ids: readonly RuleId[] = ['seed.harvest-one', 'seed.harvest-two', 'seed.harvest-three'];
  const rules = [harvesting('seed.harvest-one', A), harvesting('seed.harvest-two', B), harvesting('seed.harvest-three', C)];
  const taking = fakeRule('accept.tiles-after-accepted', { kind: 'accept', reason: 'unanchored', holds: (c) => ({ cites: [c.entry], note: 'always' }) });
  const profile = testProfile({ harvest: ids, validity: ['valid.in-rom-unclaimed', 'valid.decodes'], accept: ['accept.tiles-after-accepted'], claim: ['claim.adjacent-pools'], walk: walk.map((w) => w.meta.id) });
  const reg = registry(...rules, taking, inRom, decodes, extent, ...walk);
  const s = createDriver(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, tuningFor(profile, reg), reg);
  assert.deepEqual(pointerCandidates(s), [
    { id: 'seed.harvest-one', targets: [A] },
    { id: 'seed.harvest-two', targets: [B] },
    { id: 'seed.harvest-three', targets: [C] },
  ]);
  const result = runAnalysis(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, tuningFor(profile, reg), reg);
  assert.deepEqual(
    result.functions.map((f) => [f.entry, f.accepted.rule]),
    [
      [A, 'seed.harvest-one'],
      [B, 'seed.harvest-two'],
      [C, 'seed.harvest-three'],
    ],
    'the third rule is proposed and accepted under its own id; without seed.call in the queue slot the callee is not proposed',
  );
});
