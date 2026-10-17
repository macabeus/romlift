// The lockstep oracle (architecture §4.5, D48), internal API. export-poc records every call of the
// proof of concept's Analyzer methods below with its arguments and result (romlift-bench/poc-queries@1);
// bench/src/lockstep.ts reads that log and implements RuleOracle. The driver calls the oracle at every
// PoC call site it reproduces:
//
//   - ask(query) before computing: the logged answer when the query's family is answered, else
//     undefined; then, when the driver computed the answer itself, check(query, ours).
//   - marker('claim', …) at every claim (accept and absorbBlock) and marker('forgetCandidates', …) at
//     every epoch (each grow round and each fillGaps call); both are always compared, never answered.
//
// Arguments are in the PoC's own units: some are ROM offsets (armAhead(p, end), holeHead's hi,
// absorbBlock(p, start, end), thumbCandidate's lo and hi, tryTiledHole's hi), the rest bus addresses.
// A nested call is asked only when the driver computes the enclosing query (it is then a PoC call site
// of ours too); the answer of an answered query is used as is, except that its side effects are
// applied as the PoC applies them: an accepted tryTiledHole is accepted (asking settle for it), and an
// answered absorbBlock asks settle(block) to merge the block. couldBeCode and inPointerTable live inside
// a rule (valid.calls-code, accept.pointer-table-run) and are never asked; the queries those rules make
// through the view (settle, valid) are.
import type { Addr, Mode } from '../../foundation/rom/span.ts';
import type { Family } from '../provenance/rule-id.ts';
import type { Reading, ValidityFailure } from './types.ts';

/** Each PoC method the driver asks about, with its arguments (PoC units) and its answer. */
export interface OracleQueries {
  readonly settle: { readonly args: { readonly entry: Addr }; readonly answer: Reading };
  readonly analyzeArm: { readonly args: { readonly entry: Addr }; readonly answer: Reading };
  readonly valid: { readonly args: { readonly entry: Addr }; readonly answer: boolean };
  /** null: valid. */
  readonly whyInvalid: { readonly args: { readonly entry: Addr }; readonly answer: ValidityFailure | null };
  readonly couldBeCode: { readonly args: { readonly target: Addr }; readonly answer: boolean };
  readonly acceptable: { readonly args: { readonly entry: Addr; readonly why: 'pool pointer' | 'data pointer' }; readonly answer: boolean };
  readonly inPointerTable: { readonly args: { readonly entry: Addr }; readonly answer: boolean };
  readonly pointerCandidates: {
    readonly args: Record<never, never>;
    readonly answer: { readonly pool: readonly Addr[]; readonly data: readonly Addr[] };
  };
  /** lo and hi are ROM offsets. */
  readonly thumbCandidate: { readonly args: { readonly entry: Addr; readonly lo: number; readonly hi: number }; readonly answer: Reading | null };
  /** p and end are ROM offsets; `at` of the answer too. */
  readonly armAhead: { readonly args: { readonly p: number; readonly end: number }; readonly answer: { readonly at: number; readonly reading: Reading } | null };
  /** hi is a ROM offset. */
  readonly holeHead: { readonly args: { readonly entry: Addr; readonly hi: number }; readonly answer: Reading | null };
  /** hi is a ROM offset. */
  readonly tryTiledHole: { readonly args: { readonly entry: Addr; readonly hi: number }; readonly answer: Reading | null };
  /** All ROM offsets; the answer is the block's end offset. */
  readonly absorbBlock: { readonly args: { readonly p: number; readonly start: number; readonly end: number }; readonly answer: number | null };
}

export type OracleMethod = keyof OracleQueries;

export type OracleQuery<M extends OracleMethod = OracleMethod> = M extends OracleMethod ? { readonly method: M } & OracleQueries[M]['args'] : never;

export type OracleAnswer<M extends OracleMethod> = OracleQueries[M]['answer'];

/** The rule family that answers each method; bl verdicts are inside settle, so the walk family covers them. */
export const ORACLE_FAMILY: Readonly<Record<OracleMethod, Family>> = {
  settle: 'walk',
  analyzeArm: 'walk',
  valid: 'valid',
  whyInvalid: 'valid',
  couldBeCode: 'valid',
  acceptable: 'accept',
  inPointerTable: 'accept',
  pointerCandidates: 'seed',
  thumbCandidate: 'gap',
  armAhead: 'gap',
  holeHead: 'gap',
  tryTiledHole: 'gap',
  absorbBlock: 'gap',
};

/** The two sequence markers: always compared, never answered. */
export type OracleMarker =
  | { readonly kind: 'claim'; readonly entry: Addr; readonly mode: Mode }
  | { readonly kind: 'forgetCandidates'; readonly epoch: number };

export interface RuleOracle {
  /** The families whose queries ask() answers; their rules need no implementation (the walk family covers bl). */
  readonly answered: readonly Family[];
  /** The logged answer when the query's family is answered; undefined when the driver must compute it. */
  ask<M extends OracleMethod>(query: OracleQuery<M>): OracleAnswer<M> | undefined;
  /** Compares the driver's own answer with the logged one. */
  check<M extends OracleMethod>(query: OracleQuery<M>, ours: OracleAnswer<M>): void;
  marker(m: OracleMarker): void;
}

/** Whether `oracle` answers `family`; the walk family's answers cover the bl family. */
export function answers(oracle: RuleOracle | undefined, family: Family): boolean {
  if (oracle === undefined) return false;
  if (oracle.answered.includes(family)) return true;
  return family === 'bl' && oracle.answered.includes('walk');
}

/** Asks the oracle, else computes and lets the oracle check: the call the driver makes at each PoC call site. */
export function consult<M extends OracleMethod>(oracle: RuleOracle | undefined, query: OracleQuery<M>, compute: () => OracleAnswer<M>): OracleAnswer<M> {
  if (oracle === undefined) return compute();
  const logged = oracle.ask(query);
  if (logged !== undefined) return logged;
  const ours = compute();
  oracle.check(query, ours);
  return ours;
}
