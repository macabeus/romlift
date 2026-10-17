// Acceptance (the PoC's accept() and claim()): an accepted entry is read, recorded, claimed, and its
// callees, veneers and ARM adr targets are queued through the queue slot onto the worklist, which pops
// LIFO ('poc-lifo') or ascending. Callees of an accepted function are trusted: they are accepted
// without validity, as in the PoC.
import { contains } from '../../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../../foundation/rom/span.ts';
import { provenance } from '../../provenance/provenance.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import type { Origin } from '../../provenance/vocabulary.ts';
import { makeReading, partsOf } from '../reading.ts';
import { Claim } from '../types.ts';
import type { Candidate, ClaimEdit, Reading } from '../types.ts';
import { checkListed, isUnlisted, recordUnlisted } from './confirm.ts';
import { analyzeArm, settle } from './settle.ts';
import { also, emit, factOf } from './view.ts';
import type { DriverState } from './view.ts';
import { ascending, pocLifo } from './worklist.ts';

/** The origin a proposing rule gives what it proposes (its meta.origin). */
export function originOf(s: DriverState, rule: RuleId): Origin {
  return s.rules.origin.get(rule) ?? 'evidence';
}

/** Applies one claim edit. */
export function write(s: DriverState, e: ClaimEdit): void {
  const lo = Math.max(e.span.start - s.rom.base, 0);
  const hi = Math.min(e.span.end - s.rom.base, s.claims.length);
  if (lo >= hi) return;
  if (e.when === 'always') s.claims.fill(e.kind, lo, hi);
  else if (e.when === 'start-free') {
    if (s.claims[lo] === Claim.free) s.claims.fill(e.kind, lo, hi);
  } else for (let k = lo; k < hi; k++) if (s.claims[k] === Claim.free) s.claims[k] = e.kind;
}

/** The PoC's claim(f): the instruction bytes as code, then the claim slot in order. `owner` is the accepted function `r` belongs to. */
export function claim(s: DriverState, owner: Addr, r: Reading): void {
  s.tuning.oracle?.marker({ kind: 'claim', entry: r.entry, mode: r.mode });
  for (const i of r.insns) write(s, { span: { start: i.addr, end: i.addr + i.len }, kind: Claim.code, when: 'always' });
  const fact = factOf(s, owner);
  if (fact === undefined) return;
  for (const { id, rule } of s.rules.claim) {
    const edits = rule.claims(fact, r, s.view);
    for (const e of edits) write(s, e);
    if (edits.length > 0) emit(s, 'claim', r.entry, id, [r.entry], `${edits.length} edits`);
  }
}

function enqueue(s: DriverState, work: { push(c: Candidate): void }, c: Candidate): void {
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
  s.ownerIndex = undefined;
  if (c.mode === 'thumb') s.settled.set(c.entry, r);
  claim(s, c.entry, r);
  if (c.mode === 'thumb') for (const a of r.adrs) s.adrOwner.set(a, c.entry);
  emit(s, 'accept', c.entry, c.proposedBy, c.cites, note);
  const fact = factOf(s, c.entry);
  if (fact === undefined) return [];
  return s.rules.queue.flatMap(({ rule }) => rule.queue(fact, s.view));
}

/**
 * The PoC's accept(entry, mode, why): accepts `first` and everything it calls. Returns how many
 * functions were added (0 when `first` was already a function, or, in confirm mode, is not listed).
 */
export function accept(s: DriverState, first: Candidate, note?: string): number {
  const work = s.tuning.worklist === 'ascending' ? ascending(s.rules.rank, () => (s.seq += 1)) : pocLifo();
  enqueue(s, work, first);
  let added = 0;
  for (let c = work.pop(); c !== undefined; c = work.pop()) {
    if (s.funcs.has(c.entry)) {
      also(s, c);
      continue;
    }
    if (!contains(s.rom, c.entry)) continue;
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

/** The calls of an absorbed block, each accepted with its own worklist as a seed.call proposal (the PoC's absorbBlock). */
export function acceptCalls(s: DriverState, r: Reading): number {
  if (s.tuning.disabled.includes('seed.call')) return 0;
  let added = 0;
  for (const c of r.calls) added += accept(s, { entry: c.target, mode: c.mode, proposedBy: 'seed.call', cites: [c.site] });
  return added;
}

/** The reading of `g` with the block `f` merged into it (the PoC's absorbBlock writes into g's maps). */
export function mergeReadings(s: DriverState, g: Reading, f: Reading): Reading {
  const parts = partsOf(g);
  const insns = [...g.insns, ...f.insns];
  const pools = [...g.pools, ...f.pools];
  const tables = [...g.tables, ...f.tables];
  const addrs = pools.map((p) => p.addr).filter((a, i, all) => all.indexOf(a) === i);
  const shape = { entry: g.entry, codeEnd: Math.max(g.codeEnd, f.codeEnd), pools: addrs, tables };
  return makeReading(
    { ...parts, insns, pools, tables, adrs: [...g.adrs, ...f.adrs], calls: [...g.calls, ...f.calls], end: s.rules.extentEnd(shape, s.profile) },
    s.rom,
  );
}

/** Merges the block `block` into the accepted function `into`, claims it and accepts its calls. */
export function absorb(s: DriverState, into: Addr, block: Reading): void {
  const g = s.funcs.get(into);
  if (g === undefined) return;
  const merged = mergeReadings(s, g.reading, block);
  g.reading = merged;
  if (merged.mode === 'thumb') s.settled.set(into, merged);
  const span: Span = { start: block.entry, end: block.end };
  g.absorbed.push(span);
  s.ownerIndex = undefined;
  for (const a of block.adrs) s.adrOwner.set(a, into);
  claim(s, into, block);
  emit(s, 'absorb', block.entry, s.profile.pipeline.gap.absorb, [into, block.entry]);
  acceptCalls(s, block);
}
