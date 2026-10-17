// Confirm mode (architecture §4.2, D8): the project's [functions] are the function set from round 0.
// A listed entry that fails validity is kept (W_LISTED_INVALID); what discovery would accept beyond
// the list is reported (W_UNLISTED_FUNCTION) and claims nothing. Extents are cut in view.ts
// (extentEndOf): a listed size, else the reading cut at the next listed entry that is not a label.
import { diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { hexAddr } from '../../../foundation/util/hex.ts';
import { provenance } from '../../provenance/provenance.ts';
import type { Origin } from '../../provenance/vocabulary.ts';
import { AnalysisCodes } from '../codes.ts';
import type { AnalysisOptions, Candidate, Seed } from '../types.ts';
import { whyInvalid } from './validity.ts';
import type { DriverState } from './view.ts';

/** The listed entries of a confirm run, by entry; empty in discover mode. */
export function listedSeeds(options: AnalysisOptions): ReadonlyMap<Addr, Seed> {
  const listed = new Map<Addr, Seed>();
  if (options.mode !== 'confirm') return listed;
  for (const seed of options.seeds) if (seed.rule === 'seed.listed' && !listed.has(seed.entry)) listed.set(seed.entry, seed);
  return listed;
}

/** Whether accepting `c` would add a function the confirm run does not list. */
export function isUnlisted(s: DriverState, c: Candidate): boolean {
  return s.options.mode === 'confirm' && !s.listed.has(c.entry);
}

/** Reports a discovery beyond the list, once per entry. */
export function recordUnlisted(s: DriverState, c: Candidate, origin: Origin): void {
  if (s.unlisted.has(c.entry)) return;
  const p = provenance(c.proposedBy, s.round, c.cites);
  s.unlisted.set(c.entry, { entry: c.entry, mode: c.mode, origin, provenance: p });
  s.diagnostics.push(
    diagnostic(AnalysisCodes, 'W_UNLISTED_FUNCTION', `${hexAddr(c.entry)} (${c.mode}) is accepted by ${c.proposedBy} but not listed`, {
      addr: c.entry,
      rule: c.proposedBy,
      cites: p.cites,
    }),
  );
}

/** Before a listed Thumb entry is taken: its first validity failure, if any, is recorded and the entry kept. */
export function checkListed(s: DriverState, c: Candidate): void {
  if (s.options.mode !== 'confirm' || c.mode !== 'thumb' || s.listedInvalid.has(c.entry)) return;
  const failure = whyInvalid(s, c.entry);
  if (failure === undefined) return;
  const rejection = { at: c.entry, mode: c.mode, rule: failure.rule, reason: failure.reason, intrinsic: failure.intrinsic, round: s.round, detail: failure.detail, count: 1 };
  s.listedInvalid.set(c.entry, { entry: c.entry, rejection });
  s.diagnostics.push(
    diagnostic(AnalysisCodes, 'W_LISTED_INVALID', `the listed function ${hexAddr(c.entry)} fails ${failure.rule}: ${failure.detail}`, {
      addr: c.entry,
      rule: failure.rule,
    }),
  );
}
