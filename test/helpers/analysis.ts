// Builders for analysis and rule tests over thumb``/arm`` bytes (test/helpers/thumb.ts): a ROM with a
// valid GBA header around given code, a test profile with chosen slots, a view with chosen claims,
// accepted functions and readings, readings built without walking (readingOf) or through the real
// walker (walkReading), and fake rules with complete metadata. The reference walk policies below follow
// the PoC's analyzeThumb/analyzeArm so the walker and driver tests can run without the wave-1 rules.
import { romFromBytes, headerComplement } from '../../src/foundation/rom/rom.ts';
import type { Rom } from '../../src/foundation/rom/rom.ts';
import { u16, u32 } from '../../src/foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../src/foundation/rom/span.ts';
import { AGBCC } from '../../src/core/profile/agbcc.ts';
import type { CompilerProfile, Pipeline } from '../../src/core/profile/types.ts';
import type { RuleId, RuleMeta } from '../../src/core/provenance/rule-id.ts';
import type { Origin } from '../../src/core/provenance/vocabulary.ts';
import { addressMap } from '../../src/core/analysis/address-map.ts';
import { buildPointerIndex } from '../../src/core/analysis/pointers.ts';
import { makeReading } from '../../src/core/analysis/reading.ts';
import type { ReadingParts } from '../../src/core/analysis/reading.ts';
import { RULES } from '../../src/core/analysis/driver/rules.ts';
import { Claim } from '../../src/core/analysis/types.ts';
import type {
  AnalysisTuning,
  AnalysisView,
  ClaimKind,
  FunctionFact,
  Reading,
  ReadingShape,
  RegisteredRule,
  RuleContract,
  RuleRegistry,
  ValidityFailure,
  WalkPolicy,
} from '../../src/core/analysis/types.ts';
import { walkArm } from '../../src/core/analysis/walk/arm.ts';
import type { ResolvedPolicy, WalkEnv } from '../../src/core/analysis/walk/cursor.ts';
import { walkThumb } from '../../src/core/analysis/walk/thumb.ts';

export const BASE = 0x0800_0000;

/** Bytes to place at a bus address. */
export interface Placed {
  readonly at: Addr;
  readonly bytes: Uint8Array;
}

/** An ARM `b target` at `at`, as a little-endian word. */
export function armBranch(at: Addr, target: Addr): number {
  return (0xea00_0000 | (((target - (at + 8)) >> 2) & 0x00ff_ffff)) >>> 0;
}

/** Little-endian bytes of 32-bit words. */
export function words(...values: readonly number[]): Uint8Array {
  const out = new Uint8Array(4 * values.length);
  values.forEach((v, i) => new DataView(out.buffer).setUint32(4 * i, v >>> 0, true));
  return out;
}

/**
 * A ROM of `size` bytes (default: the smallest multiple of 0x100 above every part, at least 0x400) with
 * a valid cartridge header, `parts` at their addresses, and, when `entry` is given, the first word an ARM
 * `b entry`.
 */
export function romWith(parts: readonly Placed[], opts: { readonly size?: number; readonly entry?: Addr } = {}): Rom {
  const needed = parts.reduce((n, p) => Math.max(n, p.at - BASE + p.bytes.length), 0x400);
  const size = opts.size ?? Math.ceil(needed / 0x100) * 0x100;
  const bytes = new Uint8Array(size);
  const title = 'ANALYSIS';
  for (let i = 0; i < title.length; i++) bytes[0xa0 + i] = title.charCodeAt(i);
  bytes[0xb2] = 0x96;
  if (opts.entry !== undefined) new DataView(bytes.buffer).setUint32(0, armBranch(BASE, opts.entry), true);
  for (const p of parts) bytes.set(p.bytes, p.at - BASE);
  bytes[0xbd] = headerComplement(bytes);
  return romFromBytes(bytes, 'test');
}

const EMPTY_PIPELINE: Pipeline = {
  seed: [],
  harvest: [],
  queue: [],
  walk: [],
  bl: [],
  validity: [],
  accept: [],
  claim: [],
  gap: AGBCC.pipeline.gap,
  region: [],
  passes: ['patient', 'impatient'],
};

/** agbcc's numbers and idioms with only the given slots (the gap slots default to agbcc's ids). */
export function testProfile(pipeline: Partial<Pipeline> = {}): CompilerProfile {
  return { ...AGBCC, id: 'test', pipeline: { ...EMPTY_PIPELINE, ...pipeline } };
}

