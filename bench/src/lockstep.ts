// Lockstep against the proof of concept (architecture §4.5, D48, D56 f): romlift's driver runs with a
// RuleOracle backed by the PoC's log (bench/src/poc-log.ts: queries.ndjson and readings.ndjson, written
// by `export-poc --mode queries`). Because the driver calls every rule slot at the PoC's call site, the
// k-th call of our run is the k-th record of the log:
//
//   - a query whose family is answered gets the logged result (readings rebuilt with makeReading), and
//     the records nested under it, the PoC's own computation of that answer, are skipped; an answered
//     tryTiledHole or absorbBlock keeps the nested records of its side effects (the acceptance and the
//     absorption the driver then applies), so only its holeHead, or a null answer's whole subtree, is
//     skipped;
//   - a query whose family is computed is matched, its nested records are matched against the calls
//     our computation makes, and the answer is compared, normalised (whyInvalid by the validity rule its
//     text maps to, readings by their logged fields, armAhead by [at, reading]);
//   - the claim and forgetCandidates markers are always compared (acceptance and absorb sequence,
//     epoch boundaries); couldBeCode and inPointerTable live inside rules and are never asked, so their
//     records are passed over and their nested records matched;
//   - a computed valid or settle whose record has nothing nested, for an entry the PoC computed inside a
//     subtree skipped here, is the PoC answering from its memo, which ours lacks (it never made that
//     call): it is recalled from the log, as the PoC's memo answers it, and counted apart.
//
// What a skipped subtree leaves in the PoC's state beyond those memos is not reproduced: the intrinsic
// validity failures it found feed the PoC's data-pointer harvest, so the seed family can be computed
// only with the valid family computed too (the roadmap's 2.C proves them together).
//
// The run stops at the first divergence, reported with its seq, epoch, the PoC's call, both answers
// and the path of its parents.
//
// Some slots have no query in the log: the seed proposers and the accept() queue, the accept veto, the
// gap comparison, padding step, end anchor and backward chain, the claim slot and the region slot. When
// their family is answered, the lockstep runs them as the PoC wrote them (replayRules below; the
// seeds of run() are read from the log's claim records), so the driver alone, with every family
// answered, is proven against the PoC; when their family is computed, the registered rules run.
import { join } from 'node:path';

import {
  Claim,
  compareCodeUnits,
  compareNumbers,
  contains,
  familyOf,
  profileById,
  romFromBytes,
  u16,
  u32,
  type AnalysisOptions,
  type CompilerProfile,
  type FunctionFact,
  type MissReason,
  type Mode,
  type Origin,
  type Rom,
  type RuleId,
  type StartupRegion,
} from 'romlift';
import { decode } from 'romlift/isa';
import {
  makeReading,
  ORACLE_FAMILY,
  RULES,
  runAnalysis,
  type AnalysisFamily,
  type AnalysisTuning,
  type AnalysisView,
  type Candidate,
  type ClaimEdit,
  type OracleAnswer,
  type OracleMarker,
  type OracleMethod,
  type OracleQuery,
  type Reading,
  type ReadingShape,
  type RegisteredRule,
  type RuleContract,
  type RuleOracle,
  type RuleRegistry,
  type ValidityFailure,
} from 'romlift/internal';
import { sha1Of } from 'romlift/node';

import type { BenchContext } from './context.ts';
import { loadDatasets, tuningDatasets } from './dataset.ts';
import { BenchError, exists, readFileBytes, readJson } from './files.ts';
import { resultParityDigest } from './parity.ts';
import { parsePocDigests, pocDigestsPath } from './parity-view.ts';
import { answeredBy, LOCKSTEP_SETS, type EvidenceFamily, type LockstepSummary } from './parity-evidence.ts';
import { openPocLog, queriesPath, type PocQuery, type PocReading, type ReadingRef, type SettledResult } from './poc-log.ts';
import { readPinnedPocSource } from './poc-source.ts';

/** The eight analysis families, in the order of architecture §4.1. */
export const ANALYSIS_FAMILIES: readonly AnalysisFamily[] = ['seed', 'walk', 'bl', 'valid', 'accept', 'gap', 'claim', 'region'];

/** The rule a bl verdict read from the log is attributed to: the log has the verdict, not the rule. */
export const LOGGED_VERDICT: RuleId = 'bl.poc-log';

/** The PoC's methods the driver never asks (they live inside a rule); their records are passed over. */
const UNASKED: ReadonlySet<string> = new Set(['couldBeCode', 'inPointerTable']);

// ---------------------------------------------------------------------------------------------------
// The report.

/** One call of the PoC's log, as a divergence names it and its parents. */
export interface LoggedCall {
  readonly seq: number;
  readonly method: string;
  readonly args: readonly unknown[];
}

/**
 * Where our run and the PoC's part. kind: 'query' (our next query is not the PoC's next call),
 * 'marker' (a claim or epoch boundary differs), 'answer' (a computed answer differs), 'unasked' (the
 * PoC made a call ours did not), 'unlogged' (ours made a call after the log ended).
 */
export interface Divergence extends LoggedCall {
  readonly kind: 'query' | 'marker' | 'answer' | 'unasked' | 'unlogged';
  readonly epoch: number;
  /** Our call or answer, normalised. */
  readonly ours: unknown;
  /** The PoC's, normalised. */
  readonly poc: unknown;
  /** The parents of the PoC's call, outermost first. */
  readonly path: readonly LoggedCall[];
  readonly detail: string;
}

