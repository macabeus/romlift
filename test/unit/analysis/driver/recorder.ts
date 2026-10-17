// A hand-written oracle for the protocol tests: it records every ask (in call order), every check and
// every marker, and answers the queries of its families from `answers`. Not a test file.
import type { Family } from '../../../../src/core/provenance/rule-id.ts';
import { ORACLE_FAMILY } from '../../../../src/core/analysis/oracle.ts';
import type { CandidateWorklist, OracleAnswer, OracleMethod, OracleQuery, RuleOracle } from '../../../../src/core/analysis/oracle.ts';
import type { Candidate } from '../../../../src/core/analysis/types.ts';

/** The PoC's work.pop(): the order a lockstep log is recorded in. */
export function lifo(): CandidateWorklist {
  const items: Candidate[] = [];
  return { push: (c) => void items.push(c), pop: () => items.pop() };
}

export interface Recorder extends RuleOracle {
  readonly log: string[];
  readonly checked: string[];
}

type Answers = { readonly [M in OracleMethod]?: (q: OracleQuery<M>) => OracleAnswer<M> | undefined };

export function recorder(answered: readonly Family[] = [], answers: Answers = {}): Recorder {
  const log: string[] = [];
  const checked: string[] = [];
  return {
    worklist: lifo,
    answered,
    log,
    checked,
    ask<M extends OracleMethod>(q: OracleQuery<M>): OracleAnswer<M> | undefined {
      log.push(q.method);
      if (!answered.includes(ORACLE_FAMILY[q.method])) return undefined;
      const answer = answers[q.method] as ((q: OracleQuery<M>) => OracleAnswer<M> | undefined) | undefined;
      return answer?.(q);
    },
    check(q) {
      checked.push(q.method);
    },
    marker(m) {
      log.push(`#${m.kind}`);
    },
  };
}
