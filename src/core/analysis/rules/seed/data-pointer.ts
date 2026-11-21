// seed.data-pointer (the PoC's pointerCandidates(), its data list): every target of the pointer index
// that is not a function, not on an earlier harvest list and not intrinsically invalid, when at least
// one word pointing at it is not claimed as code (a word inside code is an instruction pair, not a
// pointer). Ascending, as the index keeps its targets. A target inside a runs_at range is left out: code there is named
// by its run address, and a word holding its load address is the copy's source (pointers.ts, §6.7).
import type { Addr } from '../../../../foundation/rom/span.ts';
import { runsElsewhere } from '../../address-map.ts';
import { pointerTargets, pointersTo } from '../../pointers.ts';
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'seed.data-pointer',
    summary: 'Thumb pointers in words outside code are candidate functions',
    restsOn: 'tables of handlers and callbacks in data hold func+1 for every Thumb function they name',
    recovers: 'functions named only from data, such as the entries of a command or state table',
    reads: ['pointer-index', 'function-set', 'validity', 'claims'],
    adds: ['candidates'],
    origin: 'data-pointer',
  },
  kind: 'harvest',
  harvest(v, earlier) {
    const out: Addr[] = [];
    for (const t of pointerTargets(v.pointers)) {
      if (v.isFunction(t) || earlier.has(t) || v.neverValid(t) || runsElsewhere(v.addresses, t)) continue;
      if (pointersTo(v.pointers, t).some((off) => v.claimAt(v.rom.base + off) !== Claim.code)) out.push(t);
    }
    return out;
  },
});
