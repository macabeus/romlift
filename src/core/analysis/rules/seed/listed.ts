// seed.listed: the options' seeds whose rule is 'seed.listed', sorted by entry (Thumb before ARM at one
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
    id: 'seed.listed',
    summary: 'the project TOML lists it in [functions]',
    restsOn: 'confirm mode: the function set is exactly what the TOML lists',
    recovers: 'a function the project already names, whatever discovery would decide',
    reads: ['candidates'],
    adds: ['candidates'],
    origin: 'listed',
  },
  kind: 'seed',
  seeds(v) {
    return v.seeds
      .filter((s) => s.rule === 'seed.listed')
      .sort(bySeed)
      .map((s) => ({ entry: s.entry, mode: s.mode, proposedBy: 'seed.listed', cites: [s.entry] }));
  },
});
