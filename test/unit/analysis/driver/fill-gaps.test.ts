// fillGaps(): the order of the gap slots at one gap, the header skip, the patient wait, and the
// acceptance of a forward proposal.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accept } from '../../../../src/core/analysis/driver/accept.ts';
import { fillGaps } from '../../../../src/core/analysis/driver/fill-gaps.ts';
import { createDriver } from '../../../../src/core/analysis/driver/run.ts';
import type { GapCursor, Reading } from '../../../../src/core/analysis/types.ts';
import { BASE, fakeRule, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { extent, walk } from './fakes.ts';

const F = 0x0800_0200;
const H = 0x0800_0240;
const off = (a: number): string => `+${(a - BASE).toString(16)}`;

interface Options {
  readonly head?: (c: GapCursor, read: (a: number) => Reading) => Reading | undefined;
  readonly forward?: (c: GapCursor, read: (a: number) => Reading) => boolean;
  /** Code at the start of the gap. */
  readonly code?: Uint8Array;
}

function setup(o: Options = {}) {
  const log: string[] = [];
  const at = (name: string, c: GapCursor): void => void log.push(`${name}@${off(c.at)}`);
  const gap = [
    fakeRule('gap.adr-block-absorb', { kind: 'gap-absorb', absorb: (c) => (at('absorb', c), undefined) }, 'gap-scan'),
    fakeRule('gap.tiled-hole', { kind: 'gap-head', head: (c, v) => (at('head', c), o.head?.(c, (a) => v.read(a, 'thumb'))) }, 'tiled-hole'),
    fakeRule(
      'gap.forward-chain',
      {
        kind: 'gap',
        propose: (c, v) => {
          at('thumb', c);
          return o.forward?.(c, (a) => v.read(a, 'thumb')) === true ? { entry: c.at, mode: 'thumb', proposedBy: 'gap.forward-chain', cites: [c.at] } : undefined;
        },
      },
      'gap-scan',
    ),
    fakeRule('gap.arm-scan', { kind: 'gap', reason: 'arm-unreached', propose: (c) => (at('arm', c), undefined) }, 'arm-gap-scan'),
    fakeRule('gap.tiled-hole-inner', { kind: 'gap', propose: (c) => (at(`tiled(head ${c.head === undefined ? 'none' : off(c.head.entry)})`, c), undefined) }, 'tiled-hole'),
    fakeRule('gap.arm-over-prologueless-thumb', { kind: 'gap-prefer', prefer: () => 'thumb' }, 'arm-gap-scan'),
    fakeRule('gap.skip-padding-and-pointers', { kind: 'gap-skip', skip: (c) => (at('skip', c), undefined) }, 'gap-scan'),
    fakeRule('gap.end-anchor', { kind: 'gap', propose: (c) => (log.push(`end-anchor@${off(c.at)}..${off(c.end)}`), undefined) }, 'gap-scan'),
    fakeRule('gap.backward-prologue-chain', { kind: 'gap', propose: (c) => (log.push(`backward@${off(c.at)}..${off(c.end)}`), undefined) }, 'gap-scan'),
  ];
  // F and H are accepted; the bytes between them (0xFF, never zero) are the gap.
  const fill = new Uint8Array(H - F - 4).fill(0xff);
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`movs r0, #0; bx lr` },
    { at: F + 4, bytes: fill },
    ...(o.code === undefined ? [] : [{ at: F + 4, bytes: o.code }]),
    { at: H, bytes: thumbAt(H)`bx lr` },
  ]);
  const profile = testProfile({ claim: ['claim.adjacent-pools'], walk: walk.map((w) => w.meta.id) });
  const reg = registry(...gap, extent, ...walk);
  const s = createDriver(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'full' }, tuningFor(profile, reg), reg);
  accept(s, { entry: F, mode: 'thumb', proposedBy: 'seed.call', cites: [] });
  accept(s, { entry: H, mode: 'thumb', proposedBy: 'seed.call', cites: [] });
  return { s, log };
}

test('one gap asks absorb, head, then per position absorb, the pair, the tiled hole and the skip; then the end anchor and the backward chain', () => {
  const { s, log } = setup();
  assert.equal(fillGaps(s, 'patient'), 0);
  assert.deepEqual(log, ['absorb@+204', 'head@+204', 'absorb@+204', 'thumb@+204', 'arm@+204', 'head@+204', 'skip@+204', 'end-anchor@+204..+240', 'backward@+204..+240']);
  assert.equal(s.epoch, 1, 'fillGaps begins an epoch');
});

test('the tiled-hole proposer sees the head at its cursor', () => {
  const { s, log } = setup({ head: (c, read) => (c.at === F + 4 ? read(F + 4) : undefined) });
  fillGaps(s, 'impatient');
  assert.ok(log.includes('tiled(head +204)@+204'), log.join(' '));
});

test('the patient pass waits on a head whose end is not anchored; the impatient pass goes on', () => {
  const head = (c: GapCursor, read: (a: number) => Reading): Reading | undefined => (c.at === F + 4 ? read(F + 4) : undefined);
  const patient = setup({ head });
  fillGaps(patient.s, 'patient');
  assert.deepEqual(patient.log, ['absorb@+204', 'head@+204']);
  const impatient = setup({ head });
  fillGaps(impatient.s, 'impatient');
  assert.ok(impatient.log.length > 2);
});

test('a forward proposal is accepted with its rule and origin, and the scan resumes after its extent', () => {
  const { s, log } = setup({ forward: (c, read) => c.at === F + 4 && read(c.at).insns.length > 0, code: thumbAt(F + 4)`movs r1, #1; bx lr` });
  assert.equal(fillGaps(s, 'patient'), 1);
  const f = s.funcs.get(F + 4);
  assert.equal(f?.origin, 'gap-scan');
  assert.equal(f?.accepted.rule, 'gap.forward-chain');
  assert.equal(f?.reading.end, F + 8);
  assert.ok(log.includes('thumb@+208'), 'the scan resumes at the next word after the accepted extent');
});

test('the cartridge header is never code: the forward chain starts at 0xC0', () => {
  const log: string[] = [];
  const thumb = fakeRule('gap.forward-chain', { kind: 'gap', propose: (c) => (log.push(off(c.at)), undefined) }, 'gap-scan');
  const rom = romWith([{ at: 0x0800_0100, bytes: thumbAt(0x0800_0100)`bx lr` }]);
  const profile = testProfile({ claim: ['claim.adjacent-pools'] });
  const reg = registry(thumb, extent);
  const s = createDriver(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, tuningFor(profile, reg), reg);
  accept(s, { entry: BASE, mode: 'arm', proposedBy: 'seed.rom-entry', cites: [] });
  accept(s, { entry: 0x0800_0100, mode: 'thumb', proposedBy: 'seed.call', cites: [] });
  fillGaps(s, 'impatient');
  assert.equal(log[0], '+c0');
});
