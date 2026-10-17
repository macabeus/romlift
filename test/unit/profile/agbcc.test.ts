import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decode } from '../../../src/foundation/isa/decode.ts';
import { AGBCC, AGBCC_PIPELINE } from '../../../src/core/profile/agbcc.ts';
import { PROFILES, profileById } from '../../../src/core/profile/registry.ts';
import { pipelineIds, romWith, words } from '../../helpers/analysis.ts';
import { thumbAt } from '../../helpers/thumb.ts';

/** Every analysis rule id of architecture §4.1, by family, with the rules the phase-2 milestones added (walk.inline-arm-switch, bl.target-beyond-callee) and the owner decision's tmc tuning added (seed.ram-copy, D60). */
const SECTION_4_1 = {
  seed: ['seed.rom-entry', 'seed.startup-pointer', 'seed.listed', 'seed.override', 'seed.evidence-hint', 'seed.pool-pointer', 'seed.data-pointer', 'seed.call', 'seed.veneer', 'seed.adr', 'seed.ram-copy'],
  walk: [
    'walk.pc-load-is-pool',
    'walk.table-by-register',
    'walk.mov-lr-pc-bx-is-call',
    'walk.noreturn-call-before-noncode',
    'walk.swi-before-noncode',
    'walk.mov-pc-without-table',
    'walk.branch-into-function',
    'walk.bx-pc-veneer',
    'walk.inline-arm-switch',
    'walk.trailing-zero-padding',
  ],
  bl: [
    'bl.self-or-accepted',
    'bl.target-before-entry',
    'bl.near-is-call',
    'bl.target-inside-caller',
    'bl.target-has-prologue',
    'bl.target-beyond-callee',
    'bl.target-pops-unpushed-frame',
    'bl.noreturn-before-noncode',
  ],
  valid: ['valid.in-rom-unclaimed', 'valid.decodes', 'valid.balanced-stack', 'valid.returns-or-prologue', 'valid.no-claimed-code', 'valid.pool-not-code', 'valid.not-pointer-table', 'valid.dense', 'valid.calls-code'],
  accept: ['accept.tiles-after-accepted', 'accept.prologue-and-loaded', 'accept.prologue-and-end-anchored', 'accept.pointer-table-run', 'accept.tiny-anchored-at-start'],
  gap: [
    'gap.adr-block-absorb',
    'gap.tiled-hole',
    'gap.tiled-hole-inner',
    'gap.forward-chain',
    'gap.arm-scan',
    'gap.end-anchor',
    'gap.backward-prologue-chain',
    'gap.arm-over-prologueless-thumb',
    'gap.skip-padding-and-pointers',
  ],
  claim: ['claim.adjacent-pools', 'claim.far-pools', 'claim.dead-code-in-extent'],
  region: ['region.startup', 'region.padding', 'region.data-after-code'],
} as const;

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

test('every rule id of §4.1 sits in exactly one pipeline slot, and the pipeline names no other', () => {
  const expected = Object.values(SECTION_4_1).flat();
  assert.equal(expected.length, 58);
  const named = pipelineIds(AGBCC_PIPELINE);
  const counts = new Map<string, number>();
  for (const id of named) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of expected) assert.equal(counts.get(id), 1, `${id} in ${counts.get(id) ?? 0} slots`);
  assert.deepEqual([...counts.keys()].sort(byCodeUnit), [...expected].sort(byCodeUnit));
  assert.equal(AGBCC_PIPELINE.seed.length + AGBCC_PIPELINE.harvest.length + AGBCC_PIPELINE.queue.length, 11);
  assert.deepEqual(AGBCC_PIPELINE.passes, ['patient', 'impatient']);
});

test('the orders reproduce the PoC call order', () => {
  assert.deepEqual(AGBCC_PIPELINE.validity, SECTION_4_1.valid, 'whyInvalid order');
  assert.deepEqual(AGBCC_PIPELINE.harvest, ['seed.pool-pointer', 'seed.data-pointer']);
  assert.deepEqual(AGBCC_PIPELINE.queue, ['seed.call', 'seed.veneer', 'seed.adr', 'seed.ram-copy']);
  assert.deepEqual(AGBCC_PIPELINE.seed.slice(0, 2), ['seed.rom-entry', 'seed.startup-pointer']);
  assert.deepEqual(AGBCC_PIPELINE.gap.forward, { thumb: 'gap.forward-chain', arm: 'gap.arm-scan', after: ['gap.tiled-hole-inner'] });
  assert.equal(AGBCC_PIPELINE.bl[AGBCC_PIPELINE.bl.length - 1], 'bl.noreturn-before-noncode');
  assert.equal(AGBCC_PIPELINE.accept[AGBCC_PIPELINE.accept.length - 1], 'accept.tiny-anchored-at-start');
  const walk = AGBCC_PIPELINE.walk;
  assert.ok(walk.indexOf('walk.table-by-register') < walk.indexOf('walk.mov-pc-without-table'));
  assert.ok(walk.indexOf('walk.mov-lr-pc-bx-is-call') < walk.indexOf('walk.mov-pc-without-table'));
});

