// Acceptance (the PoC's accept() and claim()): an accepted entry is read, recorded, claimed, and its
// callees, veneers and ARM adr targets are queued through the queue slot onto the worklist, which pops
// ascending. Callees of an accepted function are trusted: they are accepted without validity, as in the PoC.
import { RomliftInvariantError } from '../../../foundation/diagnostics/diagnostic.ts';
import { contains } from '../../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../../foundation/rom/span.ts';
import { provenance } from '../../provenance/provenance.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import type { Origin } from '../../provenance/vocabulary.ts';
import { makeReading, partsOf } from '../reading.ts';
import { Claim } from '../types.ts';
import type { Candidate, ClaimEdit, FunctionFact, Reading } from '../types.ts';
import { checkListed, isOtherModeOfListed, isUnlisted, recordUnlisted } from './confirm.ts';
import { factOf, factOfBlock } from './facts.ts';
import { inSpans, outsideSpans } from './seeds.ts';
import { touch } from './reuse.ts';
import { RULES } from './rules.ts';
import { analyzeArm, settle } from './settle.ts';
import { markEntry } from './state.ts';
import type { DriverState } from './state.ts';
import { also, emit } from './trail.ts';
import { ascending } from './worklist.ts';
import type { Worklist } from './worklist.ts';

/**
 * The origin a proposing rule gives what it proposes: its meta.origin in the run's registry, else that of the built-in
 * rule of its id (a driver test's registry may leave the proposing rule out). g2.rule-registry requires an origin of
 * every seed and gap rule, so a proposer with neither is a broken invariant.
 */
export function originOf(s: DriverState, rule: RuleId): Origin {
  const origin = s.rules.origin.get(rule) ?? RULES[rule]?.meta.origin;
  if (origin === undefined) throw new RomliftInvariantError(`${rule} proposed a function but has no origin`);
  return origin;
}

/** Applies one claim edit; the bytes of a data override keep their data claim (seeds.ts). */
export function write(s: DriverState, e: ClaimEdit): void {
  const lo = Math.max(e.span.start - s.rom.base, 0);
  const hi = Math.min(e.span.end - s.rom.base, s.claims.length);
  if (lo >= hi) return;
  if (s.reuse !== undefined) touch(s.reuse, s.rom.base + lo, s.rom.base + hi);
  if (e.when === 'free-bytes') {
    for (let k = lo; k < hi; k++) if (s.claims[k] === Claim.free) s.claims[k] = e.kind;
    return;
  }
  if (e.when === 'start-free' && s.claims[lo] !== Claim.free) return;
  if (s.dataOverrides.length === 0) {
    s.claims.fill(e.kind, lo, hi);
    return;
  }
  const B = s.rom.base;
  for (const part of outsideSpans(s.dataOverrides, B + lo, B + hi)) s.claims.fill(e.kind, part.start - B, part.end - B);
}

/** A 'verdict' event for every walk-slot answer the reading applied (Reading.steps; recorded only when a trail is on). */
function citeSteps(s: DriverState, r: Reading): void {
  for (const st of r.steps) emit(s, 'verdict', st.at, st.rule, [r.entry, st.at], st.step);
}

/** The PoC's claim(f): the instruction bytes as code, then the claim slot in order. `owner` is the accepted function `r` belongs to. */
export function claim(s: DriverState, owner: Addr, r: Reading): void {
  for (const i of r.insns) write(s, { span: { start: i.addr, end: i.addr + i.len }, kind: Claim.code, when: 'always' });
  const fact = factOf(s, owner);
  if (fact === undefined) return;
  for (const { id, rule } of s.rules.claim) {
    const edits = rule.claims(fact, r, s.view);
    for (const e of edits) write(s, e);
    if (edits.length > 0) emit(s, 'claim', r.entry, id, [r.entry], `${edits.length} edits`);
  }
}

function enqueue(s: DriverState, work: Worklist, c: Candidate): void {
  emit(s, 'propose', c.entry, c.proposedBy, c.cites, c.mode);
  work.push(c);
}

