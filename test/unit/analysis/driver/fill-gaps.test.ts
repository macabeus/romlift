// fillGaps(): the order of the gap slots at one gap, the header skip, the patient wait, the acceptance
// of a forward proposal and of a hole head mid-gap, the count it returns (the fixpoint test of a pass),
// a mid-gap absorb, and an accept veto recorded as a rejection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectionKey } from '../../../../src/core/analysis/driver/trail.ts';

import { accept } from '../../../../src/core/analysis/driver/accept.ts';
import { fillGaps } from '../../../../src/core/analysis/driver/fill-gaps.ts';
import { runAnalysis } from '../../../../src/core/analysis/driver/run.ts';
import { createDriver } from '../../../../src/core/analysis/driver/state.ts';
import type { AnalysisOptions, GapCursor, Reading, RegisteredRule } from '../../../../src/core/analysis/types.ts';
import type { Addr } from '../../../../src/foundation/rom/span.ts';
import type { Pipeline } from '../../../../src/core/profile/types.ts';
import type { RuleId } from '../../../../src/core/provenance/rule-id.ts';
import { BASE, fakeRule, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { extent, listed, walk } from './fakes.ts';

const F = 0x0800_0200;
const H = 0x0800_0240;
const off = (a: number): string => `+${(a - BASE).toString(16)}`;

interface Options {
  readonly head?: (c: GapCursor, read: (a: number) => Reading) => Reading | undefined;
  readonly forward?: (c: GapCursor, read: (a: number) => Reading) => boolean;
  /** Code at the start of the gap. */
  readonly code?: Uint8Array;
  /** Rules that replace the logging fakes of the same id. */
  readonly extra?: readonly RegisteredRule[];
  readonly disabled?: readonly RuleId[];
  /** The skip slot's answer at a cursor (the logging fake declines). */
  readonly skip?: (c: GapCursor) => Addr | undefined;
  /** Confirm mode listing only F and H (discover by default). */
  readonly confirm?: boolean;
  readonly pipeline?: Partial<Pipeline>;
  /** Alignment fields that replace the test profile's. */
  readonly alignment?: { readonly thumbFunction: number };
}

const HEAD_TAKER = fakeRule(
  'gap.tiled-hole-inner',
  { kind: 'gap', propose: (c) => (c.head === undefined ? undefined : { entry: c.head.entry, mode: 'thumb', proposedBy: 'gap.tiled-hole-inner', cites: [c.head.entry] }) },
  'tiled-hole',
);

function optionsFor(o: Options): AnalysisOptions {
  if (o.confirm !== true) return { mode: 'discover', seeds: [], overrides: [], trail: 'full' };
  const seeds = [F, H].map((entry) => ({ entry, mode: 'thumb' as const, rule: 'seed.listed' as const }));
  return { mode: 'confirm', seeds, overrides: [], trail: 'full' };
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
    fakeRule('gap.skip-padding-and-pointers', { kind: 'gap-skip', skip: (c) => (at('skip', c), o.skip?.(c)) }, 'gap-scan'),
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
  const base = testProfile({ claim: ['claim.adjacent-pools'], walk: walk.map((w) => w.meta.id), ...o.pipeline });
  const profile = o.alignment === undefined ? base : { ...base, alignment: { ...base.alignment, ...o.alignment } };
  const reg = registry(...gap, ...(o.extra ?? []), extent, ...walk);
  const tuning = tuningFor(profile, reg, { disabled: o.disabled ?? [] });
  const s = createDriver(rom, profile, optionsFor(o), tuning, reg);
  accept(s, { entry: F, mode: 'thumb', proposedBy: 'seed.listed', cites: [] });
  accept(s, { entry: H, mode: 'thumb', proposedBy: 'seed.listed', cites: [] });
  return { s, log, rom, profile, reg, tuning };
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
  assert.deepEqual(patient.log, ['absorb@+204', 'head@+204', 'tiled(head +204)@+204'], 'the head is offered to the proposers after the pair, which decline it');
  const impatient = setup({ head });
  fillGaps(impatient.s, 'impatient');
  assert.ok(impatient.log.length > 2);
});

