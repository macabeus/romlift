// seed.override: the options' seeds whose rule is 'seed.override', sorted by entry (Thumb before ARM at one
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
    id: 'seed.override',
    summary: 'the project TOML overrides the analysis there',
    restsOn: 'the owner knows better than the rules: an override marks code the rules cannot prove',
    recovers: 'code the rules miss or would split differently',
    reads: ['candidates'],
    adds: ['candidates'],
    origin: 'override',
  },
  kind: 'seed',
  seeds(v) {
    return v.seeds
      .filter((s) => s.rule === 'seed.override')
      .sort(bySeed)
      .map((s) => ({ entry: s.entry, mode: s.mode, cites: [s.entry] }));
  },
});