export interface LockstepCounts {
  /** Records in the log. */
  readonly queries: number;
  /** Records matched to a call of ours: queries and markers. */
  readonly matched: number;
  /** Queries answered from the log. */
  readonly answered: number;
  /** Computed answers compared with the log. */
  readonly compared: number;
  /** claim and forgetCandidates markers compared. */
  readonly markers: number;
  /** Records skipped: nested under an answered query, or never asked. */
  readonly skipped: number;
  /**
   * Computed valid or settle queries answered from the log because the PoC answered them from its memo
   * of a call made inside a subtree skipped here (ours never made that call, so ours has no memo of it).
   */
  readonly recalled: number;
}

export interface LockstepResult extends LockstepCounts {
  /** The families answered from the log (bl follows walk). */
  readonly families: readonly AnalysisFamily[];
  readonly divergence?: Divergence;
  /** Present when the run completed. */
  readonly parityDigest?: string;
  readonly functions?: number;
}

/** Thrown by the oracle at the first divergence; runLockstep reports it. */
export class LockstepDivergence extends Error {
  readonly divergence: Divergence;
  constructor(divergence: Divergence) {
    super(`lockstep diverges at seq ${divergence.seq} (${divergence.kind}): ${divergence.detail}`);
    this.name = 'LockstepDivergence';
    this.divergence = divergence;
  }
}

// ---------------------------------------------------------------------------------------------------
// Readings: the log's, rebuilt; both sides normalised for comparison.

const ERROR_REASON: Readonly<Record<string, Reading['errors'][number]['reason']>> = {
  out_of_rom: 'out-of-rom',
  not_code: 'not-code',
  bl_out_of_rom: 'bl-out-of-rom',
  pool_out_of_rom: 'pool-out-of-rom',
};

/** The target of the Thumb bl at `site` (the log keeps far sites, not their targets). */
function blTarget(rom: Rom, site: number): number {
  if (!contains(rom, site, 4)) return site;
  const insn = decode('thumb', (u16(rom, site) | (u16(rom, site + 2) << 16)) >>> 0, site);
  return insn.flow.kind === 'bl' ? insn.flow.target : site;
}

/** A logged reading as a Reading; `settled` adds the far and noret sites settle() decided. */
export function readingFromLog(rom: Rom, r: PocReading, settled?: { readonly far: readonly number[]; readonly noret: readonly number[] }): Reading {
  const far = settled?.far ?? [];
  const noret = settled?.noret ?? [];
  const verdicts = [
    ...far.map((site) => ({ site, target: blTarget(rom, site), verdict: 'far' as const, rule: LOGGED_VERDICT })),
    ...noret.map((site) => ({ site, target: r.blSites.find(([s]) => s === site)?.[1] ?? blTarget(rom, site), verdict: 'noreturn' as const, rule: LOGGED_VERDICT })),
  ];
  return makeReading(
    {
      entry: r.entry,
      mode: r.mode,
      insns: r.insns.map(([addr, len]) => ({ addr, len })),
      pools: r.pools.map(([addr, value]) => ({ addr, value })),
      tables: r.tables.map(([base, targets]) => ({ base, targets, thumbBit: false })),
      calls: r.calls.map(([target, mode, site]) => ({ site, target, mode })),
      blSites: r.blSites.map(([site, target]) => ({ site, target })),
      deadEnd: r.deadEnd,
      balance: r.balance,
      returns: r.returns,
      errors: r.errors.map(([reason, at]) => {
        const ours = ERROR_REASON[reason];
        if (ours === undefined) throw new BenchError(`the log names a walk error ${JSON.stringify(reason)} romlift does not know`);
        return { reason: ours, at };
      }),
      veneers: r.veneers,
      adrs: r.adrs,
      tails: r.tails,
      tailExits: r.tailExits,
      far,
      noret,
      blVerdicts: verdicts,
      end: r.end,
    },
    rom,
  );
}

type Normal = Readonly<Record<string, unknown>>;

const byFirst = (a: readonly [number, ...unknown[]], b: readonly [number, ...unknown[]]): number => a[0] - b[0];

/** The logged fields of a reading, in the log's units and order. */
function normalReading(r: Reading, settled: boolean): Normal {
  return {
    entry: r.entry,
    mode: r.mode,
    insns: r.insns.map((i) => [i.addr, i.len]),
    pools: r.pools.map((p) => [p.addr, p.value] as const).sort(byFirst),
    tables: r.tables.map((t) => [t.base, [...t.targets]] as const).sort(byFirst),
    calls: r.calls.map((c) => [c.target, c.mode, c.site]),
    blSites: r.blSites.map((b) => [b.site, b.target]),
    deadEnd: r.deadEnd,
    balance: r.balance,
    returns: r.returns,
    errors: r.errors.map((e) => [e.reason.replace(/-/g, '_'), e.at]),
    veneers: r.veneers,
    adrs: r.adrs,
    tails: r.tails,
    tailExits: r.tailExits,
    codeEnd: r.codeEnd,
    end: r.end,
    ...(settled ? { far: r.far, noret: r.noret } : {}),
  };
}

function normalPocReading(r: PocReading, settled?: SettledResult): Normal {
  return {
    entry: r.entry,
    mode: r.mode,
    insns: r.insns,
    pools: r.pools,
    tables: r.tables,
    calls: r.calls,
    blSites: r.blSites,
    deadEnd: r.deadEnd,
    balance: r.balance,
    returns: r.returns,
    errors: r.errors,
    veneers: r.veneers,
    adrs: r.adrs,
    tails: r.tails,
    tailExits: r.tailExits,
    codeEnd: r.codeEnd,
    end: r.end,
    ...(settled === undefined ? {} : { far: settled.far, noret: settled.noret }),
  };
}

