// The seed, validity and acceptance rules together on the real driver, with the reference walk and the
// PoC's extent standing in for the walk and claim families: the cartridge entry, the startup pointer to
// main, main's callee, a handler main loads from its pool, and three leaf handlers found only together
// from a table of pointers in data.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAnalysis } from '../../../../../src/core/analysis/driver/run.ts';
import { ACCEPT_RULES } from '../../../../../src/core/analysis/rules/accept/index.ts';
import { SEED_RULES } from '../../../../../src/core/analysis/rules/seed/index.ts';
import { VALID_RULES } from '../../../../../src/core/analysis/rules/valid/index.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import { registry, romWith, testProfile, tuningFor, words } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { extent, selfOrAccepted, walk } from '../../driver/fakes.ts';

const START = 0x0800_00c0;
const MAIN = 0x0800_0200;
const CALLEE = 0x0800_0240;
const HANDLER = 0x0800_0280;
const LEAVES = [0x0800_0300, 0x0800_0310, 0x0800_0320] as const;
const TABLE = 0x0800_0400;

test('discover finds the startup code, main, its callee, a loaded handler and a table of leaves', () => {
  const rom = romWith(
    [
      { at: START, bytes: armAt(START)`ldr r0, _080000C8; bx r0` },
      { at: START + 8, bytes: words(MAIN + 1) },
      { at: MAIN, bytes: thumbAt(MAIN)`push {lr}; ldr r0, _0800020C; bl _08000240; pop {pc}` },
      { at: MAIN + 0x0c, bytes: words(HANDLER + 1) },
      { at: CALLEE, bytes: thumbAt(CALLEE)`movs r0, #1; bx lr` },
      { at: HANDLER, bytes: thumbAt(HANDLER)`push {r4, lr}; pop {r4, pc}` },
      ...LEAVES.map((at, i) => ({ at, bytes: thumbAt(at)`movs r0, #${i}; bx lr` })),
      { at: TABLE, bytes: words(...LEAVES.map((a) => a + 1)) },
    ],
    { entry: START, size: 0x800 },
  );
  const p = AGBCC.pipeline;
  const profile = testProfile({
    seed: p.seed,
    harvest: p.harvest,
    queue: p.queue,
    validity: p.validity,
    accept: p.accept,
    claim: ['claim.adjacent-pools'],
    walk: walk.map((w) => w.meta.id),
    bl: ['bl.self-or-accepted'],
  });
  const reg = registry(
    ...Object.values(SEED_RULES),
    ...Object.values(VALID_RULES),
    ...Object.values(ACCEPT_RULES),
    extent,
    selfOrAccepted,
    ...walk,
  );
  const result = runAnalysis(
    rom,
    profile,
    { mode: 'discover', seeds: [], overrides: [], trail: 'off' },
    tuningFor(profile, reg),
    reg,
  );
  const found = result.functions.map((f) => [f.entry, f.mode, f.origin, f.accepted.note ?? '']);
  assert.deepEqual(found, [
    [rom.base, 'arm', 'rom-entry', ''],
    [START, 'arm', 'rom-entry', ''],
    [MAIN, 'thumb', 'startup-pointer', ''],
    [CALLEE, 'thumb', 'call', ''],
    [HANDLER, 'thumb', 'pool-pointer', 'accepted by accept.prologue-and-loaded'],
    [LEAVES[0], 'thumb', 'data-pointer', 'accepted by accept.pointer-table-run'],
    [LEAVES[1], 'thumb', 'data-pointer', 'accepted by accept.pointer-table-run'],
    [LEAVES[2], 'thumb', 'data-pointer', 'accepted by accept.pointer-table-run'],
  ]);
});