/** Takes an entry: records it, claims it, and returns its queued proposals. */
function take(s: DriverState, c: Candidate, r: Reading, note?: string): readonly Candidate[] {
  s.funcs.set(c.entry, {
    reading: r,
    origin: originOf(s, c.proposedBy),
    accepted: provenance(c.proposedBy, s.round, c.cites, note),
    also: [],
    absorbed: [],
  });
  s.order.push(c.entry);
  markEntry(s, c.entry);
  if (s.reuse !== undefined) touch(s.reuse, c.entry, c.entry + 1);
  s.ownerIndex = undefined;
  if (c.mode === 'thumb') s.settled.set(c.entry, r);
  claim(s, c.entry, r);
  if (c.mode === 'thumb') for (const a of r.adrs) s.adrOwner.set(a, c.entry);
  emit(s, 'accept', c.entry, c.proposedBy, c.cites, note);
  citeSteps(s, r);
  const fact = factOf(s, c.entry);
  return fact === undefined ? [] : queued(s, fact);
}

/** The queue slot's proposals for an accepted function or an absorbed block, in slot order. */
function queued(s: DriverState, fact: FunctionFact): readonly Candidate[] {
  return s.rules.queue.flatMap(({ id, rule }) => rule.queue(fact, s.view).map((p) => ({ ...p, proposedBy: id })));
}

/**
 * The PoC's accept(entry, mode, why): accepts `first` and everything it calls. Returns how many
 * functions were added (0 when `first` was already a function, or, in confirm mode, is not listed).
 */
export function accept(s: DriverState, first: Candidate, note?: string): number {
  const work = ascending(s.rules.rank, () => (s.seq += 1));
  enqueue(s, work, first);
  let added = 0;
  for (let c = work.pop(); c !== undefined; c = work.pop()) {
    if (s.funcs.has(c.entry)) {
      also(s, c);
      continue;
    }
    // An entry inside a data override is never taken, whoever proposes it (correctness-b0-3).
    if (!contains(s.rom, c.entry) || isOtherModeOfListed(s, c) || inSpans(s.dataOverrides, c.entry)) continue;
    if (isUnlisted(s, c)) {
      recordUnlisted(s, c, originOf(s, c.proposedBy));
      continue;
    }
    checkListed(s, c);
    const r = c.mode === 'thumb' ? settle(s, c.entry) : analyzeArm(s, c.entry);
    for (const q of take(s, c, r, c === first ? note : undefined)) enqueue(s, work, q);
    added += 1;
  }
  return added;
}

/**
 * The queue slot's proposals for an absorbed block, as the block is when it is absorbed, each accepted
 * with its own worklist (the PoC's absorbBlock accepts the block's calls one by one).
 */
export function acceptQueued(s: DriverState, into: Addr, block: Reading): number {
  const fact = factOfBlock(s, into, block);
  let added = 0;
  if (fact !== undefined) for (const c of queued(s, fact)) added += accept(s, c);
  return added;
}

/** The reading of `g` with the block `f` merged into it (the PoC's absorbBlock writes into g's maps). */
export function mergeReadings(s: DriverState, g: Reading, f: Reading): Reading {
  const parts = partsOf(g);
  const insns = [...g.insns, ...f.insns];
  const pools = [...g.pools, ...f.pools];
  const tables = [...g.tables, ...f.tables];
  const addrs = pools.map((p) => p.addr).filter((a, i, all) => all.indexOf(a) === i);
  const armTails = [...g.armTails, ...f.armTails];
  const shape = { entry: g.entry, codeEnd: Math.max(g.codeEnd, f.codeEnd), pools: addrs, tables, armTails };
  return makeReading(
    { ...parts, insns, pools, tables, armTails, adrs: [...g.adrs, ...f.adrs], calls: [...g.calls, ...f.calls], steps: [...g.steps, ...f.steps], end: s.rules.extentEnd(shape, s.profile) },
    s.rom,
  );
}

/** Merges the block `block` into the accepted function `into`, claims it and accepts its calls; returns how many functions those calls added. */
export function absorb(s: DriverState, into: Addr, block: Reading): number {
  const g = s.funcs.get(into);
  if (g === undefined) return 0;
  const merged = mergeReadings(s, g.reading, block);
  g.reading = merged;
  if (s.reuse !== undefined) touch(s.reuse, into, into + 1);
  if (merged.mode === 'thumb') s.settled.set(into, merged);
  const span: Span = { start: block.entry, end: block.end };
  g.absorbed.push(span);
  s.ownerIndex = undefined;
  for (const a of block.adrs) s.adrOwner.set(a, into);
  claim(s, into, block);
  emit(s, 'absorb', block.entry, s.profile.pipeline.gap.absorb, [into, block.entry]);
  citeSteps(s, block);
  return acceptQueued(s, into, block);
}