/** The members of two normal forms that differ; [] when they are equal. */
function differing(a: unknown, b: unknown): string[] {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null || Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b) ? [] : ['value'];
  }
  const ra = a as Normal;
  const rb = b as Normal;
  const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort(compareCodeUnits);
  return keys.filter((k) => JSON.stringify(ra[k]) !== JSON.stringify(rb[k]));
}

// ---------------------------------------------------------------------------------------------------
// whyInvalid: the PoC's text, by the validity rule it maps to.

const WHY_INVALID: readonly { readonly prefix: string; readonly rule: RuleId; readonly reason: MissReason; readonly intrinsic: boolean }[] = [
  { prefix: 'outside the ROM', rule: 'valid.in-rom-unclaimed', reason: 'inside-code', intrinsic: true },
  { prefix: 'inside claimed bytes', rule: 'valid.in-rom-unclaimed', reason: 'inside-code', intrinsic: true },
  { prefix: 'decodes to nothing', rule: 'valid.decodes', reason: 'decode-error', intrinsic: true },
  { prefix: 'decode error ', rule: 'valid.decodes', reason: 'decode-error', intrinsic: true },
  { prefix: 'a return path pops more than it pushed', rule: 'valid.balanced-stack', reason: 'pops-frame', intrinsic: true },
  { prefix: 'no return and no push {.., lr}', rule: 'valid.returns-or-prologue', reason: 'no-return-no-prologue', intrinsic: true },
  { prefix: 'its code overlaps claimed bytes', rule: 'valid.no-claimed-code', reason: 'pool-claimed', intrinsic: true },
  { prefix: 'its pool at ', rule: 'valid.pool-not-code', reason: 'pool-claimed', intrinsic: true },
  { prefix: 'its words are Thumb code pointers', rule: 'valid.not-pointer-table', reason: 'pointer-table', intrinsic: true },
  { prefix: 'not dense', rule: 'valid.dense', reason: 'not-dense', intrinsic: true },
  { prefix: 'calls ', rule: 'valid.calls-code', reason: 'calls-non-code', intrinsic: false },
];

/** The validity failure a whyInvalid text of the PoC stands for. */
export function failureOfText(text: string): ValidityFailure {
  const row = WHY_INVALID.find((w) => text.startsWith(w.prefix));
  if (row === undefined) throw new BenchError(`the log's whyInvalid text ${JSON.stringify(text)} maps to no validity rule`);
  return { rule: row.rule, reason: row.reason, intrinsic: row.intrinsic, detail: text };
}

// ---------------------------------------------------------------------------------------------------
// Queries: the PoC's argument list of ours, the logged answer, and both normalised.

/** Our query's arguments in the log's order and units. */
function argsOf(q: OracleQuery): readonly (number | string)[] {
  switch (q.method) {
    case 'settle':
    case 'analyzeArm':
    case 'valid':
    case 'whyInvalid':
    case 'inPointerTable':
      return [q.entry];
    case 'couldBeCode':
      return [q.target];
    case 'acceptable':
      return [q.entry, q.why];
    case 'pointerCandidates':
      return [];
    case 'thumbCandidate':
      return [q.entry, q.lo, q.hi];
    case 'armAhead':
      return [q.p, q.end];
    case 'holeHead':
    case 'tryTiledHole':
      return [q.entry, q.hi];
    case 'absorbBlock':
      return [q.p, q.start, q.end];
  }
}

function sameCall(r: PocQuery, method: string, args: readonly unknown[]): boolean {
  return r.method === method && r.args.length === args.length && r.args.every((a, i) => a === args[i]);
}

/** Rebuilt readings, one per logged reading and settle verdicts. */
function readingCache(rom: Rom): { of(ref: ReadingRef, settled?: SettledResult): Reading } {
  const cache = new Map<string, Reading>();
  return {
    of(ref, settled) {
      const key = settled === undefined ? ref.key : `${ref.key}:${settled.far.join(',')}:${settled.noret.join(',')}`;
      let r = cache.get(key);
      if (r === undefined) {
        r = readingFromLog(rom, ref.reading, settled);
        cache.set(key, r);
      }
      return r;
    },
  };
}

/** The logged result of `r` as the driver's answer. */
function answerOf(r: PocQuery, readings: ReturnType<typeof readingCache>): unknown {
  switch (r.method) {
    case 'valid':
    case 'acceptable':
    case 'couldBeCode':
    case 'inPointerTable':
      return r.result;
    case 'whyInvalid':
      return r.result === null ? null : failureOfText(r.result);
    case 'settle':
      return readings.of(r.result, r.result);
    case 'analyzeArm':
      return readings.of(r.result);
    case 'thumbCandidate':
    case 'holeHead':
    case 'tryTiledHole':
      return r.result === null ? null : readings.of(r.result);
    case 'armAhead':
      return r.result === null ? null : { at: r.result[0], reading: readings.of(r.result[1]) };
    case 'absorbBlock':
      return r.result;
    case 'pointerCandidates':
      return { pool: r.result.pool, data: r.result.data };
    case 'forgetCandidates':
    case 'claim':
      throw new BenchError(`a ${r.method} record is a marker, never an answer`);
  }
}

