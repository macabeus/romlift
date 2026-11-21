// settle(): the per-function bl fixpoint: verdict rules first answer wins, 'defer' for a target in
// progress, far sites re-walked as jumps, calls sticky, and the noreturn refinement of a dead end.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settle } from '../../../../src/core/analysis/driver/settle.ts';
import { createDriver } from '../../../../src/core/analysis/driver/state.ts';
import type { BlVerdict, RegisteredRule } from '../../../../src/core/analysis/types.ts';
import { fakeRule, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { extent, walk } from './fakes.ts';

const F = 0x0800_0200;
const G = 0x0800_0240;

function driver(bl: readonly RegisteredRule[], code: readonly { at: number; bytes: Uint8Array }[]) {
  const rom = romWith(code);
  const profile = testProfile({
    bl: bl.map((r) => r.meta.id),
    claim: ['claim.adjacent-pools'],
    walk: walk.map((w) => w.meta.id),
  });
  const reg = registry(...bl, extent, ...walk);
  return createDriver(
    rom,
    profile,
    { mode: 'discover', seeds: [], overrides: [], trail: 'off' },
    tuningFor(profile, reg),
    reg,
  );
}

const mutual = [
  { at: F, bytes: thumbAt(F)`push {lr}; bl _08000240; pop {pc}` },
  { at: G, bytes: thumbAt(G)`push {lr}; bl _08000200; pop {pc}` },
];

test("a target in progress is deferred; the callee's reading is settled first", () => {
  const order: number[] = [];
  const pops = fakeRule('bl.target-pops-unpushed-frame', {
    kind: 'bl',
    decide: (site, _caller, v): BlVerdict | 'defer' => {
      if (v.inProgress(site.target)) return 'defer';
      v.read(site.target, 'thumb');
      order.push(site.target);
      return 'call';
    },
  });
  const s = driver([pops], mutual);
  const f = settle(s, F);
  assert.deepEqual(order, [G], 'F asks for G; G defers on F');
  assert.deepEqual(f.blVerdicts, [{ site: F + 2, target: G, verdict: 'call', rule: 'bl.target-pops-unpushed-frame' }]);
  const g = s.settled.get(G);
  assert.deepEqual(g?.blVerdicts, [{ site: G + 2, target: F, verdict: 'call', rule: 'bl.target-pops-unpushed-frame' }]);
  assert.equal(s.inProgress.size, 0);
  assert.equal(settle(s, F), f, 'memoised');
});

test('a far verdict re-walks the site as a jump: the target joins the reading and leaves the calls', () => {
  const far = fakeRule('bl.target-inside-caller', { kind: 'bl', decide: () => 'far' });
  const s = driver([far], mutual);
  const f = settle(s, F);
  assert.deepEqual(f.far, [F + 2, G + 2], 'G is walked as part of F, and its bl back is far too');
  assert.deepEqual(f.calls, []);
  assert.equal(f.insnAt.has(G), true);
  assert.deepEqual(
    f.blVerdicts.map((v) => [v.site, v.verdict]),
    [
      [F + 2, 'far'],
      [G + 2, 'far'],
    ],
  );
});

test('the first verdict rule that answers wins, and a call stays a call', () => {
  let asked = 0;
  const near = fakeRule('bl.near-is-call', { kind: 'bl', decide: () => 'call' });
  const later = fakeRule('bl.target-inside-caller', { kind: 'bl', decide: () => ((asked += 1), 'far') });
  const s = driver([near, later], mutual);
  assert.deepEqual(
    settle(s, F).blVerdicts.map((v) => v.rule),
    ['bl.near-is-call'],
  );
  assert.equal(asked, 0);
});

test('a call before non-code is refined to never returning, and the next round stops after it', () => {
  const near = fakeRule('bl.near-is-call', { kind: 'bl', decide: () => 'call' });
  const dead = fakeRule('bl.noreturn-before-noncode', {
    kind: 'bl',
    refines: true,
    decide: (site, caller) => (caller.deadEnd.includes(site.site) ? 'noreturn' : undefined),
  });
  const s = driver(
    [near, dead],
    [
      { at: F, bytes: Uint8Array.from([...thumbAt(F)`push {lr}; bl _08000240`, 0x00, 0xb1]) },
      { at: G, bytes: thumbAt(G)`bx lr` },
    ],
  );
  const f = settle(s, F);
  assert.deepEqual(f.noret, [F + 2]);
  assert.deepEqual(f.deadEnd, [], 'the second walk ends at the bl');
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.blVerdicts, [{ site: F + 2, target: G, verdict: 'noreturn', rule: 'bl.noreturn-before-noncode' }]);
  assert.deepEqual(
    f.exits.map((e) => [e.kind, e.rule]),
    [['noreturn-call', 'bl.noreturn-before-noncode']],
  );
});
