// seed.evidence-hint: the options' seeds whose rule is 'seed.evidence-hint', sorted by entry (Thumb before ARM at one
// address). They come from the project or from evidence, never from the ROM, so a bare discover run
// (no seeds) proposes nothing.
import type { Seed } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

function bySeed(a: Seed, b: Seed): number {
  if (a.entry !== b.entry) return a.entry - b.entry;
  return a.mode === b.mode ? 0 : a.mode === 'thumb' ? -1 : 1;
}

export default defineRule({
  meta: {
    id: 'seed.evidence-hint',
    summary: 'an external fact (a trace, an ELF, a map or a legacy cfg) names it',
    restsOn: 'external evidence is ground truth the rules only approximate',
    recovers: 'functions no static rule reaches, such as code only called through computed pointers',
    reads: ['candidates'],
    adds: ['candidates'],
    origin: 'evidence',
  },
  kind: 'seed',
  seeds(v) {
    return v.seeds
      .filter((s) => s.rule === 'seed.evidence-hint')
      .sort(bySeed)
      .map((s) => ({ entry: s.entry, mode: s.mode, proposedBy: 'seed.evidence-hint', cites: [s.entry] }));
  },
});
