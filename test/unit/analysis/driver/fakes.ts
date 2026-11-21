// Fake rules for the driver tests: small stand-ins for the wave-1 rules, enough to drive seeds,
// acceptance, readings and claims end to end. Not a test file; the driver tests import it.
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { AnalysisView, Candidate, RegisteredRule } from '../../../../src/core/analysis/types.ts';
import type { RuleId } from '../../../../src/core/provenance/rule-id.ts';
import { u32 } from '../../../../src/foundation/rom/rom.ts';
import { BASE, REFERENCE_WALK, fakeRule, pocExtentEnd } from '../../../helpers/analysis.ts';

/** seed.rom-entry: the ROM's first word is an ARM b: 0x08000000, then its target. */
export const romEntry = fakeRule(
  'seed.rom-entry',
  {
    kind: 'seed',
    seeds(v: AnalysisView): readonly Candidate[] {
      const w = u32(v.rom, BASE);
      if ((w & 0x0f00_0000) !== 0x0a00_0000) return [];
      const off = w & 0xff_ffff;
      const target = BASE + 8 + ((off & 0x80_0000 ? off - 0x100_0000 : off) << 2);
      return [
        { entry: BASE, mode: 'arm', proposedBy: 'seed.rom-entry', cites: [BASE] },
        { entry: target, mode: 'arm', proposedBy: 'seed.rom-entry', cites: [BASE] },
      ];
    },
  },
  'rom-entry',
);

/** seed.listed: the options' listed seeds, by entry. */
export const listed = fakeRule(
  'seed.listed',
  {
    kind: 'seed',
    seeds: (v) =>
      v.seeds
        .filter((s) => s.rule === 'seed.listed')
        .map((s) => ({ entry: s.entry, mode: s.mode, proposedBy: 'seed.listed' as const, cites: [s.entry] }))
        .sort((a, b) => a.entry - b.entry),
  },
  'listed',
);

/** seed.call: every call, in calls order. */
export const calls = fakeRule(
  'seed.call',
  {
    kind: 'queue',
    queue: (f) =>
      f.calls.map((c) => ({ entry: c.target, mode: c.mode, proposedBy: 'seed.call' as const, cites: [c.site] })),
  },
  'call',
);

/** claim.adjacent-pools: the PoC's Func.end, pools start-free and tables always. */
export const extent = fakeRule('claim.adjacent-pools', {
  kind: 'claim',
  claims: (_f, r) => [
    ...r.pools.map((p) => ({
      span: { start: p.addr, end: p.addr + 4 },
      kind: Claim.pool,
      when: 'start-free' as const,
    })),
    ...r.tables.map((t) => ({
      span: { start: t.base, end: t.base + 4 * t.targets.length },
      kind: Claim.table,
      when: 'always' as const,
    })),
  ],
  extentEnd: pocExtentEnd,
});

/** The reference walk policies as registered rules. */
export const walk: readonly RegisteredRule[] = REFERENCE_WALK.map((p) => fakeRule(p.id, p.rule));

/** valid.in-rom-unclaimed, judged on the entry alone. */
export const inRom = fakeRule('valid.in-rom-unclaimed', {
  kind: 'valid',
  reason: 'inside-code',
  intrinsic: true,
  check: () => undefined,
  checkEntry: (a, v) =>
    a < v.rom.base || a >= v.rom.end || (a & 1) !== 0
      ? 'outside the ROM'
      : v.claimAt(a) !== Claim.free
        ? 'inside claimed bytes'
        : undefined,
});

/** valid.decodes */
export const decodes = fakeRule('valid.decodes', {
  kind: 'valid',
  reason: 'decode-error',
  intrinsic: true,
  check: (r) =>
    r.insns.length === 0
      ? 'decodes to nothing'
      : r.errors.length > 0
        ? `decode error ${r.errors[0]?.reason}`
        : undefined,
});

/** A validity rule that always fails with `reason`. */
export function failing(
  id: RuleId,
  reason: 'calls-non-code' | 'not-dense',
  intrinsic: boolean,
  onCheck: () => void = () => undefined,
): RegisteredRule {
  return fakeRule(id, { kind: 'valid', reason, intrinsic, check: () => (onCheck(), 'fails by construction') });
}

/** bl.self-or-accepted: a call to the entry or to a function. */
export const selfOrAccepted = fakeRule('bl.self-or-accepted', {
  kind: 'bl',
  decide: (site, caller, v) => (site.target === caller.entry || v.isFunction(site.target) ? 'call' : undefined),
});

/** accept.tiles-after-accepted, simplified: something is claimed just below the entry. */
export const tiles = fakeRule('accept.tiles-after-accepted', {
  kind: 'accept',
  reason: 'unanchored',
  holds: (c, _r, v) =>
    v.claimAt(c.entry - 1) !== Claim.free ? { cites: [c.entry - 1], note: 'anchored at start' } : undefined,
});