/** The PoC's answer, normalised. */
function normalPoc(r: PocQuery): unknown {
  switch (r.method) {
    case 'whyInvalid':
      return r.result === null ? null : failureOfText(r.result).rule;
    case 'settle':
      return normalPocReading(r.result.reading, r.result);
    case 'analyzeArm':
      return normalPocReading(r.result.reading);
    case 'thumbCandidate':
    case 'holeHead':
    case 'tryTiledHole':
      return r.result === null ? null : normalPocReading(r.result.reading);
    case 'armAhead':
      return r.result === null ? null : { at: r.result[0], reading: normalPocReading(r.result[1].reading) };
    default:
      return r.result;
  }
}

/** Our answer to `method`, normalised as normalPoc normalises the PoC's. */
function normalOurs(method: OracleMethod, ours: unknown): unknown {
  switch (method) {
    case 'whyInvalid':
      return ours === null || ours === undefined ? null : (ours as ValidityFailure).rule;
    case 'settle':
      return normalReading(ours as Reading, true);
    case 'analyzeArm':
      return normalReading(ours as Reading, false);
    case 'thumbCandidate':
    case 'holeHead':
    case 'tryTiledHole':
      return ours === null ? null : normalReading(ours as Reading, false);
    case 'armAhead': {
      const a = ours as OracleAnswer<'armAhead'>;
      return a === null ? null : { at: a.at, reading: normalReading(a.reading, false) };
    }
    case 'pointerCandidates': {
      const c = ours as OracleAnswer<'pointerCandidates'>;
      return { pool: c.pool, data: c.data };
    }
    default:
      return ours;
  }
}

// ---------------------------------------------------------------------------------------------------
// The oracle over a log.

/** Where each record's subtree ends: one past its last nested record. */
function subtreeEnds(records: readonly PocQuery[]): Int32Array {
  const ends = new Int32Array(records.length);
  const open: number[] = [];
  records.forEach((r, i) => {
    while (open.length > 0 && open[open.length - 1] !== r.parent) ends[open.pop() as number] = i;
    open.push(i);
  });
  for (const k of open) ends[k] = records.length;
  return ends;
}

/** The families answered: bl follows walk, since the bl verdicts are inside settle. */
export function answeredFamilies(families: readonly AnalysisFamily[]): readonly AnalysisFamily[] {
  const set = new Set(families);
  if (set.has('bl') && !set.has('walk')) throw new BenchError('bl is answered only with walk: the bl verdicts are inside settle()');
  if (set.has('walk')) set.add('bl');
  return ANALYSIS_FAMILIES.filter((f) => set.has(f));
}

export interface LogOracle extends RuleOracle {
  counts(): LockstepCounts;
  /** After the run: the PoC's calls our run never made, if any. */
  finish(): Divergence | undefined;
}

