// The AnalysisView over the driver state (architecture §4.1): what a rule may read. Each query is
// answered from the live state; the 'epoch-reuse' cache (reuse.ts) records the facts a reading reads.
import type { Rom } from '../../../foundation/rom/rom.ts';
import type { CompilerProfile } from '../../profile/types.ts';
import type { AddressMap } from '../address-map.ts';
import type { PointerIndex } from '../pointers.ts';
import type { AnalysisView, OverrideFact, Seed } from '../types.ts';
import { factOf, ownerOf } from './facts.ts';
import { readAddr, readInProgress, readOpaque } from './reuse.ts';
import { inSpans } from './seeds.ts';
import { boundaryBetween, claimAt, isBoundary, isFunction } from './state.ts';
import type { DriverState } from './state.ts';

/** A view query the 'epoch-reuse' cache does not track: the reading being computed, if any, is never carried. */
function opaque(s: DriverState): DriverState {
  if (s.reuse !== undefined) readOpaque(s.reuse);
  return s;
}

/** The view rules read, over the live state; `get` returns the driver state once it is built. */
export function makeView(get: () => DriverState): AnalysisView {
  return {
    get rom(): Rom {
      return get().rom;
    },
    get profile(): CompilerProfile {
      return get().profile;
    },
    get addresses(): AddressMap {
      return get().addresses;
    },
    get round(): number {
      return get().round;
    },
    get epoch(): number {
      return get().epoch;
    },
    get seeds(): readonly Seed[] {
      return get().seeds;
    },
    get overrides(): readonly OverrideFact[] {
      return get().options.overrides;
    },
    get pointers(): PointerIndex {
      return get().pointers;
    },
    inDataOverride: (a) => inSpans(get().dataOverrides, a),
    claimAt: (a) => {
      const s = get();
      if (s.reuse !== undefined) readAddr(s.reuse, a);
      return claimAt(s, a);
    },
    owner: (a) => {
      const s = get();
      opaque(s);
      const e = ownerOf(s, a);
      return e === undefined ? undefined : factOf(s, e);
    },
    isFunction: (a) => {
      const s = get();
      if (s.reuse !== undefined) readAddr(s.reuse, a);
      return isFunction(s, a);
    },
    isBoundary: (a) => {
      const s = get();
      if (s.reuse !== undefined) readAddr(s.reuse, a);
      return isBoundary(s, a);
    },
    boundaryBetween: (lo, hi) => boundaryBetween(get(), lo, hi),
    functions: () => opaque(get()).order.slice(),
    accepted: (entry) => opaque(get()).funcs.get(entry)?.reading,
    read: (entry, mode) => get().services.read(entry, mode),
    valid: (entry) => opaque(get()).services.valid(entry),
    whyInvalid: (entry) => opaque(get()).services.whyInvalid(entry),
    neverValid: (entry) => opaque(get()).neverValid.has(entry),
    inProgress: (entry) => {
      const s = get();
      const answer = s.inProgress.has(entry);
      if (s.reuse !== undefined) readInProgress(s.reuse, entry, answer);
      return answer;
    },
    adrOwner: (a) => opaque(get()).adrOwner.get(a),
    originOf: (rule) => get().rules.origin.get(rule),
  };
}
