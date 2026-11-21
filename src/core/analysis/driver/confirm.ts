// Confirm mode (architecture §4.2, D8): the project's [functions] are the function set from round 0.
// A listed entry whose seed asks for validation (`Seed.validate`, an entry another source proposed) and
// fails validity, judged over its listed extent per inner label's mode (listed-extent.ts, phase-6.md Q10), is kept and
// reported (W_LISTED_INVALID); any other listed entry is taken without the
// valid.* rules (phase-3.md Q5 c, D74). What discovery would accept beyond the list is reported
// (W_UNLISTED_FUNCTION) and claims nothing. Extents are cut in view.ts
// (extentEndOf): a listed size, else the reading cut at the next listed entry that is not a label.
import { diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { hexAddr } from '../../../foundation/util/hex.ts';
import { compareCodeUnits } from '../../../foundation/util/sorted.ts';
import { provenance } from '../../provenance/provenance.ts';
import type { Origin } from '../../provenance/vocabulary.ts';
import { AnalysisCodes } from '../codes.ts';
import type { AnalysisOptions, Candidate, OverrideFact, Seed } from '../types.ts';
import { whyListedInvalid } from './listed-extent.ts';
import type { DriverState } from './state.ts';

/** A total order of seeds: entry, mode (Thumb first), rule, then name, size, label and validate. */
export function compareSeeds(a: Seed, b: Seed): number {
  if (a.entry !== b.entry) return a.entry - b.entry;
  if (a.mode !== b.mode) return a.mode === 'thumb' ? -1 : 1;
  return (
    compareCodeUnits(a.rule, b.rule) ||
    compareCodeUnits(a.name ?? '', b.name ?? '') ||
    (a.size ?? -1) - (b.size ?? -1) ||
    Number(a.label === true) - Number(b.label === true) ||
    Number(a.validate === true) - Number(b.validate === true)
  );
}

/** A total order of overrides: span, kind, mode, then run address. */
export function compareOverrides(a: OverrideFact, b: OverrideFact): number {
  return (
    a.span.start - b.span.start ||
    a.span.end - b.span.end ||
    compareCodeUnits(a.kind, b.kind) ||
    compareCodeUnits(a.mode ?? '', b.mode ?? '') ||
    (a.runsAt ?? -1) - (b.runsAt ?? -1)
  );
}

/** The listed entries of a confirm run, by entry (the first of an entry's seeds in seed order); empty in discover mode. */
export function listedSeeds(options: AnalysisOptions): ReadonlyMap<Addr, Seed> {
  const listed = new Map<Addr, Seed>();
  if (options.mode !== 'confirm') return listed;
  for (const seed of [...options.seeds].sort(compareSeeds))
    if (seed.rule === 'seed.listed' && !listed.has(seed.entry)) listed.set(seed.entry, seed);
  return listed;
}

/**
 * Whether `c` names a listed entry in the other mode (a veneer's ARM target at an entry listed as Thumb, say). The
 * listed entry is a function from round 0 in its listed mode, so such a candidate meets an existing function, as in
 * discover mode once the entry is taken: it is neither accepted nor reported. Taking it would replace the listed
 * mode with the candidate's whenever the candidate is popped before the entry's own seed.
 */
export function isOtherModeOfListed(s: DriverState, c: Candidate): boolean {
  if (s.options.mode !== 'confirm') return false;
  const seed = s.listed.get(c.entry);
  return seed !== undefined && seed.mode !== c.mode;
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
    diagnostic(
      AnalysisCodes,
      'W_UNLISTED_FUNCTION',
      `${hexAddr(c.entry)} (${c.mode}) is accepted by ${c.proposedBy} but not listed`,
      {
        addr: c.entry,
        rule: c.proposedBy,
        cites: p.cites,
      },
    ),
  );
}

/**
 * Before a listed Thumb entry whose seed asks for validation is taken: the first validity failure of its listed extent,
 * judged per part in each part's mode with a fall-through into the next listed function as an exit (listed-extent.ts,
 * Q10), is recorded and the entry kept. An entry without `validate` is not checked at all.
 */
export function checkListed(s: DriverState, c: Candidate): void {
  if (s.options.mode !== 'confirm' || c.mode !== 'thumb' || s.listedInvalid.has(c.entry)) return;
  if (s.listed.get(c.entry)?.validate !== true) return;
  const failure = whyListedInvalid(s, c.entry);
  if (failure === undefined) return;
  const rejection = {
    at: c.entry,
    mode: c.mode,
    rule: failure.rule,
    reason: failure.reason,
    intrinsic: failure.intrinsic,
    round: s.round,
    detail: failure.detail,
    count: 1,
  };
  s.listedInvalid.set(c.entry, { entry: c.entry, rejection });
  s.diagnostics.push(
    diagnostic(
      AnalysisCodes,
      'W_LISTED_INVALID',
      `the listed function ${hexAddr(c.entry)} fails ${failure.rule}: ${failure.detail}`,
      {
        addr: c.entry,
        rule: failure.rule,
      },
    ),
  );
}