/** A RuleOracle over the records of one log; `families` are answered, the rest compared. */
export function logOracle(records: readonly PocQuery[], families: readonly AnalysisFamily[], rom: Rom): LogOracle {
  const answered = answeredFamilies(families);
  const n = records.length;
  const ends = subtreeEnds(records);
  const readings = readingCache(rom);
  const computed: number[] = [];
  const counts = { queries: n, matched: 0, answered: 0, compared: 0, markers: 0, skipped: 0, recalled: 0 };
  let i = 0;
  let epoch = 0;
  // What the PoC memoised inside the subtrees skipped under answered queries (the calls ours never made):
  // valid and settle per epoch, and the intrinsic validity failures for good.
  let memo = new Set<string>();
  const never = new Set<number>();
  const remember = (from: number, to: number): void => {
    for (let j = from; j < to; j++) {
      const r = records[j] as PocQuery;
      if (r.method === 'settle') memo.add(`settle:${r.args[0]}`);
      else if (r.method === 'valid') {
        memo.add(`valid:${r.args[0]}`);
        const why = records[j + 1];
        if (!r.result && !(why?.method === 'whyInvalid' && why.parent === j && why.result !== null && why.result.startsWith('calls '))) never.add(r.args[0]);
      }
    }
  };
  /** A computed valid or settle the PoC answered from what it memoised in a skipped subtree. */
  const recalled = (k: number): boolean => {
    const r = records[k] as PocQuery;
    if (ends[k] !== k + 1) return false;
    if (r.method === 'valid') return memo.has(`valid:${r.args[0]}`) || (!r.result && never.has(r.args[0]));
    return r.method === 'settle' && memo.has(`settle:${r.args[0]}`);
  };

  const call = (k: number): LoggedCall => {
    const r = records[k] as PocQuery;
    return { seq: r.seq, method: r.method, args: r.args };
  };
  const path = (k: number): LoggedCall[] => {
    const out: LoggedCall[] = [];
    for (let p = records[k]?.parent ?? null; p !== null; p = records[p]?.parent ?? null) out.unshift(call(p));
    return out;
  };
  const diverge = (kind: Divergence['kind'], k: number, ours: unknown, poc: unknown, detail: string): never => {
    const at = k < n ? { ...call(k), epoch: (records[k] as PocQuery).epoch, path: path(k) } : { seq: n, method: '', args: [], epoch, path: [] };
    throw new LockstepDivergence({ kind, ...at, ours, poc, detail });
  };
  /** Skips calls the driver never makes; the index of the next record. */
  const next = (ours: unknown): number => {
    while (i < n && UNASKED.has((records[i] as PocQuery).method)) {
      i++;
      counts.skipped++;
    }
    if (i >= n) diverge('unlogged', n, ours, null, 'our run makes a call after the end of the PoC log');
    return i;
  };
  /** Where matching resumes after an answered record: past its subtree, or into its side effects. */
  const resume = (k: number): number => {
    const r = records[k] as PocQuery;
    const end = ends[k] ?? n;
    if (r.method === 'absorbBlock' && r.result !== null) return k + 1;
    if (r.method === 'tryTiledHole' && r.result !== null) {
      const head = records[k + 1];
      return k + 1 < end && head?.method === 'holeHead' && head.parent === k ? (ends[k + 1] ?? end) : k + 1;
    }
    return end;
  };

  return {
    answered,
    ask<M extends OracleMethod>(query: OracleQuery<M>): OracleAnswer<M> | undefined {
      const q = query as OracleQuery;
      const args = argsOf(q);
      const k = next({ method: q.method, args });
      const r = records[k] as PocQuery;
      if (!sameCall(r, q.method, args)) diverge('query', k, { method: q.method, args }, { method: r.method, args: r.args }, `ours asks ${q.method}(${args.join(', ')}), the PoC calls ${r.method}(${r.args.join(', ')})`);
      counts.matched++;
      if (!(answered as readonly string[]).includes(ORACLE_FAMILY[q.method])) {
        if (recalled(k)) {
          counts.recalled++;
          i = k + 1;
          return answerOf(r, readings) as OracleAnswer<M>;
        }
        computed.push(k);
        i = k + 1;
        return undefined;
      }
      counts.answered++;
      i = resume(k);
      remember(k + 1, i);
      counts.skipped += Math.max(0, i - k - 1);
      return answerOf(r, readings) as OracleAnswer<M>;
    },
    check<M extends OracleMethod>(query: OracleQuery<M>, ours: OracleAnswer<M>): void {
      const k = computed.pop();
      if (k === undefined) throw new BenchError(`check(${query.method}) without its ask`);
      const r = records[k] as PocQuery;
      const end = ends[k] ?? n;
      while (i < end && UNASKED.has((records[i] as PocQuery).method) && ends[i] === i + 1) {
        i++;
        counts.skipped++;
      }
      if (i < end) diverge('unasked', i, null, call(i), `the PoC calls ${(records[i] as PocQuery).method} inside ${r.method}(${r.args.join(', ')}); ours does not`);
      const a = normalOurs(query.method, ours);
      const b = normalPoc(r);
      const fields = differing(a, b);
      if (fields.length > 0) diverge('answer', k, a, b, `${r.method}(${r.args.join(', ')}) answers differ in ${fields.join(', ')}`);
      counts.compared++;
    },
    marker(m: OracleMarker): void {
      const ours = m.kind === 'claim' ? { method: 'claim', entry: m.entry, mode: m.mode } : { method: 'forgetCandidates', epoch: m.epoch };
      const k = next(ours);
      const r = records[k] as PocQuery;
      if (m.kind === 'forgetCandidates') {
        epoch = m.epoch;
        memo = new Set();
        if (r.method !== 'forgetCandidates' || r.epoch !== m.epoch) diverge('marker', k, ours, { method: r.method, args: r.args, epoch: r.epoch }, `ours begins epoch ${m.epoch}; the PoC calls ${r.method}`);
      } else if (r.method !== 'claim' || r.result.entry !== m.entry || r.result.mode !== m.mode) {
        diverge('marker', k, ours, r.method === 'claim' ? { method: 'claim', entry: r.result.entry, mode: r.result.mode } : { method: r.method, args: r.args }, `ours claims ${m.mode} ${m.entry.toString(16)}; the PoC calls ${r.method}(${r.args.join(', ')})`);
      }
      i = k + 1;
      counts.matched++;
      counts.markers++;
    },
    counts: () => ({ ...counts }),
    finish() {
      while (i < n && UNASKED.has((records[i] as PocQuery).method)) {
        i++;
        counts.skipped++;
      }
      if (i >= n) return undefined;
      try {
        return diverge('unasked', i, null, call(i), `the PoC calls ${(records[i] as PocQuery).method} after our run ended`);
      } catch (error) {
        if (error instanceof LockstepDivergence) return error.divergence;
        throw error;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The PoC's answers for the slots the log does not record (used only for answered families).

function standIn<C extends RuleContract>(id: RuleId, summary: string, contract: C, origin?: Origin): RegisteredRule {
  const meta = {
    id,
    summary: `lockstep stand-in: ${summary}`,
    restsOn: "the proof of concept's code (romlift-poc/src/analysis.ts)",
    recovers: 'nothing: it answers a slot the PoC log does not record',
    reads: [],
    adds: [],
    ...(origin === undefined ? {} : { origin }),
  };
  return { ...contract, meta } as RegisteredRule;
}

const candidate = (entry: number, mode: Mode, proposedBy: RuleId, cites: readonly number[]): Candidate => ({ entry, mode, proposedBy, cites });

/** The PoC's isPadding(k): an unclaimed zero byte, or a byte of a 0x46C0 halfword. */
function padding(v: AnalysisView, a: number): boolean {
  return v.claimAt(a) === Claim.free && v.profile.idioms.isPadding(v.rom, a, undefined);
}

/** The PoC's anchoredAtStart(f). */
function anchoredAtStart(entry: number, v: AnalysisView): boolean {
  let k = entry - 1;
  while (k >= v.rom.base && entry - k <= v.profile.anchorSlack && padding(v, k)) k--;
  return k >= v.rom.base && v.claimAt(k) !== Claim.free;
}

/** The PoC's anchoredAtEnd(f). */
function anchoredAtEnd(r: Reading, v: AnalysisView): boolean {
  let k = r.end;
  while (k < v.rom.end && k - r.end < v.profile.anchorSlack && padding(v, k)) k++;
  return k < v.rom.end && v.isFunction(k);
}

function fills(r: Reading, end: number, slack: number): boolean {
  const d = end - r.end;
  return d >= 0 && d <= slack;
}

/** The PoC's Func.end: the code end, extended by every pool or table starting within extentPoolGap bytes of it. */
export function pocExtentEnd(shape: ReadingShape, profile: CompilerProfile): number {
  const items = [...shape.pools.map((p) => [p, p + 4] as const), ...shape.tables.map((t) => [t.base, t.base + 4 * t.targets.length] as const)].sort((x, y) => x[0] - y[0]);
  let e = shape.codeEnd;
  for (;;) {
    const next = items.find(([a, b]) => b > e && a <= e + profile.extentPoolGap);
    if (next === undefined) return e;
    e = Math.max(e, next[1]);
  }
}

/** run()'s seeds of one origin, in the order the PoC accepted them (its claim records). */
function loggedSeeds(records: readonly PocQuery[], origin: string, mode: Mode, rule: RuleId): readonly Candidate[] {
  return records.flatMap((r) => (r.method === 'claim' && !r.result.absorbed && r.result.origin === origin ? [candidate(r.result.entry, mode, rule, [r.result.entry])] : []));
}

function seedStandIns(records: readonly PocQuery[]): RegisteredRule[] {
  const fromOptions = (rule: 'seed.listed' | 'seed.override' | 'seed.evidence-hint', origin: Origin): RegisteredRule =>
    standIn(rule, `the options' ${rule} seeds`, {
      kind: 'seed',
      seeds: (v: AnalysisView) => v.seeds.filter((s) => s.rule === rule).map((s) => candidate(s.entry, s.mode, rule, [s.entry])).sort((a, b) => a.entry - b.entry),
    }, origin);
  const romEntry = loggedSeeds(records, 'rom entry', 'arm', 'seed.rom-entry');
  const startup = loggedSeeds(records, 'startup pointer', 'thumb', 'seed.startup-pointer');
  return [
    standIn('seed.rom-entry', "run()'s cartridge entry, from the log", { kind: 'seed', seeds: () => romEntry }, 'rom-entry'),
    standIn('seed.startup-pointer', "run()'s startup pointers, from the log", { kind: 'seed', seeds: () => startup }, 'startup-pointer'),
    fromOptions('seed.listed', 'listed'),
    fromOptions('seed.override', 'override'),
    fromOptions('seed.evidence-hint', 'evidence'),
    standIn('seed.call', "accept(): every call", { kind: 'queue', queue: (f: FunctionFact) => f.calls.map((c) => candidate(c.target, c.mode, 'seed.call', [c.site])) }, 'call'),
    standIn('seed.veneer', 'accept(): every veneer, as ARM', { kind: 'queue', queue: (f: FunctionFact) => f.veneers.map((a) => candidate(a, 'arm', 'seed.veneer', [f.entry])) }, 'veneer'),
    standIn(
      'seed.adr',
      'accept(): the adr targets of an ARM function above its entry',
      {
        kind: 'queue',
        queue: (f: FunctionFact, v: AnalysisView) =>
          f.mode !== 'arm' ? [] : f.adrs.filter((a) => contains(v.rom, a) && (a & 3) === 0 && a > f.entry).map((a) => candidate(a, 'arm', 'seed.adr', [f.entry])),
      },
      'adr',
    ),
  ];
}

function acceptStandIns(): RegisteredRule[] {
  return [
    standIn('accept.tiny-anchored-at-start', "thumbCandidate()'s stub veto", {
      kind: 'accept-veto',
      reason: 'unanchored',
      vetoes(c: Candidate, r: Reading, v: AnalysisView): string | undefined {
        if (c.proposedBy !== 'gap.forward-chain' || r.insns.length >= v.profile.tinyFunctionInsns) return undefined;
        const word = contains(v.rom, c.entry, 4) ? (u16(v.rom, c.entry) | (u16(v.rom, c.entry + 2) << 16)) >>> 0 : u16(v.rom, c.entry);
        const first = decode('thumb', word, c.entry).flow.kind;
        if (first === 'branch' || first === 'bl') return 'a stub that opens with a branch';
        return anchoredAtStart(c.entry, v) ? undefined : 'a stub with no anchor at its start';
      },
    }),
  ];
}

function gapStandIns(): RegisteredRule[] {
  return [
    standIn(
      'gap.arm-over-prologueless-thumb',
      "fillGaps()'s Thumb/ARM comparison",
      {
        kind: 'gap-prefer',
        prefer: (thumb: Reading, arm: Reading, v: AnalysisView) =>
          v.profile.idioms.isPrologue(v.rom, thumb.entry, 'thumb') || (arm.entry === thumb.entry && arm.codeEnd <= thumb.end) ? 'thumb' : 'arm',
      },
      'arm-gap-scan',
    ),
    standIn(
      'gap.skip-padding-and-pointers',
      "fillGaps()'s step over a zero or pointer word",
      {
        kind: 'gap-skip',
        skip(c, v): number | undefined {
          if (!contains(v.rom, c.at, 4)) return undefined;
          const w = u32(v.rom, c.at);
          return w === 0 || ((w & 1) !== 0 && contains(v.rom, w - 1)) ? c.at + 4 : undefined;
        },
      },
      'gap-scan',
    ),
    standIn(
      'gap.end-anchor',
      "fillGaps()'s end-anchor loop, one acceptance per call",
      {
        kind: 'gap',
        propose(c, v): Candidate | undefined {
          const B = v.rom.base;
          const p = c.at - B;
          const end = c.end - B;
          const scan = v.profile.gapScan;
          let best: number | undefined;
          let bestPrologue = false;
          const floor = Math.max(p, end - scan.backwardWindow, c.head === undefined ? 0 : c.head.end - B);
          for (let q = (end - 4) & ~3; q >= floor; q -= 4) {
            const e = B + q;
            if (v.isFunction(e) || v.claimAt(e) !== Claim.free || !contains(v.rom, e, 4) || u32(v.rom, e) === 0 || !v.valid(e)) continue;
            const f = v.read(e, 'thumb');
            if (f.insns.length < scan.minInsns || f.codeEnd - B > end || !(fills(f, B + end, scan.fillSlack) || anchoredAtEnd(f, v))) continue;
            const prologue = v.profile.idioms.isPrologue(v.rom, e, 'thumb');
            if (best === undefined || (prologue && !bestPrologue)) {
              best = q;
              bestPrologue = prologue;
            } else if (prologue === bestPrologue && !prologue) break;
          }
          return best === undefined ? undefined : candidate(B + best, 'thumb', 'gap.end-anchor', [B + best, c.end]);
        },
      },
      'gap-scan',
    ),
    standIn(
      'gap.backward-prologue-chain',
      "fillGaps()'s backward chain of prologues, one acceptance per call",
      {
        kind: 'gap',
        propose(c, v): Candidate | undefined {
          const B = v.rom.base;
          const end = c.end - B;
          const floor = Math.max(c.at - B, end - v.profile.gapScan.prologueDistance);
          for (let q = (end - 4) & ~3; q >= floor; q -= 4) {
            const e = B + q;
            if (!v.profile.idioms.opensWithPushLr(v.rom, e) || v.isFunction(e) || !v.valid(e)) continue;
            if (fills(v.read(e, 'thumb'), B + end, v.profile.gapScan.fillSlack)) return candidate(e, 'thumb', 'gap.backward-prologue-chain', [e, c.end]);
          }
          return undefined;
        },
      },
      'gap-scan',
    ),
  ];
}

function claimStandIns(): RegisteredRule[] {
  return [
    standIn('claim.adjacent-pools', "claim(): pools, tables and a dense extent's dead bytes; Func.end", {
      kind: 'claim',
      claims(_f: FunctionFact, r: Reading, v: AnalysisView): readonly ClaimEdit[] {
        const edits: ClaimEdit[] = [
          ...r.pools.map((p) => ({ span: { start: p.addr, end: p.addr + 4 }, kind: Claim.pool, when: 'start-free' as const })),
          ...r.tables.map((t) => ({ span: { start: t.base, end: t.base + 4 * t.targets.length }, kind: Claim.table, when: 'always' as const })),
        ];
        const d = v.profile.density;
        if (r.holeBytes <= Math.max(d.minHoles, (r.end - r.entry) >> d.holeShift)) edits.push({ span: { start: r.entry, end: r.end }, kind: Claim.dead, when: 'free-bytes' });
        return edits;
      },
      extentEnd: pocExtentEnd,
    }),
    standIn('claim.far-pools', 'claim(): done by the claim.adjacent-pools stand-in, in the PoC order', { kind: 'claim', claims: () => [] }),
    standIn('claim.dead-code-in-extent', 'claim(): done by the claim.adjacent-pools stand-in, in the PoC order', { kind: 'claim', claims: () => [] }),
  ];
}

/** The PoC's startup getter. */
function startupOf(v: AnalysisView): StartupRegion {
  const B = v.rom.base;
  const entries: number[] = [];
  let end: number = B;
  for (const e of [...v.functions()].sort(compareNumbers)) {
    const f = v.owner(e);
    if (f === undefined || f.entry !== e || e > end + 3 || (f.origin !== 'rom-entry' && f.origin !== 'adr' && f.origin !== 'veneer')) break;
    entries.push(e);
    end = Math.max(end, f.extent.end);
  }
  return { span: { start: B, end: (end + 3) & ~3 }, entries };
}

function regionStandIns(): RegisteredRule[] {
  return [
    standIn('region.startup', 'the startup getter', { kind: 'region', classify: () => [], startup: startupOf }),
    standIn('region.padding', 'the PoC claims no padding', { kind: 'region', classify: () => [] }),
    standIn('region.data-after-code', 'the PoC claims no data', { kind: 'region', classify: () => [] }),
  ];
}

/** The stand-ins of the answered families' unlogged slots, by id. */
export function replayRules(records: readonly PocQuery[], families: readonly AnalysisFamily[]): RuleRegistry {
  const answered = answeredFamilies(families);
  const rules: RegisteredRule[] = [
    ...(answered.includes('seed') ? seedStandIns(records) : []),
    ...(answered.includes('accept') ? acceptStandIns() : []),
    ...(answered.includes('gap') ? gapStandIns() : []),
    ...(answered.includes('claim') ? claimStandIns() : []),
    ...(answered.includes('region') ? regionStandIns() : []),
  ];
  const out: Record<RuleId, RegisteredRule> = {};
  for (const r of rules) out[r.meta.id] = r;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Running it.

/** Every rule id the profile's pipeline names. */
function pipelineIds(profile: CompilerProfile): readonly RuleId[] {
  const p = profile.pipeline;
  const g = p.gap;
  return [...p.seed, ...p.harvest, ...p.queue, ...p.walk, ...p.bl, ...p.validity, ...p.accept, ...p.claim, g.absorb, g.head, ...g.forward, g.prefer, g.skip, g.endAnchor, g.backward, ...p.region];
}

/** The pipeline ids of computed families that `registry` lacks. */
export function missingRules(profile: CompilerProfile, registry: RuleRegistry, families: readonly AnalysisFamily[]): readonly RuleId[] {
  const answered = answeredFamilies(families);
  return pipelineIds(profile).filter((id) => !answered.includes(familyOf(id) as AnalysisFamily) && !Object.hasOwn(registry, id));
}

/** Runs the driver in lockstep with `records` (one log), `families` answered, on `rom`; pure but for the run. */
export function runLockstep(rom: Rom, records: readonly PocQuery[], families: readonly AnalysisFamily[], profile: CompilerProfile, registry: RuleRegistry = RULES): LockstepResult {
  const answered = answeredFamilies(families);
  const rules: RuleRegistry = { ...registry, ...replayRules(records, answered) };
  const missing = missingRules(profile, rules, answered);
  if (missing.length > 0) throw new BenchError(`the computed families lack rules: ${missing.join(', ')}`);
  const oracle = logOracle(records, answered, rom);
  const options: AnalysisOptions = { mode: 'discover', seeds: [], overrides: [], trail: 'off' };
  const tuning: AnalysisTuning = { worklist: 'poc-lifo', cache: 'epoch', disabled: [], oracle };
  try {
    const result = runAnalysis(rom, profile, options, tuning, rules);
    const divergence = oracle.finish();
    return { ...oracle.counts(), families: answered, ...(divergence === undefined ? {} : { divergence }), parityDigest: resultParityDigest(result), functions: result.functions.length };
  } catch (error) {
    if (error instanceof LockstepDivergence) return { ...oracle.counts(), families: answered, divergence: error.divergence };
    throw error;
  }
}

export interface RomLockstep extends LockstepResult {
  readonly rom: string;
  /** The committed PoC digest (bench/baseline/poc-digests.json). */
  readonly expectedDigest: string;
}

/** One tuning ROM's bytes and log, checked against its dataset, the pinned PoC and the committed digests. */
interface LoadedLog {
  readonly rom: Rom;
  readonly records: readonly PocQuery[];
  readonly expectedDigest: string;
  readonly profile: CompilerProfile;
}

/** Reads one tuning ROM and its log; refuses a ROM or log that is not the dataset's or the pinned PoC's. */
async function loadLog(cx: BenchContext, name: string): Promise<LoadedLog> {
  const { datasets } = await loadDatasets(cx);
  const d = tuningDatasets(datasets, name)[0];
  if (d === undefined) throw new BenchError(`no tuning dataset named ${name}`);
  const romPath = join(cx.benchRoot, d.rom);
  if (!(await exists(romPath))) throw new BenchError(`${name}: the ROM ${romPath} is missing`);
  const bytes = await readFileBytes(romPath);
  const sha1 = sha1Of(bytes);
  if (sha1 !== d.sha1) throw new BenchError(`${name}: refusing ${d.rom}: SHA-1 ${sha1}, the dataset records ${d.sha1}`);
  const logPath = queriesPath(cx, name);
  if (!(await exists(logPath))) throw new BenchError(`${name}: ${logPath} is missing: run npm run export-poc -- --mode queries`);
  const pinned = await readPinnedPocSource(cx);
  const log = await openPocLog(logPath);
  if (log.header.sha1 !== sha1) throw new BenchError(`${logPath} is the log of SHA-1 ${log.header.sha1}, not ${sha1}`);
  if (log.header.pocSourceDigest !== pinned.digest) throw new BenchError(`${logPath} was made from PoC source ${log.header.pocSourceDigest}, not the pinned ${pinned.digest}: re-run export-poc`);
  const records: PocQuery[] = [];
  for await (const q of log.queries) records.push(q);
  const digests = parsePocDigests(await readJson(pocDigestsPath(cx)), pocDigestsPath(cx));
  const expectedDigest = digests.roms[name];
  if (expectedDigest === undefined) throw new BenchError(`${pocDigestsPath(cx)} has no digest for ${name}`);
  const profile = profileById('agbcc');
  if (profile === undefined) throw new BenchError('the agbcc profile is not registered');
  return { rom: romFromBytes(bytes, sha1), records, expectedDigest, profile };
}

/** Reads one tuning ROM and its log, then runs runLockstep with `families` answered. */
export async function lockstep(cx: BenchContext, name: string, families: readonly AnalysisFamily[]): Promise<RomLockstep> {
  const loaded = await loadLog(cx, name);
  return { rom: name, expectedDigest: loaded.expectedDigest, ...runLockstep(loaded.rom, loaded.records, families, loaded.profile) };
}

/** The recorded summary of one lockstep run of the set `set` that computes `real`. */
export function lockstepSummary(set: string, real: readonly EvidenceFamily[], r: LockstepResult): LockstepSummary {
  const d = r.divergence;
  return {
    set,
    real: [...real],
    queries: r.queries,
    matched: r.matched,
    answered: r.answered,
    compared: r.compared,
    markers: r.markers,
    skipped: r.skipped,
    recalled: r.recalled,
    parityDigest: r.parityDigest ?? null,
    divergence: d === undefined ? null : { seq: d.seq, kind: d.kind, epoch: d.epoch, method: d.method, detail: d.detail },
  };
}

/** Every family set of LOCKSTEP_SETS on one tuning ROM, its log read once; and the committed digest. */
export async function lockstepSets(cx: BenchContext, name: string): Promise<{ readonly expectedDigest: string; readonly sets: readonly LockstepSummary[] }> {
  const loaded = await loadLog(cx, name);
  const sets = LOCKSTEP_SETS.map((s) => lockstepSummary(s.name, s.real, runLockstep(loaded.rom, loaded.records, answeredBy(s.real), loaded.profile)));
  return { expectedDigest: loaded.expectedDigest, sets };
}