/** Every rule id a pipeline names. */
export function pipelineIds(p: Pipeline): readonly RuleId[] {
  const g = p.gap;
  return [...p.seed, ...p.harvest, ...p.queue, ...p.walk, ...p.bl, ...p.validity, ...p.accept, ...p.claim, g.absorb, g.head, ...g.forward, g.prefer, g.skip, g.endAnchor, g.backward, ...p.region];
}

/** Tuning that disables every pipeline id `registry` lacks, plus `extra.disabled`. */
export function tuningFor(profile: CompilerProfile, registry: RuleRegistry, extra: Partial<AnalysisTuning> = {}): AnalysisTuning {
  const missing = pipelineIds(profile.pipeline).filter((id) => !Object.hasOwn(registry, id));
  return { worklist: 'poc-lifo', cache: 'epoch', ...extra, disabled: [...missing, ...(extra.disabled ?? [])] };
}

/** A fake rule: `contract` with complete test metadata. */
export function fakeRule<C extends RuleContract>(id: RuleId, contract: C, origin?: Origin): C & { readonly meta: RuleMeta } {
  return { ...contract, meta: { id, summary: `test rule ${id}`, restsOn: 'the test', recovers: 'the test', reads: [], adds: [], ...(origin === undefined ? {} : { origin }) } };
}

/** A registry from fake rules. */
export function registry(...rules: readonly RegisteredRule[]): RuleRegistry {
  const out: Record<RuleId, RegisteredRule> = {};
  for (const r of rules) out[r.meta.id] = r;
  return out;
}

/** A reading built directly, every list defaulting to empty and `end` to the code end. */
export function readingOf(rom: Rom, parts: Partial<ReadingParts> & { readonly entry: Addr }): Reading {
  const insns = parts.insns ?? [];
  const codeEnd = insns.reduce((e, i) => Math.max(e, i.addr + i.len), parts.entry);
  return makeReading(
    {
      mode: 'thumb',
      insns,
      pools: [],
      tables: [],
      calls: [],
      blSites: [],
      deadEnd: [],
      balance: [],
      returns: 0,
      errors: [],
      veneers: [],
      adrs: [],
      tails: [],
      tailExits: 0,
      end: codeEnd,
      ...parts,
    },
    rom,
  );
}

/** What a test view serves. */
export interface ViewSetup {
  readonly rom: Rom;
  readonly profile?: CompilerProfile;
  readonly claims?: readonly { readonly span: Span; readonly kind: ClaimKind }[];
  /** Accepted entries, in acceptance order. */
  readonly functions?: readonly Addr[];
  /** Readings served by read() (and by accepted() for accepted entries); read() walks the rest with `walk`. */
  readonly readings?: readonly Reading[];
  readonly walk?: readonly ResolvedPolicy[];
  readonly valid?: (a: Addr) => boolean;
  readonly whyInvalid?: (a: Addr) => ValidityFailure | undefined;
  readonly owner?: (a: Addr) => FunctionFact | undefined;
}

/** A view over fixed state, for rule tests. */
export function viewWith(setup: ViewSetup): AnalysisView {
  const { rom } = setup;
  const profile = setup.profile ?? AGBCC;
  const claims = new Uint8Array(rom.bytes.length);
  for (const c of setup.claims ?? []) claims.fill(c.kind, c.span.start - BASE, c.span.end - BASE);
  const functions = setup.functions ?? [];
  const readings = new Map<string, Reading>();
  for (const r of setup.readings ?? []) readings.set(`${r.entry}:${r.mode}`, r);
  const view: AnalysisView = {
    rom,
    profile,
    addresses: addressMap([]),
    round: 0,
    epoch: 0,
    seeds: [],
    overrides: [],
    claimAt: (a) => (a >= BASE && a - BASE < claims.length ? ((claims[a - BASE] ?? 0) as ClaimKind) : Claim.free),
    owner: (a) => setup.owner?.(a),
    isFunction: (a) => functions.includes(a),
    functions: () => functions,
    accepted: (entry) => (functions.includes(entry) ? (readings.get(`${entry}:thumb`) ?? readings.get(`${entry}:arm`)) : undefined),
    read: (entry, mode) => readings.get(`${entry}:${mode}`) ?? walkReading(view, entry, mode, setup.walk),
    valid: (a) => setup.valid?.(a) ?? true,
    whyInvalid: (a) => setup.whyInvalid?.(a),
    neverValid: () => false,
    inProgress: () => false,
    adrOwner: () => undefined,
    pointers: buildPointerIndex(rom),
  };
  return view;
}

