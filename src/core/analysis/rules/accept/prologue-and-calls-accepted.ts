// accept.prologue-and-calls-accepted (D60 h): a valid candidate that data points at (origin data-pointer)
// is taken when it opens with a word-aligned `push {.., lr}`, returns, and calls at least one function and
// only accepted ones: a frame, a return and calls that each land on a known entry are three independent
// signs of a function, which bytes of data do not show by chance.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'accept.prologue-and-calls-accepted',
    summary:
      'a valid candidate named by data, with a prologue, a return and calls that all reach accepted functions, is a function',
    restsOn:
      'a function opens with push {.., lr} on a word boundary and returns, and each of its calls enters a function; data that decodes with a frame, a return and every bl on a known entry does not occur by chance',
    recovers:
      'functions named only from data (script commands, tables the harvest reads) that sit between data, anchored on neither side',
    reads: ['rom', 'readings', 'function-set', 'candidates'],
    adds: ['function-set'],
  },
  kind: 'accept',
  reason: 'unanchored',
  holds(c, r, v) {
    if (
      v.originOf(c.proposedBy) !== 'data-pointer' ||
      !v.profile.idioms.isPrologue(v.rom, r.entry, 'thumb') ||
      r.returns === 0
    )
      return undefined;
    if (r.calls.length === 0 || !r.calls.every((k) => v.isFunction(k.target))) return undefined;
    return {
      cites: [r.entry, ...c.cites, ...r.calls.map((k) => k.target)],
      note: 'prologue, a return, every call on an accepted function, named by data',
    };
  },
});