test("agbcc holds the PoC's numbers", () => {
  assert.deepEqual(AGBCC.farJump, { minDistance: 1536, requiresPushedLr: false });
  assert.deepEqual(AGBCC.tableJump, { maxBaseDistance: 0x400, maxEntries: 2048, maxTargetSpan: 0x10000 });
  assert.deepEqual(AGBCC.density, { minHoles: 8, holeShift: 4 });
  assert.equal(AGBCC.pointerTableRun, 3);
  assert.equal(AGBCC.tinyFunctionInsns, 3);
  assert.deepEqual(AGBCC.pointerWords, { minPointers: 4, minShare: 0.25 });
  assert.equal(AGBCC.anchorSlack, 3);
  assert.equal(AGBCC.extentPoolGap, 8);
  assert.deepEqual(AGBCC.gapScan, { backwardWindow: 4096, fillSlack: 3, armFrontPoolWords: 16, armMinInsnsForSkip: 16, prologueDistance: 4096, minInsns: 3 });
  assert.deepEqual(AGBCC.alignment, { thumbFunction: 2, armFunction: 4, cFunction: 4, pool: 4, object: 4 });
});

test('the registry holds agbcc only', () => {
  assert.deepEqual(Object.keys(PROFILES), ['agbcc']);
  assert.equal(profileById('agbcc'), AGBCC);
  assert.equal(profileById('gcc'), undefined);
  assert.equal(profileById('toString'), undefined, 'no prototype key');
});

test('the prologue idioms: isPrologue needs a word boundary, opensWithPushLr does not', () => {
  const push = thumbAt(0x0800_0200)`push {r4, lr}; push {lr}`;
  const rom = romWith([{ at: 0x0800_0200, bytes: push }, { at: 0x0800_0300, bytes: words(0xe92d4010) }]);
  assert.equal(AGBCC.idioms.isPrologue(rom, 0x0800_0200, 'thumb'), true);
  assert.equal(AGBCC.idioms.isPrologue(rom, 0x0800_0202, 'thumb'), false, 'not word-aligned');
  assert.equal(AGBCC.idioms.opensWithPushLr(rom, 0x0800_0202), true);
  assert.equal(AGBCC.idioms.opensWithPushLr(rom, 0x0800_0204), false);
  assert.equal(AGBCC.idioms.isPrologue(rom, 0x0800_0300, 'arm'), true, 'stmdb sp!, {r4, lr}');
  assert.equal(AGBCC.idioms.isPrologue(rom, rom.end, 'thumb'), false, 'outside the ROM');
});

test('padding is a zero byte or a byte of mov r8, r8', () => {
  const rom = romWith([{ at: 0x0800_0200, bytes: Uint8Array.from([0, 0xc0, 0x46, 0x12, 0xc0, 0x46]) }]);
  assert.equal(AGBCC.idioms.isPadding(rom, 0x0800_0200), true);
  assert.equal(AGBCC.idioms.isPadding(rom, 0x0800_0201), false, '0xC0 at an odd address is not a nop halfword');
  assert.equal(AGBCC.idioms.isPadding(rom, 0x0800_0204), true);
  assert.equal(AGBCC.idioms.isPadding(rom, 0x0800_0205), true);
  assert.equal(AGBCC.idioms.isPadding(rom, 0x0800_0203), false);
});

test('matchTableJump: the pool load the jump register comes from names the base; slots stop below the lowest target', () => {
  const at = 0x0800_0200;
  const code = thumbAt(at)`ldr r1, _0800020C; ldr r0, [r1, r0]; mov pc, r0`;
  const rom = romWith([
    { at, bytes: code },
    { at: 0x0800_020c, bytes: words(0x0800_0210) },
    { at: 0x0800_0210, bytes: words(0x0800_0220, 0x0800_0224, 0) },
  ]);
  const insns = [0, 2, 4].map((k) => decode('thumb', rom.bytes[at - rom.base + k]! | (rom.bytes[at - rom.base + k + 1]! << 8), at + k));
  const m = AGBCC.idioms.matchTableJump(insns, 2, rom);
  assert.deepEqual(m, { base: 0x0800_0210, targets: [0x0800_0220, 0x0800_0224], load: at });
  assert.equal(AGBCC.idioms.matchTableJump(insns, 0, rom), undefined, 'no load before the cursor');
});

test('matchFarJump: only beyond minDistance', () => {
  const caller = { entry: 0, mode: 'thumb' as const, codeEnd: 0, end: 0, prologue: false };
  assert.equal(AGBCC.idioms.matchFarJump({ site: 0x0800_0000, target: 0x0800_0000 + 1535 }, caller), false);
  assert.equal(AGBCC.idioms.matchFarJump({ site: 0x0800_1000, target: 0x0800_1000 - 1536 }, caller), true);
});