/** The PoC's Func.end: the code end extended by every pool or table that starts within 8 bytes of it. */
export function pocExtentEnd(shape: ReadingShape): Addr {
  const items = [...shape.pools.map((p) => [p, p + 4] as const), ...shape.tables.map((t) => [t.base, t.base + 4 * t.targets.length] as const)].sort((x, y) => x[0] - y[0]);
  let e = shape.codeEnd;
  for (;;) {
    const next = items.find(([a, b]) => b > e && a <= e + 8);
    if (next === undefined) return e;
    e = Math.max(e, next[1]);
  }
}

/** The reading of `entry` through the real walker; the policies default to REFERENCE_WALK, the extent to the PoC's. */
export function walkReading(view: AnalysisView, entry: Addr, mode: Mode, policies: readonly ResolvedPolicy[] = REFERENCE_WALK, far: ReadonlySet<Addr> = new Set(), noret: ReadonlyMap<Addr, RuleId> = new Map()): Reading {
  const env: WalkEnv = { view, policies, extentEnd: pocExtentEnd };
  return mode === 'thumb' ? walkThumb(env, entry, far, noret) : walkArm(env, entry);
}

/** The walk policies of `RULES` for the profile's walk slot (empty until the wave-1 walk rules land). */
export function registeredWalk(profile: CompilerProfile = AGBCC): readonly ResolvedPolicy[] {
  return profile.pipeline.walk.flatMap((id) => {
    const rule = RULES[id];
    return rule?.kind === 'walk' ? [{ id, rule }] : [];
  });
}

// ---------------------------------------------------------------------------------------------------
// Reference walk policies: the PoC's walk decisions, as test fixtures.

const MOV_LR_PC = 0xe1a0e00f;

const policy = (id: RuleId, onInsn: WalkPolicy['onInsn']): ResolvedPolicy => ({ id, rule: { kind: 'walk', onInsn } });

/** The PoC's walk decisions as policies, in agbcc's walk order. */
export const REFERENCE_WALK: readonly ResolvedPolicy[] = [
  policy('walk.pc-load-is-pool', (insn) => (insn.flow.kind === 'pool-load' ? { step: 'pool', addr: insn.flow.pool } : undefined)),
  policy('walk.table-by-register', (insn, c) => {
    if (c.mode !== 'thumb' || c.phase !== 'insn' || insn.flow.kind !== 'indirect' || insn.flow.via === 'bx') return undefined;
    const m = c.view.profile.idioms.matchTableJump(c.run, c.run.length - 1, c.view.rom);
    return m === undefined ? undefined : { step: 'table', table: { base: m.base, targets: m.targets, thumbBit: false } };
  }),
  policy('walk.mov-lr-pc-bx-is-call', (insn, c) => {
    if (c.mode !== 'arm' || (insn.flow.kind !== 'return' && insn.flow.kind !== 'indirect') || !insn.specId.startsWith('arm.bx')) return undefined;
    return c.run[c.run.length - 2]?.word === MOV_LR_PC ? { step: 'continue' } : undefined;
  }),
  policy('walk.mov-pc-without-table', (insn, c) =>
    c.phase === 'insn' && insn.flow.kind === 'indirect' && insn.flow.via !== 'bx' ? { step: 'end-path', exit: 'reg-jump' } : undefined,
  ),
  policy('walk.bx-pc-veneer', (insn) => (insn.flow.kind === 'mode-switch' ? { step: 'switch-mode', target: insn.flow.target } : undefined)),
  policy('walk.branch-into-function', (insn, c) => {
    if (c.phase !== 'insn' || insn.flow.kind !== 'branch') return undefined;
    const t = insn.flow.target;
    const foreign = t !== c.entry && !c.walked(t) && ((c.mode === 'arm' && t < c.entry) || c.view.isFunction(t) || c.view.claimAt(t) === Claim.code);
    return foreign ? { step: 'end-path', exit: 'tail' } : undefined;
  }),
  policy('walk.trailing-zero-padding', (insn, c) => (c.phase === 'stop' && insn.size === 2 && u16(c.view.rom, insn.addr) === 0 ? { step: 'padding' } : undefined)),
  policy('walk.noreturn-call-before-noncode', (insn, c) => (c.phase === 'stop' && insn.flow.kind === 'bl' ? { step: 'end-path', exit: 'noreturn-call' } : undefined)),
  policy('walk.swi-before-noncode', (insn, c) => (c.phase === 'stop' && insn.flow.kind === 'swi' ? { step: 'end-path', exit: 'swi-end' } : undefined)),
];

/** The word at a bus address (for assertions). */
export function wordAt(rom: Rom, a: Addr): number {
  return u32(rom, a);
}