test('the gap head is accepted only through the proposers after the pair: disabled, the head stays a candidate', () => {
  const head = (c: GapCursor, read: (a: number) => Reading): Reading | undefined => (c.at === F + 4 ? read(F + 4) : undefined);
  const taking = fakeRule('gap.tiled-hole-inner', { kind: 'gap', propose: (c) => (c.head === undefined ? undefined : { entry: c.head.entry, mode: 'thumb', proposedBy: 'gap.tiled-hole-inner', cites: [c.head.entry] }) }, 'tiled-hole');
  const code = thumbAt(F + 4)`movs r1, #1; movs r1, #1; bx lr`;
  const on = setup({ head, code, extra: [taking] });
  fillGaps(on.s, 'patient');
  assert.equal(on.s.funcs.get(F + 4)?.accepted.rule, 'gap.tiled-hole');
  const off = setup({ head, code, extra: [taking], disabled: ['gap.tiled-hole-inner'] });
  fillGaps(off.s, 'patient');
  assert.equal(off.s.funcs.has(F + 4), false);
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

test('after code ending at 2 mod 4 the scan resumes on the next halfword unless it is padding (alignment.thumbFunction, D60 a)', () => {
  // `bx lr` at F+4 ends at F+6; the halfword there is 0xFFFF (the fill), not padding: the next stub may start there.
  const stub = setup({ forward: (c, read) => c.at === F + 4 && read(c.at).insns.length > 0, code: thumbAt(F + 4)`bx lr` });
  fillGaps(stub.s, 'patient');
  assert.equal(stub.s.funcs.get(F + 4)?.reading.end, F + 6);
  assert.ok(stub.log.includes('thumb@+206'), stub.log.join(' '));
  // A zero halfword or `mov r8, r8` after it is the assembler's padding: the scan takes the next word.
  for (const pad of [new Uint8Array([0, 0]), thumbAt(F + 6)`mov r8, r8`]) {
    const padded = setup({ forward: (c, read) => c.at === F + 4 && read(c.at).insns.length > 0, code: new Uint8Array([...thumbAt(F + 4)`bx lr`, ...pad]) });
    fillGaps(padded.s, 'patient');
    assert.ok(!padded.log.includes('thumb@+206') && padded.log.includes('thumb@+208'), padded.log.join(' '));
  }
  // A profile whose Thumb functions are word-aligned never stands on 2 mod 4.
  const aligned = setup({ forward: (c, read) => c.at === F + 4 && read(c.at).insns.length > 0, code: thumbAt(F + 4)`bx lr`, alignment: { thumbFunction: 4 } });
  fillGaps(aligned.s, 'patient');
  assert.ok(!aligned.log.includes('thumb@+206') && aligned.log.includes('thumb@+208'), aligned.log.join(' '));
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

/** A hole head at F + 8 (mid-gap, after a skip from F + 4) that the proposer after the pair takes. */
const MID_GAP: Options = {
  head: (c, read) => (c.at === F + 8 ? read(F + 8) : undefined),
  skip: (c) => (c.at === F + 4 ? F + 8 : undefined),
  code: new Uint8Array([0, 0, 0, 0, ...thumbAt(F + 8)`movs r1, #1; movs r1, #1; bx lr`]),
  extra: [HEAD_TAKER],
};

test('a hole head taken mid-gap is accepted under the head rule, as at the gap start, and counted', () => {
  const { s } = setup(MID_GAP);
  assert.equal(fillGaps(s, 'impatient'), 1);
  assert.equal(s.funcs.get(F + 8)?.accepted.rule, 'gap.tiled-hole', 'the provenance does not depend on where in the gap the head is taken');
  assert.equal(fillGaps(s, 'impatient'), 0, 'nothing is left to add');
});

test('confirm mode: an unlisted mid-gap hole head adds nothing and is reported once, so the pass reaches its fixpoint in one round', () => {
  const { s } = setup({ ...MID_GAP, confirm: true });
  assert.equal(fillGaps(s, 'impatient'), 0, 'accept() added nothing: the count is what it reports, not one per acceptance');
  assert.equal(fillGaps(s, 'impatient'), 0);
  assert.equal(s.funcs.size, 2);
  assert.deepEqual([...s.unlisted.keys()], [F + 8]);
  const run = setup({ ...MID_GAP, confirm: true, pipeline: { seed: ['seed.listed'] }, extra: [HEAD_TAKER, listed] });
  const result = runAnalysis(run.rom, run.profile, optionsFor({ confirm: true }), run.tuning, run.reg);
  assert.deepEqual(result.diagnostics.filter((d) => d.code === 'W_FIXPOINT_LIMIT'), []);
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['W_UNLISTED_FUNCTION']);
});

test('an absorbed block mid-gap: the scan resumes after it, and the functions its calls add are counted', () => {
  const callee = F + 0x30;
  const absorbing = fakeRule('gap.adr-block-absorb', { kind: 'gap-absorb', absorb: (c) => (c.at === F + 8 ? { into: F, span: { start: F + 8, end: F + 0x10 } } : undefined) }, 'gap-scan');
  const calls = fakeRule('seed.call', { kind: 'queue', queue: (f) => f.calls.map((c) => ({ entry: c.target, mode: c.mode, proposedBy: 'seed.call' as const, cites: [c.site] })) }, 'call');
  const log: string[] = [];
  const thumb = fakeRule('gap.forward-chain', { kind: 'gap', propose: (c) => (log.push(off(c.at)), undefined) }, 'gap-scan');
  const code = new Uint8Array(H - F - 4).fill(0xff);
  code.set([0, 0, 0, 0], 0);
  code.set(thumbAt(F + 8)`bl _08000230; movs r0, #0; b _08000202`, 4);
  code.set(thumbAt(callee)`bx lr`, callee - F - 4);
  const { s } = setup({ skip: (c) => (c.at === F + 4 ? F + 8 : undefined), code, extra: [absorbing, calls, thumb], pipeline: { queue: ['seed.call'] } });
  const n = fillGaps(s, 'impatient');
  assert.equal(s.funcs.get(F)?.absorbed.length, 1, 'the block at F + 8 is merged into F');
  assert.ok(s.funcs.has(callee), 'its call is accepted');
  assert.ok(n >= 1, `the callee is counted (${n})`);
  assert.ok(log.includes(off(F + 0x10)), `the chain resumes at the block's end: ${log.join(' ')}`);
});

test('an accept veto on a forward proposal is recorded as a rejection under the veto, and diagnose names it', () => {
  const veto = fakeRule('accept.tiny-anchored-at-start', { kind: 'accept-veto', reason: 'unanchored', vetoes: (c) => (c.entry === F + 4 ? 'a stub' : undefined) });
  const { s } = setup({ forward: (c) => c.at === F + 4, code: thumbAt(F + 4)`bx lr`, extra: [veto], pipeline: { accept: ['accept.tiny-anchored-at-start'] } });
  fillGaps(s, 'impatient');
  assert.equal(s.funcs.has(F + 4), false);
  const r = s.rejections.get(rejectionKey(F + 4, 'thumb'));
  assert.equal(r?.rule, 'accept.tiny-anchored-at-start');
  assert.equal(r?.reason, 'unanchored');
  assert.match(r?.detail ?? '', /proposed by gap.forward-chain: a stub/);
});
