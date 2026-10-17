// Epochs: beginEpoch drops the readings of entries not accepted and the validity memo; hold() keeps a
// reading for the epoch and, past the reading budget, drops every held candidate reading (accepted ones
// stay) and raises W_READING_BUDGET once per run.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accept } from '../../../../src/core/analysis/driver/accept.ts';
import { beginEpoch, hold, readingBytes } from '../../../../src/core/analysis/driver/epoch.ts';
import { settle } from '../../../../src/core/analysis/driver/settle.ts';
import { createDriver } from '../../../../src/core/analysis/driver/state.ts';
import { registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { extent, walk } from './fakes.ts';

const F = 0x0800_0200;
const G = 0x0800_0300;
const H = 0x0800_1300;

function setup() {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`movs r0, #0; bx lr` },
    { at: G, bytes: thumbAt(G)`movs r0, #1; bx lr` },
    { at: H, bytes: thumbAt(H)`movs r0, #2; bx lr` },
  ]);
  const profile = testProfile({ claim: ['claim.adjacent-pools'], walk: walk.map((w) => w.meta.id) });
  const reg = registry(extent, ...walk);
  return createDriver(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, tuningFor(profile, reg), reg);
}

test('readingBytes counts a fixed part, each instruction and each 4 KiB page of the index', () => {
  const s = setup();
  assert.equal(readingBytes(settle(s, G)), 2048 + 64 * 2 + 4096);
});

test('hold keeps readings under the budget; past it every candidate reading is dropped, accepted ones stay, W_READING_BUDGET once', () => {
  const s = setup();
  accept(s, { entry: F, mode: 'thumb', proposedBy: 'seed.call', cites: [] });
  const g = settle(s, G);
  const h = settle(s, H);
  const budget = 2 * readingBytes(g);
  s.settled.delete(G);
  s.settled.delete(H);
  s.held = 0;
  hold(s, G, g, budget);
  hold(s, H, h, budget);
  assert.equal(s.held, budget, 'at the budget, nothing is dropped');
  assert.ok(s.settled.has(G) && s.settled.has(H));
  hold(s, G + 2, g, budget);
  assert.equal(s.settled.has(G + 2), false);
  assert.equal(s.settled.has(G), false, 'past the budget the candidate readings are dropped');
  assert.equal(s.settled.has(H), false);
  assert.ok(s.settled.has(F), 'an accepted reading stays');
  assert.equal(s.held, 0);
  hold(s, G, g, 0);
  assert.deepEqual(s.diagnostics.map((d) => d.code), ['W_READING_BUDGET'], 'raised once per run');
  beginEpoch(s);
  assert.equal(s.held, 0);
  assert.deepEqual([...s.settled.keys()], [F]);
});
